import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import {
    AnalyticsQueryValidationError,
    queryUsageOverview,
    queryUsageTrend,
    queryUsageBreakdown,
    queryUsageEvents,
    queryUsageLogRecords,
} from "../analytics/query";

const rangeSchema = z.enum(["24h", "7d", "30d", "90d"]).optional();

const toErrorResponse = (
    c: Context<HonoCustomType>,
    error: unknown,
    fallbackMessage: string
) => {
    const message = error instanceof Error ? error.message : fallbackMessage;
    const status = error instanceof AnalyticsQueryValidationError ? 400 : 500;
    return c.text(message, status);
};

export class AnalyticsOverviewEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get usage analytics overview",
        request: {
            query: z.object({
                range: rangeSchema,
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageOverview(c, c.req.query("range"));
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query analytics overview");
        }
    }
}

export class AnalyticsTrendEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get usage analytics time series",
        request: {
            query: z.object({
                range: rangeSchema,
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageTrend(c, c.req.query("range"));
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query analytics trend");
        }
    }
}

export class AnalyticsBreakdownEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get usage analytics breakdown",
        request: {
            query: z.object({
                range: rangeSchema,
                dimension: z.enum(["token", "channel", "model", "provider"]).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageBreakdown(
                c,
                c.req.query("range"),
                c.req.query("dimension")
            );
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query analytics breakdown");
        }
    }
}

export class AnalyticsEventsEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get recent usage analytics samples",
        request: {
            query: z.object({
                range: rangeSchema,
                limit: z.coerce.number().min(1).max(100).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageEvents(
                c,
                c.req.query("range"),
                c.req.query("limit")
            );
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query analytics events");
        }
    }
}

export class UsageLogSearchEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Search usage logs with custom filters",
        request: {
            query: z.object({
                start: z.string().optional(),
                end: z.string().optional(),
                dimension: z.enum([
                    "route",
                    "token",
                    "channel",
                    "model",
                    "provider",
                    "requestId",
                    "traceId",
                    "clientIp",
                    "userAgent",
                    "country",
                    "region",
                    "city",
                    "colo",
                    "timezone",
                    "result",
                    "errorCode",
                    "errorSummary",
                ]).optional(),
                keyword: z.string().optional(),
                result: z.enum(["all", "success", "failure"]).optional(),
                page: z.coerce.number().int().min(1).max(1000).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageLogRecords(c, {
                start: c.req.query("start"),
                end: c.req.query("end"),
                dimension: c.req.query("dimension"),
                keyword: c.req.query("keyword"),
                result: c.req.query("result"),
                page: c.req.query("page"),
            });
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query usage logs");
        }
    }
}
