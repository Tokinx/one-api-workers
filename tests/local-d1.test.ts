import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "hono";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import db from "../src/db";
import { consumeAdminRateLimit, createAdminLoginChallenge, verifyAdminLoginChallenge } from "../src/admin/auth_shared";

let directory: string;
let proxy: PlatformProxy<CloudflareBindings> | undefined;
let context: Context<HonoCustomType>;

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "one-api-workers-d1-test-"));
    const configPath = join(directory, "wrangler.jsonc");
    await writeFile(configPath, JSON.stringify({
        name: "one-api-workers-regression", compatibility_date: "2025-04-28",
        d1_databases: [{ binding: "DB", database_name: "regression", database_id: "isolated-regression" }],
    }));
    proxy = await getPlatformProxy<CloudflareBindings>({ configPath, persist: false, remoteBindings: false, envFiles: [] });
    context = new Context<HonoCustomType>(new Request("http://localhost/", { headers: { "cf-connecting-ip": "198.51.100.1" } }), { env: proxy.env });
    await db.initialize(context);
}, 30_000);

afterAll(async () => {
    try { await proxy?.dispose(); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
});

test("real local D1 preserves unlimited quota during precision migration", async () => {
    const database = context.env.DB;
    await database.exec("DROP TABLE api_token");
    await database.exec("CREATE TABLE api_token (key TEXT PRIMARY KEY, value TEXT, usage REAL, created_at TEXT, updated_at TEXT)");
    await database.prepare("INSERT INTO api_token VALUES (?, ?, 1.5, '2025-01-01', '2025-01-02')")
        .bind("unlimited", JSON.stringify({ name: "fixture", channel_keys: [], total_quota: -1 })).run();
    await db.migrate(context);
    const row = await database.prepare("SELECT value, usage FROM api_token WHERE key = 'unlimited'").first<{ value: string; usage: number }>();
    expect(JSON.parse(row!.value).total_quota).toBe(-1);
    expect(row!.usage).toBe(1500);
});

test("real local D1 admits exactly six concurrent rate-limit requests", async () => {
    const policy = { category: "local-d1-login", maxAttempts: 6, windowMs: 60_000, blockDurationMs: 120_000, message: "limited" };
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeAdminRateLimit(context, policy, "ip")));
    expect(results.filter(result => result.ok)).toHaveLength(6);
    const row = await context.env.DB.prepare("SELECT attempts FROM admin_rate_limit WHERE bucket_key = ?").bind("local-d1-login:ip").first<{ attempts: number }>();
    expect(row?.attempts).toBe(7);
});

test("real local D1 grants one consumer of a correct code and exhausts five incorrect attempts", async () => {
    const correct = await createAdminLoginChallenge(context);
    const winners = await Promise.all(Array.from({ length: 20 }, () => verifyAdminLoginChallenge(context, correct.challengeId, correct.code)));
    expect(winners.filter(result => result.ok)).toHaveLength(1);

    const incorrect = await createAdminLoginChallenge(context);
    const wrongCode = incorrect.code === "000000" ? "111111" : "000000";
    const failures = await Promise.all(Array.from({ length: 20 }, () => verifyAdminLoginChallenge(context, incorrect.challengeId, wrongCode)));
    expect(failures.filter(result => result.reason === "验证码错误")).toHaveLength(4);
    expect(failures.filter(result => result.reason === "验证码错误，已达到最大尝试次数")).toHaveLength(1);
    expect((await verifyAdminLoginChallenge(context, incorrect.challengeId, incorrect.code)).ok).toBe(false);
});
