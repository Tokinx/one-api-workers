import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import {
    getSystemConfig,
    isTelegramSecurityEnabled,
    normalizeAdminSecurityConfig,
    normalizeSystemConfig,
    saveSystemConfig,
} from "../system-config";
import { sendTelegramTestNotification } from "./auth_shared";

const adminSecurityConfigSchema = z.object({
    enabled: z.boolean(),
    telegramBotToken: z.string(),
    telegramChatId: z.string(),
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

const ensureSystemConfigValid = (config: SystemConfig) => {
    if (
        config.adminSecurity.enabled
        && !isTelegramSecurityEnabled(config.adminSecurity)
    ) {
        throw new Error("开启 Telegram 验证前，请先填写 Bot Token 和 Chat ID");
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

        try {
            ensureSystemConfigValid(config);
        } catch (error) {
            return c.text(
                error instanceof Error ? error.message : "系统设置无效",
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
            ...CommonSuccessfulResponse(z.boolean()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const parsedBody = telegramTestRequestSchema.safeParse(
            await c.req.json<Pick<AdminSecurityConfig, "telegramBotToken" | "telegramChatId">>()
        );
        if (!parsedBody.success) {
            return c.text(parsedBody.error.issues[0]?.message || "Telegram 配置无效", 400);
        }

        const body = parsedBody.data;
        const securityConfig = {
            ...normalizeAdminSecurityConfig(body),
            enabled: true,
        } satisfies AdminSecurityConfig;

        if (!isTelegramSecurityEnabled(securityConfig)) {
            return c.text("请先填写有效的 Bot Token 和 Chat ID", 400);
        }

        try {
            await sendTelegramTestNotification(securityConfig, c);
        } catch (error) {
            return c.text(
                `Telegram 测试消息发送失败：${error instanceof Error ? error.message : "unknown error"}`,
                500
            );
        }

        return {
            success: true,
            data: true,
            message: "Telegram test message sent successfully",
        } as CommonResponse;
    }
}
