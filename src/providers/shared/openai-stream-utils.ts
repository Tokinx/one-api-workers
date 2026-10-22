import { Context } from "hono"
import { estimateTokensFromText } from "./usage-utils"

const AUDIO_OUTPUT_TOKENS_PER_MINUTE = 1250
const TEXT_TOKENS_PER_CHAR = 0.25
const SPEECH_CHARS_PER_MINUTE = 750

const collectInputText = (input: unknown): string => {
    if (typeof input === "string") {
        return input
    }

    if (Array.isArray(input)) {
        return input
            .map((item) => collectInputText(item))
            .filter((text) => text.length > 0)
            .join(" ")
    }

    if (input && typeof input === "object") {
        if ("text" in input && typeof input.text === "string") {
            return input.text
        }

        if ("content" in input) {
            return collectInputText(input.content)
        }
    }

    return ""
}

const estimateAudioSpeechUsage = (requestBody: any): Usage | null => {
    const inputText = collectInputText(requestBody?.input).trim()
    if (!inputText) {
        return null
    }

    const characterCount = Array.from(inputText).length
    const promptTokens = Math.max(1, Math.ceil(characterCount * TEXT_TOKENS_PER_CHAR))
    const estimatedMinutes = Math.max(1 / 60, characterCount / SPEECH_CHARS_PER_MINUTE)
    const completionTokens = Math.max(1, Math.ceil(estimatedMinutes * AUDIO_OUTPUT_TOKENS_PER_MINUTE))

    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
    }
}

export const checkoutUsageData = async (
    saveUsage: (usage: Usage) => Promise<void>,
    response: Response | OpenAIResponse,
    requestBody?: any,
): Promise<void> => {
    try {
        if (response instanceof Response) {
            const contentType = response.headers.get("content-type") || ""
            if (contentType.startsWith("audio/")) {
                const estimatedUsage = estimateAudioSpeechUsage(requestBody)
                if (!estimatedUsage) return
                await saveUsage(estimatedUsage)
                return
            }

            if (!contentType.includes("application/json")) {
                return
            }

            const res = await response.clone().json() as OpenAIResponse
            if (!res.usage) return;
            await saveUsage(res.usage)
            return
        }

        const res = response
        if (!res.usage) return;
        await saveUsage(res.usage)
    } catch (error) {
        console.error("Error logging usage data:", error)
    }
}

type ChatStreamUsageState = {
    saved: boolean
    observedCompletion: boolean
    outputBytes: number
}

type ChatStreamChunk = OpenAIResponse & {
    choices?: Array<{
        delta?: {
            content?: string
            reasoning_content?: string
            refusal?: string
            function_call?: { name?: string; arguments?: string }
            tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
        }
    }>
}

const encoder = new TextEncoder()

export const processStreamData = async (
    lines: string[],
    state: ChatStreamUsageState,
    saveUsage: (usage: Usage) => Promise<void>
): Promise<void> => {
    if (state.saved) return
    const processedLines = lines
        .map(line => line.trim())
        .filter(line => line.length > 0 && line.startsWith('data:'))
        .map(line => line.slice('data:'.length).trim())
        .filter(line => line !== '[DONE]')

    for (const jsonContent of processedLines) {
        if (state.saved) break
        try {
            const res = JSON.parse(jsonContent) as ChatStreamChunk
            if (!res || typeof res !== "object") continue
            if (Array.isArray(res.choices) && res.choices.length > 0) {
                state.observedCompletion = true
                for (const choice of res.choices) {
                    const delta = choice?.delta
                    const functions = [delta?.function_call, ...(delta?.tool_calls || []).map(tool => tool.function)]
                    const parts = [delta?.content, delta?.reasoning_content, delta?.refusal,
                        ...functions.flatMap(fn => [fn?.name, fn?.arguments])]
                    for (const part of parts) {
                        if (typeof part === "string") state.outputBytes += encoder.encode(part).length
                    }
                }
            }
            // Only a complete numeric usage summary can replace the estimate.
            if (typeof res.usage?.prompt_tokens === "number" && Number.isFinite(res.usage.prompt_tokens)
                && typeof res.usage.completion_tokens === "number" && Number.isFinite(res.usage.completion_tokens)) {
                state.saved = true
                await saveUsage(res.usage)
                break
            }
        } catch (e) {
            console.error("Error parsing stream data:", e)
        }
    }
}

export const handleStreamResponse = async (
    _c: Context<HonoCustomType>,
    streamForServer: ReadableStream<Uint8Array> | undefined,
    requestBody: unknown,
    saveUsage: (usage: Usage) => Promise<void>
): Promise<void> => {
    const state: ChatStreamUsageState = { saved: false, observedCompletion: false, outputBytes: 0 }
    const reader = streamForServer?.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ""
    try {
        if (!reader) {
            throw new Error("No reader found in response body")
        }

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            if (!chunk.includes('\n')) continue

            const lines = buffer.split('\n')
            buffer = lines.pop() || ""

            await processStreamData(lines, state, saveUsage)
        }
    } catch (error) {
        // 上游关闭或客户端断开都会让 tee 分支读取失败，属预期情况
        console.warn("Stream processing interrupted (upstream closed or client disconnected):", error)
    } finally {
        reader?.releaseLock()
        buffer += decoder.decode()
        if (buffer.trim()) await processStreamData([buffer], state, saveUsage)
        if (!state.saved && state.observedCompletion) {
            // Match the existing Responses estimate (UTF-8 bytes / 4), without
            // retaining generated text. Also settle partial output on read errors.
            const promptTokens = estimateTokensFromText(JSON.stringify(requestBody) || "")
            const completionTokens = Math.ceil(state.outputBytes / 4)
            state.saved = true
            await saveUsage({
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
            })
        }
    }
}
