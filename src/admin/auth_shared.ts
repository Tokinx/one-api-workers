import { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const ADMIN_SESSION_COOKIE_NAME = "oaw_admin_session";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ADMIN_LOGIN_CHALLENGE_MAX_ATTEMPTS = 5;
const DEFAULT_SYSTEM_TIMEZONE = "Asia/Shanghai";
const LOCAL_DEV_HOSTNAMES = new Set(["0.0.0.0", "127.0.0.1", "::1", "localhost"]);

type LoginRequestMetadata = {
    clientIp: string;
    country: string;
    region: string;
    city: string;
    colo: string;
    timezone: string;
};

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return "";
};

const formatTimestampInTimezone = (date: Date, timezone: string): string => {
    const formatter = new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    // (${timezone})
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
};

const getRequestMetadata = (c: Context<HonoCustomType>): LoginRequestMetadata => {
    const requestCf = (c.req.raw.cf || {}) as Partial<IncomingRequestCfProperties<unknown>>;

    return {
        clientIp: firstNonEmpty(
            c.req.header("cf-connecting-ip"),
            c.req.header("x-real-ip"),
            c.req.header("x-forwarded-for")?.split(",")[0]
        ),
        country: firstNonEmpty(requestCf.country),
        region: firstNonEmpty(requestCf.region, requestCf.regionCode),
        city: firstNonEmpty(requestCf.city),
        colo: firstNonEmpty(requestCf.colo),
        timezone: firstNonEmpty(requestCf.timezone),
    };
};

const getLocationText = (metadata: LoginRequestMetadata): string => {
    const location = [metadata.country, metadata.region, metadata.city]
        .filter(Boolean)
        .join(" / ");

    return location || "未知位置";
};

const createTelegramMessage = (
    lines: Array<string>
): string => {
    return lines.filter(Boolean).join("\n");
};

const generateNumericCode = (): string => {
    return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
};

const generateSessionToken = (): string => {
    return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
};

const toSha256Hex = async (value: string): Promise<string> => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);

    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

const cleanupExpiredArtifacts = async (c: Context<HonoCustomType>) => {
    const now = new Date().toISOString();

    await Promise.all([
        c.env.DB.prepare(
            `DELETE FROM admin_login_challenge WHERE expires_at <= ?`
        ).bind(now).run(),
        c.env.DB.prepare(
            `DELETE FROM admin_session WHERE expires_at <= ?`
        ).bind(now).run(),
    ]);
};

const sendTelegramMessage = async (
    securityConfig: AdminSecurityConfig,
    text: string
): Promise<void> => {
    const response = await fetch(
        `https://api.telegram.org/bot${securityConfig.telegramBotToken}/sendMessage`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                chat_id: securityConfig.telegramChatId,
                text,
            }),
        }
    );

    const payload = await response.json()
        .catch(() => ({})) as { ok?: boolean; description?: string };

    if (!response.ok || payload.ok !== true) {
        throw new Error(payload.description || `HTTP ${response.status}`);
    }
};

const buildBaseMessageLines = (
    metadata: LoginRequestMetadata,
    occurredAt: Date
): Array<string> => {
    // const clientTimezone = metadata.timezone || DEFAULT_SYSTEM_TIMEZONE;

    return [
        // `时间（客户端）：${formatTimestampInTimezone(occurredAt, clientTimezone)}`,
        `时间：${formatTimestampInTimezone(occurredAt, DEFAULT_SYSTEM_TIMEZONE)}`,
        `位置：${metadata.clientIp || "未知 IP"} （${getLocationText(metadata)}）`,
        // `节点：${metadata.colo || "未知节点"}${metadata.timezone ? ` · ${metadata.timezone}` : ""}`,
    ];
};

const isSecureCookieRequest = (c: Context<HonoCustomType>): boolean => {
    const requestUrl = new URL(c.req.url);
    return requestUrl.protocol === "https:" && !LOCAL_DEV_HOSTNAMES.has(requestUrl.hostname);
};

const buildAdminSessionCookieOptions = (
    c: Context<HonoCustomType>,
    expiresAt?: string
) => {
    return {
        httpOnly: true,
        maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
        path: "/api/admin",
        sameSite: "Lax" as const,
        secure: isSecureCookieRequest(c),
        ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
    };
};

export const getAdminSessionTokenFromRequest = (
    c: Context<HonoCustomType>
): string | null => {
    return getCookie(c, ADMIN_SESSION_COOKIE_NAME) || null;
};

export const setAdminSessionCookie = (
    c: Context<HonoCustomType>,
    sessionToken: string,
    expiresAt: string
): void => {
    setCookie(
        c,
        ADMIN_SESSION_COOKIE_NAME,
        sessionToken,
        buildAdminSessionCookieOptions(c, expiresAt)
    );
};

export const clearAdminSessionCookie = (
    c: Context<HonoCustomType>
): void => {
    deleteCookie(
        c,
        ADMIN_SESSION_COOKIE_NAME,
        buildAdminSessionCookieOptions(c)
    );
};

export const createAdminSession = async (
    c: Context<HonoCustomType>
): Promise<{ sessionToken: string; expiresAt: string }> => {
    await cleanupExpiredArtifacts(c);

    const sessionToken = generateSessionToken();
    const tokenHash = await toSha256Hex(sessionToken);
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();

    await c.env.DB.prepare(
        `INSERT INTO admin_session (token_hash, expires_at)
         VALUES (?, ?)`
    ).bind(tokenHash, expiresAt).run();

    return {
        sessionToken,
        expiresAt,
    };
};

export const invalidateAdminSession = async (
    c: Context<HonoCustomType>,
    sessionToken: string | null | undefined
): Promise<void> => {
    if (!sessionToken) {
        return;
    }

    const tokenHash = await toSha256Hex(sessionToken);

    await c.env.DB.prepare(
        `DELETE FROM admin_session WHERE token_hash = ?`
    ).bind(tokenHash).run();
};

export const validateAdminSession = async (
    c: Context<HonoCustomType>,
    sessionToken: string | null | undefined
): Promise<boolean> => {
    if (!sessionToken) {
        return false;
    }

    await cleanupExpiredArtifacts(c);

    const tokenHash = await toSha256Hex(sessionToken);
    const session = await c.env.DB.prepare(
        `SELECT token_hash, expires_at FROM admin_session WHERE token_hash = ?`
    ).bind(tokenHash).first<Pick<AdminSessionRow, "token_hash" | "expires_at">>();

    if (!session?.token_hash) {
        return false;
    }

    if (Date.parse(session.expires_at) <= Date.now()) {
        await c.env.DB.prepare(
            `DELETE FROM admin_session WHERE token_hash = ?`
        ).bind(tokenHash).run();
        return false;
    }

    await c.env.DB.prepare(
        `UPDATE admin_session
         SET last_used_at = datetime('now'),
             updated_at = datetime('now')
         WHERE token_hash = ?`
    ).bind(tokenHash).run();

    return true;
};

export const createAdminLoginChallenge = async (
    c: Context<HonoCustomType>
): Promise<{ challengeId: string; code: string; expiresAt: string }> => {
    await cleanupExpiredArtifacts(c);

    const challengeId = crypto.randomUUID();
    const code = generateNumericCode();
    const codeHash = await toSha256Hex(code);
    const expiresAt = new Date(Date.now() + ADMIN_LOGIN_CHALLENGE_TTL_MS).toISOString();
    const metadata = getRequestMetadata(c);

    await c.env.DB.prepare(
        `INSERT INTO admin_login_challenge (
            id,
            code_hash,
            expires_at,
            attempts,
            max_attempts,
            request_ip,
            request_country,
            request_region,
            request_city,
            request_colo,
            request_timezone
         ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        challengeId,
        codeHash,
        expiresAt,
        ADMIN_LOGIN_CHALLENGE_MAX_ATTEMPTS,
        metadata.clientIp,
        metadata.country,
        metadata.region,
        metadata.city,
        metadata.colo,
        metadata.timezone
    ).run();

    return {
        challengeId,
        code,
        expiresAt,
    };
};

export const deleteAdminLoginChallenge = async (
    c: Context<HonoCustomType>,
    challengeId: string
): Promise<void> => {
    await c.env.DB.prepare(
        `DELETE FROM admin_login_challenge WHERE id = ?`
    ).bind(challengeId).run();
};

export const verifyAdminLoginChallenge = async (
    c: Context<HonoCustomType>,
    challengeId: string,
    code: string
): Promise<{
    ok: boolean;
    reason?: string;
}> => {
    await cleanupExpiredArtifacts(c);

    const challenge = await c.env.DB.prepare(
        `SELECT * FROM admin_login_challenge WHERE id = ?`
    ).bind(challengeId).first<AdminLoginChallengeRow>();

    if (!challenge?.id) {
        return {
            ok: false,
            reason: "验证码已失效，请重新获取",
        };
    }

    if (Date.parse(challenge.expires_at) <= Date.now()) {
        await deleteAdminLoginChallenge(c, challengeId);
        return {
            ok: false,
            reason: "验证码已过期，请重新获取",
        };
    }

    if ((challenge.attempts || 0) >= (challenge.max_attempts || ADMIN_LOGIN_CHALLENGE_MAX_ATTEMPTS)) {
        await deleteAdminLoginChallenge(c, challengeId);
        return {
            ok: false,
            reason: "验证码尝试次数过多，请重新获取",
        };
    }

    const codeHash = await toSha256Hex(code);

    if (codeHash !== challenge.code_hash) {
        const nextAttempts = (challenge.attempts || 0) + 1;

        if (nextAttempts >= (challenge.max_attempts || ADMIN_LOGIN_CHALLENGE_MAX_ATTEMPTS)) {
            await deleteAdminLoginChallenge(c, challengeId);
            return {
                ok: false,
                reason: "验证码错误，已达到最大尝试次数",
            };
        }

        await c.env.DB.prepare(
            `UPDATE admin_login_challenge
             SET attempts = ?, updated_at = datetime('now')
             WHERE id = ?`
        ).bind(nextAttempts, challengeId).run();

        return {
            ok: false,
            reason: "验证码错误",
        };
    }

    await deleteAdminLoginChallenge(c, challengeId);

    return {
        ok: true,
    };
};

export const sendAdminLoginCodeNotification = async (
    securityConfig: AdminSecurityConfig,
    c: Context<HonoCustomType>,
    code: string,
    expiresAt: string
): Promise<void> => {
    const metadata = getRequestMetadata(c);
    const occurredAt = new Date();
    const expiresDate = new Date(expiresAt);
    const clientTimezone = metadata.timezone || DEFAULT_SYSTEM_TIMEZONE;

    await sendTelegramMessage(
        securityConfig,
        createTelegramMessage([
            "🔐 One API Workers 登录验证",
            `${code} 验证码 5 分钟内有效，过期时间：${formatTimestampInTimezone(expiresDate, clientTimezone)}`,
            ...buildBaseMessageLines(metadata, occurredAt),
        ])
    );
};

export const sendAdminLoginResultNotification = async (
    securityConfig: AdminSecurityConfig,
    c: Context<HonoCustomType>,
    status: "success" | "failure",
    reason?: string
): Promise<void> => {
    const metadata = getRequestMetadata(c);
    const occurredAt = new Date();

    await sendTelegramMessage(
        securityConfig,
        createTelegramMessage([
            "🔐 One API Workers 登录提醒",
            `您的账户在新设备上登录${status === "success" ? "成功" : "失败"}`,
            reason ? `原因：${reason}` : "",
            ...buildBaseMessageLines(metadata, occurredAt),
        ])
    );
};

export const sendTelegramTestNotification = async (
    securityConfig: AdminSecurityConfig,
    c: Context<HonoCustomType>
): Promise<void> => {
    const metadata = getRequestMetadata(c);
    const occurredAt = new Date();

    await sendTelegramMessage(
        securityConfig,
        createTelegramMessage([
            "🔐 One API Workers Telegram 测试",
            "绑定测试成功",
            ...buildBaseMessageLines(metadata, occurredAt),
        ])
    );
};
