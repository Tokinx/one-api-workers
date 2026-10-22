import { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const ADMIN_SESSION_COOKIE_NAME = "oaw_admin_session";
const ADMIN_SESSION_TTL_WITHOUT_TELEGRAM_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL_WITH_TELEGRAM_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ADMIN_LOGIN_CHALLENGE_MAX_ATTEMPTS = 5;
const ADMIN_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const ARTIFACT_CLEANUP_INTERVAL_MS = 60_000;
let lastArtifactCleanupAt = 0;
const DEFAULT_SYSTEM_TIMEZONE = "Asia/Shanghai";
const LOCAL_DEV_HOSTNAMES = new Set(["0.0.0.0", "127.0.0.1", "::1", "localhost"]);
const ADMIN_TELEGRAM_CODE_NOTIFY_PER_IP_POLICY = {
    category: "admin-telegram-code:ip",
    maxAttempts: 3,
    windowMs: 10 * 60 * 1000,
    blockDurationMs: 10 * 60 * 1000,
    message: "验证码发送过于频繁，请稍后再试",
} as const;
const ADMIN_TELEGRAM_CODE_NOTIFY_GLOBAL_POLICY = {
    category: "admin-telegram-code:global",
    maxAttempts: 12,
    windowMs: 10 * 60 * 1000,
    blockDurationMs: 10 * 60 * 1000,
    message: "验证码发送过于频繁，请稍后再试",
} as const;
const ADMIN_TELEGRAM_RESULT_FAILURE_PER_IP_POLICY = {
    category: "admin-telegram-result-failure:ip",
    maxAttempts: 2,
    windowMs: 10 * 60 * 1000,
    blockDurationMs: 10 * 60 * 1000,
    message: "登录失败通知发送过于频繁，已自动静默",
} as const;
const ADMIN_TELEGRAM_RESULT_FAILURE_GLOBAL_POLICY = {
    category: "admin-telegram-result-failure:global",
    maxAttempts: 20,
    windowMs: 10 * 60 * 1000,
    blockDurationMs: 10 * 60 * 1000,
    message: "登录失败通知发送过于频繁，已自动静默",
} as const;
const ADMIN_TELEGRAM_RESULT_SUCCESS_PER_IP_POLICY = {
    category: "admin-telegram-result-success:ip",
    maxAttempts: 3,
    windowMs: 30 * 60 * 1000,
    blockDurationMs: 30 * 60 * 1000,
    message: "登录成功通知发送过于频繁，已自动静默",
} as const;
const ADMIN_TELEGRAM_RESULT_SUCCESS_GLOBAL_POLICY = {
    category: "admin-telegram-result-success:global",
    maxAttempts: 20,
    windowMs: 30 * 60 * 1000,
    blockDurationMs: 30 * 60 * 1000,
    message: "登录成功通知发送过于频繁，已自动静默",
} as const;

type LoginRequestMetadata = {
    clientIp: string;
    country: string;
    region: string;
    city: string;
    colo: string;
    timezone: string;
};

type StoredAdminRateLimitRow = {
    attempts: number | null;
    blocked_until: string | null;
    bucket_id: string;
    bucket_key: string;
    category: string;
    last_event_at: string;
    window_started_at: string;
};

type AdminRateLimitPolicy = {
    blockDurationMs: number;
    category: string;
    maxAttempts: number;
    message: string;
    windowMs: number;
};

type AdminRateLimitResult =
    | { ok: true }
    | { ok: false; message: string; retryAfterSeconds: number };

export class AdminRateLimitError extends Error {
    readonly retryAfterSeconds: number;

    constructor(message: string, retryAfterSeconds: number) {
        super(message);
        this.name = "AdminRateLimitError";
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

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

export const getRequestMetadata = (c: Context<HonoCustomType>): LoginRequestMetadata => {
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

const getAdminRateLimitBucketId = (metadata: LoginRequestMetadata): string => {
    return metadata.clientIp || "unknown";
};

const buildAdminRateLimitBucketKey = (
    category: string,
    bucketId: string
): string => {
    return `${category}:${bucketId}`;
};

const toRetryAfterSeconds = (retryAfterMs: number): number => {
    return Math.max(1, Math.ceil(retryAfterMs / 1000));
};

const cleanupExpiredArtifacts = async (c: Context<HonoCustomType>) => {
    // 每次管理员请求都执行三条 DELETE 开销过大，按 isolate 节流到 60s 一次
    const nowMs = Date.now();
    if (nowMs - lastArtifactCleanupAt < ARTIFACT_CLEANUP_INTERVAL_MS) {
        return;
    }
    lastArtifactCleanupAt = nowMs;

    const now = new Date().toISOString();
    const rateLimitRetentionCutoff = new Date(Date.now() - ADMIN_RATE_LIMIT_RETENTION_MS).toISOString();

    await Promise.all([
        c.env.DB.prepare(
            `DELETE FROM admin_login_challenge WHERE expires_at <= ?`
        ).bind(now).run(),
        c.env.DB.prepare(
            `DELETE FROM admin_session WHERE expires_at <= ?`
        ).bind(now).run(),
        c.env.DB.prepare(
            `DELETE FROM admin_rate_limit WHERE last_event_at <= ?`
        ).bind(rateLimitRetentionCutoff).run(),
    ]);
};

export const consumeAdminRateLimit = async (
    c: Context<HonoCustomType>,
    policy: AdminRateLimitPolicy,
    bucketId: string
): Promise<AdminRateLimitResult> => {
    await cleanupExpiredArtifacts(c);

    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const bucketKey = buildAdminRateLimitBucketKey(policy.category, bucketId);
    // Read, increment and decide whether to block in one SQLite statement.
    // Every CASE expression reads the row before this update.
    const blocked = "julianday(blocked_until) > julianday(?4)";
    const sameWindow = "julianday(window_started_at) > julianday(?5)";
    const nextAttempts = `CASE WHEN ${sameWindow} THEN COALESCE(attempts, 0) + 1 ELSE 1 END`;
    const row = await c.env.DB.prepare(
        `INSERT INTO admin_rate_limit (
            bucket_key, category, bucket_id, window_started_at,
            attempts, blocked_until, last_event_at
         ) VALUES (?1, ?2, ?3, ?4, 1, NULL, ?4)
         ON CONFLICT(bucket_key) DO UPDATE SET
            attempts = CASE WHEN ${blocked} THEN attempts ELSE ${nextAttempts} END,
            window_started_at = CASE
                WHEN ${blocked} OR ${sameWindow} THEN window_started_at ELSE ?4 END,
            blocked_until = CASE
                WHEN ${blocked} THEN blocked_until
                WHEN (${nextAttempts}) > ?6 THEN ?7 ELSE NULL END,
            last_event_at = CASE WHEN ${blocked} THEN last_event_at ELSE ?4 END,
            updated_at = datetime('now')
         RETURNING attempts, blocked_until`
    ).bind(
        bucketKey, policy.category, bucketId, nowIso,
        new Date(nowMs - policy.windowMs).toISOString(), policy.maxAttempts,
        new Date(nowMs + policy.blockDurationMs).toISOString()
    ).first<Pick<StoredAdminRateLimitRow, "attempts" | "blocked_until">>();

    if (!row) throw new Error("Failed to consume admin rate limit");
    const blockedUntilMs = row.blocked_until ? Date.parse(row.blocked_until) : Number.NaN;
    if (Number.isFinite(blockedUntilMs) && blockedUntilMs > nowMs) {
        return {
            ok: false,
            message: policy.message,
            retryAfterSeconds: toRetryAfterSeconds(blockedUntilMs - nowMs),
        };
    }

    return { ok: true };
};

export const clearAdminRateLimitBucket = async (
    c: Context<HonoCustomType>,
    category: string,
    bucketId: string
): Promise<void> => {
    await c.env.DB.prepare(
        `DELETE FROM admin_rate_limit WHERE bucket_key = ?`
    ).bind(buildAdminRateLimitBucketKey(category, bucketId)).run();
};

const throwIfAdminRateLimited = async (
    c: Context<HonoCustomType>,
    policy: AdminRateLimitPolicy,
    bucketId: string
): Promise<void> => {
    const result = await consumeAdminRateLimit(c, policy, bucketId);
    if (!result.ok) {
        throw new AdminRateLimitError(result.message, result.retryAfterSeconds);
    }
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

const getAdminSessionTtlMs = (telegramSecurityEnabled: boolean): number => {
    return telegramSecurityEnabled
        ? ADMIN_SESSION_TTL_WITH_TELEGRAM_MS
        : ADMIN_SESSION_TTL_WITHOUT_TELEGRAM_MS;
};

const buildAdminSessionCookieBaseOptions = (
    c: Context<HonoCustomType>
) => {
    return {
        httpOnly: true,
        path: "/api/admin",
        sameSite: "Lax" as const,
        secure: isSecureCookieRequest(c),
    };
};

const buildAdminSessionCookieOptions = (
    c: Context<HonoCustomType>,
    sessionTtlMs: number,
    expiresAt?: string
) => {
    return {
        ...buildAdminSessionCookieBaseOptions(c),
        maxAge: Math.floor(sessionTtlMs / 1000),
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
    expiresAt: string,
    sessionTtlMs: number
): void => {
    setCookie(
        c,
        ADMIN_SESSION_COOKIE_NAME,
        sessionToken,
        buildAdminSessionCookieOptions(c, sessionTtlMs, expiresAt)
    );
};

export const clearAdminSessionCookie = (
    c: Context<HonoCustomType>
): void => {
    deleteCookie(
        c,
        ADMIN_SESSION_COOKIE_NAME,
        buildAdminSessionCookieBaseOptions(c)
    );
};

export const createAdminSession = async (
    c: Context<HonoCustomType>,
    telegramSecurityEnabled = false
): Promise<{ sessionToken: string; expiresAt: string; ttlMs: number }> => {
    await cleanupExpiredArtifacts(c);

    const ttlMs = getAdminSessionTtlMs(telegramSecurityEnabled);
    const sessionToken = generateSessionToken();
    const tokenHash = await toSha256Hex(sessionToken);
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    await c.env.DB.prepare(
        `INSERT INTO admin_session (token_hash, expires_at)
         VALUES (?, ?)`
    ).bind(tokenHash, expiresAt).run();

    return {
        sessionToken,
        expiresAt,
        ttlMs,
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

    const metadata = getRequestMetadata(c);
    const now = new Date().toISOString();
    const codeHash = await toSha256Hex(code);
    const maxAttempts = `COALESCE(NULLIF(max_attempts, 0), ${ADMIN_LOGIN_CHALLENGE_MAX_ATTEMPTS})`;
    // D1 batch is transactional: no other attempt can interleave between the
    // increment and the conditional consume. Only the DELETE winner can log in.
    const [attemptResult, consumeResult] = await c.env.DB.batch<AdminLoginChallengeRow>([
        c.env.DB.prepare(
            `UPDATE admin_login_challenge
             SET attempts = COALESCE(attempts, 0) + 1, updated_at = datetime('now')
             WHERE id = ?1 AND code_hash <> ?2
               AND julianday(expires_at) > julianday(?3)
               AND COALESCE(attempts, 0) < ${maxAttempts}
               AND (COALESCE(request_ip, '') = '' OR ?4 = '' OR request_ip = ?4)
             RETURNING *`
        ).bind(challengeId, codeHash, now, metadata.clientIp),
        c.env.DB.prepare(
            `DELETE FROM admin_login_challenge
             WHERE id = ?1 AND (
                code_hash = ?2
                OR COALESCE(attempts, 0) >= ${maxAttempts}
                OR COALESCE(julianday(expires_at), 0) <= julianday(?3)
                OR (COALESCE(request_ip, '') <> '' AND ?4 <> '' AND request_ip <> ?4)
             )
             RETURNING *`
        ).bind(challengeId, codeHash, now, metadata.clientIp),
    ]);
    const attempted = attemptResult.results[0];
    const consumed = consumeResult.results[0];
    if (!consumed) {
        return { ok: false, reason: attempted ? "验证码错误" : "验证码已失效，请重新获取" };
    }
    if (consumed.request_ip && metadata.clientIp && consumed.request_ip !== metadata.clientIp) {
        return { ok: false, reason: "登录来源已变化，请重新获取验证码" };
    }
    const expiresAtMs = Date.parse(consumed.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.parse(now)) {
        return { ok: false, reason: "验证码已过期，请重新获取" };
    }
    if ((consumed.attempts || 0) >= (consumed.max_attempts || ADMIN_LOGIN_CHALLENGE_MAX_ATTEMPTS)) {
        return {
            ok: false,
            reason: attempted ? "验证码错误，已达到最大尝试次数" : "验证码尝试次数过多，请重新获取",
        };
    }
    return { ok: consumed.code_hash === codeHash };

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
    const bucketId = getAdminRateLimitBucketId(metadata);

    await throwIfAdminRateLimited(
        c,
        ADMIN_TELEGRAM_CODE_NOTIFY_PER_IP_POLICY,
        bucketId
    );
    await throwIfAdminRateLimited(
        c,
        ADMIN_TELEGRAM_CODE_NOTIFY_GLOBAL_POLICY,
        "global"
    );

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
    const bucketId = getAdminRateLimitBucketId(metadata);
    const policies = status === "success"
        ? [ADMIN_TELEGRAM_RESULT_SUCCESS_PER_IP_POLICY, ADMIN_TELEGRAM_RESULT_SUCCESS_GLOBAL_POLICY]
        : [ADMIN_TELEGRAM_RESULT_FAILURE_PER_IP_POLICY, ADMIN_TELEGRAM_RESULT_FAILURE_GLOBAL_POLICY];

    for (const policy of policies) {
        const result = await consumeAdminRateLimit(
            c,
            policy,
            policy.category.endsWith(":global") ? "global" : bucketId
        );

        if (!result.ok) {
            console.warn(`Skipped Telegram login ${status} notification due to rate limit: ${policy.category}`);
            return;
        }
    }

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
