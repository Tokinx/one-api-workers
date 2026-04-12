import { Context } from "hono"
import { contentJson, OpenAPIRoute } from 'chanfana';
import { z } from 'zod';

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import {
    DEFAULT_CLAUDE_API_VERSION,
    type NormalizedChannelConfig,
    normalizeChannelConfig,
    sanitizeChannelConfig,
} from "../channel-config";
import { buildAzureTargetUrlFromPath } from "../providers/shared/azure-target-url";
import { buildPrefixedTargetUrl } from "../providers/shared/prefixed-target-url";

const ChannelModelSchema = z.object({
    id: z.string().describe('Upstream model ID'),
    name: z.string().describe('External model name exposed by this proxy'),
    enabled: z.boolean().optional().describe('Whether this model is available for routing'),
});

const parseFetchedModels = (payload: any): ChannelModelMapping[] => {
    const rawModels = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.models)
                ? payload.models
                : [];

    const normalizedModels: ChannelModelMapping[] = [];
    const seenIds = new Set<string>();

    for (const rawModel of rawModels) {
        if (typeof rawModel === "string") {
            const id = rawModel.trim();
            if (!id || seenIds.has(id)) {
                continue;
            }
            seenIds.add(id);
            normalizedModels.push({ id, name: id, enabled: true });
            continue;
        }

        if (!rawModel || typeof rawModel !== "object") {
            continue;
        }

        const id = (
            typeof rawModel.id === "string" ? rawModel.id
                : typeof rawModel.model === "string" ? rawModel.model
                    : typeof rawModel.name === "string" ? rawModel.name
                        : ""
        ).trim();

        if (!id || seenIds.has(id)) {
            continue;
        }

        const name = (
            typeof rawModel.display_name === "string" ? rawModel.display_name
                : typeof rawModel.name === "string" ? rawModel.name
                    : id
        ).trim() || id;

        seenIds.add(id);
        normalizedModels.push({ id, name: name || id, enabled: true });
    }

    return normalizedModels;
};

const buildModelsFetchRequest = (
    config: NormalizedChannelConfig,
    apiKey: string
): Request => {
    let targetUrl: URL;
    const headers = new Headers({
        "Accept": "application/json",
    });

    switch (config.type) {
        case "azure-openai":
        case "azure-openai-audio":
        case "azure-openai-responses":
            targetUrl = buildAzureTargetUrlFromPath(config.endpoint, "/v1/models");
            headers.set("api-key", apiKey);
            break;
        case "claude":
            targetUrl = buildPrefixedTargetUrl(config.endpoint, "/v1/models");
            headers.set("x-api-key", apiKey);
            headers.set("anthropic-version", DEFAULT_CLAUDE_API_VERSION);
            break;
        case "openai":
        case "gemini":
        case "openai-audio":
        case "openai-responses":
        case "claude-to-openai":
        default:
            targetUrl = buildPrefixedTargetUrl(config.endpoint, "/v1/models", "/v1", config.type);
            headers.set("Authorization", `Bearer ${apiKey}`);
            break;
    }

    return new Request(targetUrl, {
        method: "GET",
        headers,
    });
};

const fetchModelsFromChannel = async (
    config: ChannelConfig
): Promise<ChannelModelMapping[]> => {
    const normalizedConfig = normalizeChannelConfig(config);

    if (!normalizedConfig.endpoint || !normalizedConfig.type) {
        throw new Error("Channel endpoint and type are required");
    }

    if (normalizedConfig.api_keys.length === 0) {
        throw new Error("At least one API key is required");
    }

    let lastError = "Failed to fetch models from upstream";

    for (const apiKey of normalizedConfig.api_keys) {
        const response = await fetch(buildModelsFetchRequest(normalizedConfig, apiKey));

        if (!response.ok) {
            const errorText = await response.text();
            lastError = errorText || `Upstream returned ${response.status}`;
            continue;
        }

        const responseJson = await response.json();
        return parseFetchedModels(responseJson);
    }

    throw new Error(lastError);
};

// 获取所有 Channel 配置
export class ChannelGetEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Get all channel configurations',
        responses: {
            ...CommonSuccessfulResponse(z.array(z.object({
                key: z.string(),
                value: z.string(),
                created_at: z.string(),
                updated_at: z.string(),
            }))),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const result = await c.env.DB.prepare(
            `SELECT * FROM channel_config
             ORDER BY
             COALESCE(CAST(json_extract(value, '$.weight') AS INTEGER), 0) DESC,
             datetime(created_at) DESC,
             key ASC`
        ).all<ChannelConfigRow>();

        return {
            success: true,
            data: result.results
        } as CommonResponse;
    }
}

// 创建或更新 Channel 配置
export class ChannelUpsertEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Create or update channel configuration',
        request: {
            params: z.object({
                key: z.string().describe('Channel key'),
            }),
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            name: z.string().describe('Channel name'),
                            type: z.string().describe('Channel type'),
                            endpoint: z.string().describe('API endpoint'),
                            enabled: z.boolean().optional().describe('Whether this channel participates in request routing'),
                            weight: z.number().int().min(0).max(5).optional().describe('Priority weight for channel routing'),
                            api_key: z.string().optional().describe('Deprecated single API key'),
                            api_keys: z.array(z.string()).optional().describe('API keys, one request will pick one randomly'),
                            auto_retry: z.boolean().optional().describe('Automatically retry the channel up to 3 times on retryable failures'),
                            auto_rotate: z.boolean().optional().describe('When retrying, randomly rotate to other API keys in the same channel'),
                            models: z.array(ChannelModelSchema).optional().describe('External model name to upstream model ID mappings'),
                            supported_models: z.array(z.string()).optional().describe('Deprecated supported request model list'),
                            deployment_mapper: z.record(z.string(), z.string()).optional().describe('Deprecated model deployment mapping'),
                            model_pricing: z.record(z.string(), z.object({
                                input: z.number().describe('Input token price per 1000 tokens'),
                                output: z.number().describe('Output token price per 1000 tokens'),
                                cache: z.number().optional().describe('Cache token price per 1000 tokens'),
                                request: z.number().optional().describe('Fixed request price'),
                            })).optional().describe('Custom model pricing for this channel'),
                        }),
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
        const { key } = c.req.param();
        const rawConfig = await c.req.json<ChannelConfig>();
        const config = sanitizeChannelConfig(rawConfig);

        if (!config.name || !config.endpoint) {
            return c.text('Channel name and endpoint are required', 400);
        }

        if (!config.api_keys || config.api_keys.length === 0) {
            return c.text('At least one API key is required', 400);
        }

        // Upsert channel config directly using SQL
        // excluded.value 指的是 INSERT 语句中要插入的新值
        // 当发生冲突时，用新值更新现有记录
        const result = await c.env.DB.prepare(
            `INSERT INTO channel_config (key, value)
             VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = datetime('now')`
        ).bind(key, JSON.stringify(config)).run();

        if (!result.success) {
            return c.text('Failed to upsert channel config', 500);
        }

        return {
            success: true,
            data: true
        } as CommonResponse;
    }
}

export class ChannelFetchModelsEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Fetch upstream model list for a channel config',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            name: z.string().optional(),
                            type: z.string().optional(),
                            endpoint: z.string().optional(),
                            enabled: z.boolean().optional(),
                            weight: z.number().int().min(0).max(5).optional(),
                            api_key: z.string().optional(),
                            api_keys: z.array(z.string()).optional(),
                            auto_retry: z.boolean().optional(),
                            auto_rotate: z.boolean().optional(),
                            models: z.array(ChannelModelSchema).optional(),
                            supported_models: z.array(z.string()).optional(),
                            deployment_mapper: z.record(z.string(), z.string()).optional(),
                            model_pricing: z.record(z.string(), z.object({
                                input: z.number(),
                                output: z.number(),
                                cache: z.number().optional(),
                                request: z.number().optional(),
                            })).optional(),
                        }),
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(z.array(ChannelModelSchema)),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const rawConfig = await c.req.json<ChannelConfig>();

        try {
            const models = await fetchModelsFromChannel(rawConfig);
            return {
                success: true,
                data: models,
            } as CommonResponse;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to fetch models";
            return c.text(message, 502);
        }
    }
}

// 删除 Channel 配置
export class ChannelDeleteEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Delete channel configuration',
        request: {
            params: z.object({
                key: z.string().describe('Channel key'),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.boolean()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const { key } = c.req.param();

        // Delete channel config directly using SQL
        const result = await c.env.DB.prepare(
            `DELETE FROM channel_config WHERE key = ?`
        ).bind(key).run();

        return {
            success: true,
            data: result.success
        } as CommonResponse;
    }
}
