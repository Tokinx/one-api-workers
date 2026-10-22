import { afterEach, beforeEach, expect, test } from "bun:test";
import db from "../src/db";
import { consumeAdminRateLimit, createAdminLoginChallenge, createAdminSession, verifyAdminLoginChallenge } from "../src/admin/auth_shared";
import { createTestDatabase } from "./helpers/sqlite-d1";

let fixture: ReturnType<typeof createTestDatabase>;
beforeEach(async () => {
    fixture = createTestDatabase();
    fixture.context.req.raw.headers.set("cf-connecting-ip", "198.51.100.1");
    await db.initialize(fixture.context);
});
afterEach(() => fixture.close());

const policy = { category: "test-login", maxAttempts: 6, windowMs: 60_000, blockDurationMs: 120_000, message: "limited" };

test("concurrent requests cannot exceed the rate limit or extend an active block", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeAdminRateLimit(fixture.context, policy, "ip")));
    expect(results.filter(result => result.ok)).toHaveLength(6);
    const row = fixture.sqlite.query("SELECT * FROM admin_rate_limit").get() as { attempts: number; blocked_until: string };
    expect(row.attempts).toBe(7);
    expect(results.filter(result => !result.ok).every(result => !result.ok && result.retryAfterSeconds > 0)).toBe(true);
    await consumeAdminRateLimit(fixture.context, policy, "ip");
    expect(fixture.sqlite.query("SELECT blocked_until FROM admin_rate_limit").get()).toEqual({ blocked_until: row.blocked_until });
    expect((await consumeAdminRateLimit(fixture.context, policy, "other-ip")).ok).toBe(true);
});

function seedBucket(windowStartedAt: string, blockedUntil: string | null, attempts = 6) {
    fixture.sqlite.query(`INSERT INTO admin_rate_limit
        (bucket_key, category, bucket_id, window_started_at, attempts, blocked_until, last_event_at)
        VALUES (?, ?, 'ip', ?, ?, ?, ?)`).run("test-login:ip", policy.category, windowStartedAt, attempts, blockedUntil, new Date().toISOString());
}

test("expired window resets the counter", async () => {
    seedBucket(new Date(Date.now() - 120_000).toISOString(), null);
    expect((await consumeAdminRateLimit(fixture.context, policy, "ip")).ok).toBe(true);
    expect(fixture.sqlite.query("SELECT attempts FROM admin_rate_limit").get()).toEqual({ attempts: 1 });
});

test("an expired block in an active window does not reset attempts", async () => {
    seedBucket(new Date(Date.now() - 20_000).toISOString(), new Date(Date.now() - 10_000).toISOString());
    expect((await consumeAdminRateLimit(fixture.context, policy, "ip")).ok).toBe(false);
});

test("active block survives an expired window and mixed ISO timestamp formats", async () => {
    const block = new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    seedBucket(new Date(Date.now() - 120_000).toISOString(), block);
    expect((await consumeAdminRateLimit(fixture.context, policy, "ip")).ok).toBe(false);
    expect(fixture.sqlite.query("SELECT attempts, blocked_until FROM admin_rate_limit").get()).toEqual({ attempts: 6, blocked_until: block });
});

test("only one concurrent correct verification can consume a challenge", async () => {
    const { challengeId, code } = await createAdminLoginChallenge(fixture.context);
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyAdminLoginChallenge(fixture.context, challengeId, code)));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect((await verifyAdminLoginChallenge(fixture.context, challengeId, code)).ok).toBe(false);
    expect(fixture.sqlite.query("SELECT * FROM admin_login_challenge").all()).toEqual([]);
});

test("concurrent incorrect codes exhaust exactly five attempts", async () => {
    const { challengeId, code } = await createAdminLoginChallenge(fixture.context);
    const wrongCode = code === "000000" ? "111111" : "000000";
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyAdminLoginChallenge(fixture.context, challengeId, wrongCode)));
    expect(results.every(result => !result.ok)).toBe(true);
    expect(results.filter(result => result.reason === "验证码错误")).toHaveLength(4);
    expect(results.filter(result => result.reason === "验证码错误，已达到最大尝试次数")).toHaveLength(1);
    expect((await verifyAdminLoginChallenge(fixture.context, challengeId, code)).ok).toBe(false);
});

test("a correct code racing the last incorrect attempt has at most one winner", async () => {
    const { challengeId, code } = await createAdminLoginChallenge(fixture.context);
    fixture.sqlite.query("UPDATE admin_login_challenge SET attempts = 4 WHERE id = ?").run(challengeId);
    const wrongCode = code === "000000" ? "111111" : "000000";
    const results = await Promise.all([
        verifyAdminLoginChallenge(fixture.context, challengeId, wrongCode),
        verifyAdminLoginChallenge(fixture.context, challengeId, code),
        verifyAdminLoginChallenge(fixture.context, challengeId, code),
    ]);
    expect(results.filter(result => result.ok).length).toBeLessThanOrEqual(1);
    expect(fixture.sqlite.query("SELECT * FROM admin_login_challenge").all()).toEqual([]);
});

for (const [column, value] of [["expires_at", "2000-01-01T00:00:00Z"], ["expires_at", "invalid"], ["attempts", 5], ["request_ip", "203.0.113.1"]] as const) {
    test(`invalid challenge (${column}=${value}) is rejected and removed`, async () => {
        const { challengeId, code } = await createAdminLoginChallenge(fixture.context);
        fixture.sqlite.query(`UPDATE admin_login_challenge SET ${column} = ? WHERE id = ?`).run(value, challengeId);
        const result = await verifyAdminLoginChallenge(fixture.context, challengeId, code);
        expect(result.ok).toBe(false);
        expect(fixture.sqlite.query("SELECT * FROM admin_login_challenge").all()).toEqual([]);
    });
}

test("session TTL remains seven days without Telegram and thirty days with it", async () => {
    const regular = await createAdminSession(fixture.context, false);
    const telegram = await createAdminSession(fixture.context, true);
    expect(regular.ttlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(telegram.ttlMs).toBe(30 * 24 * 60 * 60 * 1000);
});
