import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import { getSystemConfig, isTelegramSecurityEnabled } from "../system-config";
import {
    AdminRateLimitError,
    clearAdminRateLimitBucket,
    clearAdminSessionCookie,
    consumeAdminRateLimit,
    createAdminLoginChallenge,
    createAdminSession,
    deleteAdminLoginChallenge,
    getRequestMetadata,
    getAdminSessionTokenFromRequest,
    invalidateAdminSession,
    setAdminSessionCookie,
    sendAdminLoginCodeNotification,
    sendAdminLoginResultNotification,
    verifyAdminLoginChallenge,
} from "./auth_shared";

const ADMIN_LOGIN_START_ATTEMPT_POLICY = {
    category: "admin-login-start:attempt",
    maxAttempts: 6,
    windowMs: 10 * 60 * 1000,
    blockDurationMs: 15 * 60 * 1000,
    message: "管理员登录请求过于频繁，请稍后再试",
} as const;
const ADMIN_LOGIN_START_FAILURE_POLICY = {
    category: "admin-login-start:failure",
    maxAttempts: 5,
    windowMs: 30 * 60 * 1000,
    blockDurationMs: 30 * 60 * 1000,
    message: "管理员登录失败次数过多，请稍后再试",
} as const;
const ADMIN_LOGIN_VERIFY_ATTEMPT_POLICY = {
    category: "admin-login-verify:attempt",
    maxAttempts: 8,
    windowMs: 10 * 60 * 1000,
    blockDurationMs: 15 * 60 * 1000,
    message: "验证码验证请求过于频繁，请稍后再试",
} as const;
const ADMIN_LOGIN_VERIFY_FAILURE_POLICY = {
    category: "admin-login-verify:failure",
    maxAttempts: 6,
    windowMs: 30 * 60 * 1000,
    blockDurationMs: 30 * 60 * 1000,
    message: "验证码验证失败次数过多，请稍后再试",
} as const;

const buildRateLimitedResponse = (
    c: Context<HonoCustomType>,
    message: string,
    retryAfterSeconds: number
) => {
    c.header("Retry-After", String(retryAfterSeconds));
    return c.text(message, 429);
};

const loginStartRequestSchema = z.object({
    token: z.string().trim().min(1, "管理员令牌不能为空"),
});

const loginStartResponseSchema = z.object({
    requiresVerification: z.boolean(),
    challengeId: z.nullable(z.string()),
    challengeExpiresAt: z.nullable(z.string()),
    sessionToken: z.nullable(z.string()),
    sessionExpiresAt: z.nullable(z.string()),
});

const loginVerifyRequestSchema = z.object({
    challengeId: z.string().trim().min(1, "challengeId 不能为空"),
    code: z.string().trim().regex(/^\d{6}$/, "验证码必须为 6 位数字"),
});

const buildDirectLoginResponse = async (
    c: Context<HonoCustomType>
) => {
    const session = await createAdminSession(c);
    setAdminSessionCookie(c, session.sessionToken, session.expiresAt);

    return {
        success: true,
        data: {
            requiresVerification: false,
            challengeId: null,
            challengeExpiresAt: null,
            sessionToken: null,
            sessionExpiresAt: session.expiresAt,
        },
        message: "Login successful",
    } as CommonResponse;
};

export class AdminLoginStartEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Start admin login",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: loginStartRequestSchema,
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(loginStartResponseSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const parsedBody = loginStartRequestSchema.safeParse(
            await c.req.json<{ token: string }>()
        );
        if (!parsedBody.success) {
            return c.text(parsedBody.error.issues[0]?.message || "管理员令牌不能为空", 400);
        }

        const body = parsedBody.data;
        const metadata = getRequestMetadata(c);
        const rateLimitBucketId = metadata.clientIp || "unknown";
        const startAttemptLimit = await consumeAdminRateLimit(
            c,
            ADMIN_LOGIN_START_ATTEMPT_POLICY,
            rateLimitBucketId
        );
        if (!startAttemptLimit.ok) {
            return buildRateLimitedResponse(
                c,
                startAttemptLimit.message,
                startAttemptLimit.retryAfterSeconds
            );
        }

        const systemConfig = await getSystemConfig(c);
        const securityConfig = systemConfig.adminSecurity;
        const securityEnabled = isTelegramSecurityEnabled(securityConfig);

        if (!c.env.ADMIN_TOKEN || body.token !== c.env.ADMIN_TOKEN) {
            const failureLimit = await consumeAdminRateLimit(
                c,
                ADMIN_LOGIN_START_FAILURE_POLICY,
                rateLimitBucketId
            );

            if (securityEnabled) {
                await sendAdminLoginResultNotification(
                    securityConfig,
                    c,
                    "failure",
                    "管理员令牌错误"
                ).catch((error) => {
                    console.error("Failed to send Telegram login failure notification:", error);
                });
            }

            if (!failureLimit.ok) {
                return buildRateLimitedResponse(
                    c,
                    failureLimit.message,
                    failureLimit.retryAfterSeconds
                );
            }

            return c.text("管理员令牌无效", 401);
        }

        await clearAdminRateLimitBucket(
            c,
            ADMIN_LOGIN_START_FAILURE_POLICY.category,
            rateLimitBucketId
        );

        if (!securityEnabled) {
            return buildDirectLoginResponse(c);
        }

        const challenge = await createAdminLoginChallenge(c);

        try {
            await sendAdminLoginCodeNotification(
                securityConfig,
                c,
                challenge.code,
                challenge.expiresAt
            );
        } catch (error) {
            await deleteAdminLoginChallenge(c, challenge.challengeId);

            if (error instanceof AdminRateLimitError) {
                return buildRateLimitedResponse(
                    c,
                    error.message,
                    error.retryAfterSeconds
                );
            }

            return c.text(
                `Telegram 发送验证码失败：${error instanceof Error ? error.message : "unknown error"}`,
                500
            );
        }

        return {
            success: true,
            data: {
                requiresVerification: true,
                challengeId: challenge.challengeId,
                challengeExpiresAt: challenge.expiresAt,
                sessionToken: null,
                sessionExpiresAt: null,
            },
            message: "Verification code sent",
        } as CommonResponse;
    }
}

export class AdminLoginVerifyEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Verify admin login code",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: loginVerifyRequestSchema,
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(loginStartResponseSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const parsedBody = loginVerifyRequestSchema.safeParse(
            await c.req.json<{ challengeId: string; code: string }>()
        );
        if (!parsedBody.success) {
            return c.text(parsedBody.error.issues[0]?.message || "验证码格式无效", 400);
        }

        const body = parsedBody.data;
        const metadata = getRequestMetadata(c);
        const rateLimitBucketId = metadata.clientIp || "unknown";
        const verifyAttemptLimit = await consumeAdminRateLimit(
            c,
            ADMIN_LOGIN_VERIFY_ATTEMPT_POLICY,
            rateLimitBucketId
        );
        if (!verifyAttemptLimit.ok) {
            return buildRateLimitedResponse(
                c,
                verifyAttemptLimit.message,
                verifyAttemptLimit.retryAfterSeconds
            );
        }

        const systemConfig = await getSystemConfig(c);
        const securityConfig = systemConfig.adminSecurity;

        if (!isTelegramSecurityEnabled(securityConfig)) {
            return c.text("当前未开启 Telegram 登录验证", 400);
        }

        const result = await verifyAdminLoginChallenge(
            c,
            body.challengeId,
            body.code
        );

        if (!result.ok) {
            const failureLimit = await consumeAdminRateLimit(
                c,
                ADMIN_LOGIN_VERIFY_FAILURE_POLICY,
                rateLimitBucketId
            );
            await sendAdminLoginResultNotification(
                securityConfig,
                c,
                "failure",
                result.reason
            ).catch((error) => {
                console.error("Failed to send Telegram login failure notification:", error);
            });

            if (!failureLimit.ok) {
                return buildRateLimitedResponse(
                    c,
                    failureLimit.message,
                    failureLimit.retryAfterSeconds
                );
            }

            return c.text(result.reason || "验证码验证失败", 401);
        }

        await Promise.all([
            clearAdminRateLimitBucket(
                c,
                ADMIN_LOGIN_START_FAILURE_POLICY.category,
                rateLimitBucketId
            ),
            clearAdminRateLimitBucket(
                c,
                ADMIN_LOGIN_VERIFY_FAILURE_POLICY.category,
                rateLimitBucketId
            ),
        ]);

        const session = await createAdminSession(c);
        setAdminSessionCookie(c, session.sessionToken, session.expiresAt);

        await sendAdminLoginResultNotification(
            securityConfig,
            c,
            "success"
        ).catch((error) => {
            console.error("Failed to send Telegram login success notification:", error);
        });

        return {
            success: true,
            data: {
                requiresVerification: false,
                challengeId: null,
                challengeExpiresAt: null,
                sessionToken: null,
                sessionExpiresAt: session.expiresAt,
            },
            message: "Login verified successfully",
        } as CommonResponse;
    }
}

export class AdminLogoutEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Logout admin session",
        responses: {
            ...CommonSuccessfulResponse(z.boolean()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const sessionToken = getAdminSessionTokenFromRequest(c);

        await invalidateAdminSession(c, sessionToken);
        clearAdminSessionCookie(c);

        return {
            success: true,
            data: true,
            message: "Logout successful",
        } as CommonResponse;
    }
}
