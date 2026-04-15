import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import {
    buildTelegramVerificationFingerprint,
    getSystemConfig,
    isTelegramSecurityEnabled,
    normalizeAdminSecurityConfig,
    normalizeSystemConfig,
    saveSystemConfig,
} from "../system-config";
import { sendTelegramTestNotification } from "./auth_shared";
import { t } from "../i18n";

const adminSecurityConfigSchema = z.object({
    enabled: z.boolean(),
    telegramBotToken: z.string(),
    telegramChatId: z.string(),
    verifiedFingerprint: z.string(),
    verifiedAt: z.nullable(z.string()),
});

const apiDocsConfigSchema = z.object({
    enabled: z.boolean(),
});

const systemConfigSchema = z.object({
    displayDecimals: z.number().int().min(0).max(9),
    adminSecurity: adminSecurityConfigSchema,
    apiDocs: apiDocsConfigSchema,
});

const telegramTestRequestSchema = z.object({
    telegramBotToken: z.string().trim().min(1, "Bot Token 不能为空"),
    telegramChatId: z.string().trim().min(1, "Chat ID 不能为空"),
});

const telegramTestResponseSchema = z.object({
    verifiedFingerprint: z.string(),
    verifiedAt: z.string(),
});

const ensureSystemConfigValid = (config: SystemConfig, lang: string) => {
    if (
        config.adminSecurity.enabled
        && !isTelegramSecurityEnabled(config.adminSecurity)
    ) {
        throw new Error(t(lang, "system.telegramConfigRequired"));
    }
};

export class SystemConfigGetEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get system configuration",
        responses: {
            ...CommonSuccessfulResponse(systemConfigSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        return {
            success: true,
            data: await getSystemConfig(c),
        } as CommonResponse;
    }
}

export class SystemConfigUpdateEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Update system configuration",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: systemConfigSchema,
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(systemConfigSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const body = await c.req.json<SystemConfig>();
        const config = normalizeSystemConfig(body);
        const lang = c.get('lang') || 'zh-CN';

        try {
            ensureSystemConfigValid(config, lang);
        } catch (error) {
            return c.text(
                error instanceof Error ? error.message : t(lang, "system.configInvalid"),
                400
            );
        }

        return {
            success: true,
            data: await saveSystemConfig(c, config),
            message: "System config updated successfully",
        } as CommonResponse;
    }
}

export class TelegramTestMessageEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Send Telegram test notification",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: telegramTestRequestSchema,
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(telegramTestResponseSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const lang = c.get('lang') || 'zh-CN';
        const parsedBody = telegramTestRequestSchema.safeParse(
            await c.req.json<Pick<AdminSecurityConfig, "telegramBotToken" | "telegramChatId">>()
        );
        if (!parsedBody.success) {
            return c.text(parsedBody.error.issues[0]?.message || t(lang, "system.telegramConfigInvalid"), 400);
        }

        const body = parsedBody.data;
        const securityConfig = {
            ...normalizeAdminSecurityConfig(body),
            enabled: true,
        } satisfies AdminSecurityConfig;

        if (!isTelegramSecurityEnabled(securityConfig)) {
            return c.text(t(lang, "system.fillBotTokenAndChatId"), 400);
        }

        try {
            await sendTelegramTestNotification(securityConfig, c);
        } catch (error) {
            return c.text(
                t(lang, "system.telegramTestFailed", {
                    error: error instanceof Error ? error.message : "unknown error",
                }),
                500
            );
        }

        return {
            success: true,
            data: {
                verifiedFingerprint: buildTelegramVerificationFingerprint(
                    securityConfig.telegramBotToken,
                    securityConfig.telegramChatId
                ),
                verifiedAt: new Date().toISOString(),
            },
            message: "Telegram test message sent successfully",
        } as CommonResponse;
    }
}
