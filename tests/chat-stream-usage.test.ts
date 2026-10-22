import { expect, test, spyOn } from "bun:test";
import { handleStreamResponse } from "../src/providers/shared/openai-stream-utils";
import { estimateTokensFromText } from "../src/providers/shared/usage-utils";
import { Context } from "hono";
import openai from "../src/providers/openai-proxy";
import azure from "../src/providers/azure-openai-proxy";

const requestBody = { model: "test", messages: [{ role: "user", content: "你好" }], stream: true };
const context = new Context<HonoCustomType>(new Request("http://localhost/"));
const chunk = (delta: object) => `data:${JSON.stringify({ choices: [{ delta }] })}\r\n\r\n`;

async function collectUsage(text: string, options: { fail?: boolean; splitBytes?: boolean } = {}) {
    const data = new TextEncoder().encode(text);
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset < data.length) {
                const end = options.splitBytes ? offset + 1 : data.length;
                controller.enqueue(data.slice(offset, end));
                offset = end;
            } else if (options.fail) {
                controller.error(new Error("upstream disconnected"));
            } else {
                controller.close();
            }
        },
    });
    const saved: Usage[] = [];
    await handleStreamResponse(context, stream, requestBody, async usage => { saved.push(usage); });
    return saved;
}

test("missing usage estimates split UTF-8 content and reasoning once", async () => {
    const saved = await collectUsage(chunk({ content: "你好" }) + chunk({ reasoning_content: "think" }) + "data: [DONE]", { splitBytes: true });
    const prompt = estimateTokensFromText(JSON.stringify(requestBody));
    const completion = estimateTokensFromText("你好think");
    expect(saved).toEqual([{ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }]);
});

test("upstream usage is authoritative and repeated summaries do not double charge", async () => {
    const usage = { prompt_tokens: 25, completion_tokens: 7, total_tokens: 32 };
    const summary = `data: ${JSON.stringify({ choices: [], usage })}\n\n`;
    expect(await collectUsage(chunk({ content: "answer" }) + summary + summary)).toEqual([usage]);
});

test("tool-only and legacy function output count toward estimates", async () => {
    const output = chunk({ tool_calls: [{ function: { name: "weather", arguments: '{"city":"上海"}' } }] })
        + chunk({ function_call: { name: "legacy", arguments: "{}" } });
    const saved = await collectUsage(output);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.completion_tokens).toBe(estimateTokensFromText('weather{"city":"上海"}legacy{}'));
});

test("partial output is settled on read failure, including an unterminated final line", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
        const saved = await collectUsage(chunk({ content: "partial" }).trimEnd(), { fail: true });
        expect(saved).toHaveLength(1);
        expect(saved[0]?.completion_tokens).toBe(estimateTokensFromText("partial"));
    } finally { warn.mockRestore(); }
});

test("empty and error-only streams are not estimated as successful completions", async () => {
    expect(await collectUsage("")).toEqual([]);
    expect(await collectUsage('data: {"error":{"message":"failed"}}\n\n')).toEqual([]);
});

test("empty usage objects do not suppress fallback estimates", async () => {
    const saved = await collectUsage(chunk({ content: "answer" }) + 'data: {"usage":{}}\n\n');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.completion_tokens).toBe(estimateTokensFromText("answer"));
});

test("a failing settlement callback is not called again for duplicate usage or fallback", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const summary = 'data: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n';
    const stream = new Response(chunk({ content: "answer" }) + summary + summary).body!;
    try {
        await handleStreamResponse(context, stream, requestBody, async () => {
            calls++;
            throw new Error("storage failed");
        });
        expect(calls).toBe(1);
    } finally { error.mockRestore(); }
});

for (const [name, provider] of [["OpenAI", openai], ["Azure", azure]] as const) {
    test(`${name} provider preserves the client stream and settles missing usage in the background`, async () => {
        const text = chunk({ content: "provider answer" }) + "data: [DONE]\n\n";
        const upstream = spyOn(globalThis, "fetch").mockResolvedValue(new Response(text, {
            headers: { "content-type": "text/event-stream", "x-upstream": "preserved" },
        }));
        const tasks: Promise<unknown>[] = [];
        const c = new Context<HonoCustomType>(new Request("http://localhost/v1/chat/completions", { method: "POST" }), {
            executionCtx: { waitUntil: task => { tasks.push(task); } } as ExecutionContext,
        });
        const saved: Usage[] = [];
        try {
            const response = await provider.fetch(c, { name, type: "openai", endpoint: "https://upstream.example", api_key: "fixture-key" },
                { ...requestBody }, async usage => { saved.push(usage); }, { retryCount: 0 });
            expect(await response.text()).toBe(text);
            expect(response.headers.get("x-upstream")).toBe("preserved");
            await Promise.all(tasks);
            expect(saved).toHaveLength(1);
            expect(saved[0]?.completion_tokens).toBe(estimateTokensFromText("provider answer"));
        } finally { upstream.mockRestore(); }
    });
}
