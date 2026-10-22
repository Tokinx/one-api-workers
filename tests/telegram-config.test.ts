import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import db from "../src/db";
import { api as adminApi } from "../src/admin";
import { createAdminSession } from "../src/admin/auth_shared";
import { buildTelegramVerificationFingerprint, getSystemConfig, saveSystemConfig } from "../src/system-config";
import { createTestDatabase } from "./helpers/sqlite-d1";

const app = new Hono<HonoCustomType>().route("/", adminApi);
const token = "fixture-bot-token";
const chatId = "fixture-chat";
const verified: AdminSecurityConfig = {
    enabled: true, telegramBotToken: token, telegramChatId: chatId,
    verifiedFingerprint: buildTelegramVerificationFingerprint(token, chatId),
    verifiedAt: "2026-10-22T00:00:00.000Z",
};
let fixture: ReturnType<typeof createTestDatabase>;
let cookie: string;
let original: SystemConfig;

beforeEach(async () => {
    fixture = createTestDatabase();
    fixture.context.env.ADMIN_TOKEN = "fixture-admin-token";
    await db.migrate(fixture.context);
    original = await saveSystemConfig(fixture.context, { displayDecimals: 6, adminSecurity: verified, apiDocs: { enabled: true } });
    const session = await createAdminSession(fixture.context, true);
    cookie = `oaw_admin_session=${session.sessionToken}`;
});
afterEach(() => fixture.close());

const update = (security: AdminSecurityConfig) => app.request("/api/admin/system/config", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ displayDecimals: 2, adminSecurity: security, apiDocs: { enabled: false } }),
}, fixture.context.env);

for (const [label, invalid] of [
    ["missing Bot Token", { telegramBotToken: "" }],
    ["missing Chat ID", { telegramChatId: "" }],
    ["missing verification fingerprint", { verifiedFingerprint: "" }],
    ["missing verification timestamp", { verifiedAt: null }],
    ["mismatched fingerprint", { verifiedFingerprint: "outdated-fingerprint" }],
    ["changed credentials", { telegramBotToken: "changed-token" }],
] as const) {
    test(`enabling Telegram with ${label} returns 400 and preserves existing protection`, async () => {
        const before = fixture.sqlite.query("SELECT * FROM settings ORDER BY key").all();
        const response = await update({ ...verified, ...invalid });
        expect(response.status).toBe(400);
        expect(await response.text()).toContain("成功发送测试消息");
        expect(await getSystemConfig(fixture.context)).toEqual(original);
        expect(fixture.sqlite.query("SELECT * FROM settings ORDER BY key").all()).toEqual(before);

        const headerOnly = await app.request("/api/admin/system/config", {
            headers: { "x-admin-token": "fixture-admin-token" },
        }, fixture.context.env);
        expect(headerOnly.status).toBe(401);
    });
}

test("verified Telegram configuration can be enabled and returned as enabled", async () => {
    await saveSystemConfig(fixture.context, { ...original, adminSecurity: { ...verified, enabled: false } });
    const response = await update(verified);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data.adminSecurity.enabled).toBe(true);
    expect((await getSystemConfig(fixture.context)).adminSecurity.enabled).toBe(true);
});

test("explicitly disabling Telegram remains supported without verification metadata", async () => {
    const response = await update({ ...verified, enabled: false, verifiedFingerprint: "", verifiedAt: null });
    expect(response.status).toBe(200);
    expect((await getSystemConfig(fixture.context)).adminSecurity.enabled).toBe(false);
    const headerOnly = await app.request("/api/admin/system/config", {
        headers: { "x-admin-token": "fixture-admin-token" },
    }, fixture.context.env);
    expect(headerOnly.status).toBe(200);
});
