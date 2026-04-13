import { Context } from "hono";
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { getJsonSetting, saveSetting } from "../utils";
import { CONSTANTS } from "../constants";
import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";

const pricingModelSchema = z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    cache: z.number().optional(),
    request: z.number().optional(),
});

const toPositiveNumber = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }

    return value > 0 ? value : undefined;
};

const sanitizePricingConfig = (
    config: Record<string, Partial<ModelPricing>> | null | undefined
): Record<string, Partial<ModelPricing>> => {
    if (!config || typeof config !== "object") {
        return {};
    }

    const normalizedEntries: Array<[string, Partial<ModelPricing>]> = [];

    Object.entries(config).forEach(([model, pricing]) => {
        const normalizedModel = model.trim();
        if (!normalizedModel || !pricing || typeof pricing !== "object") {
            return;
        }

        const normalizedPricing: Partial<ModelPricing> = {};
        const input = toPositiveNumber(pricing.input);
        const output = toPositiveNumber(pricing.output);
        const cache = toPositiveNumber(pricing.cache);
        const request = toPositiveNumber(pricing.request);

        if (input !== undefined) {
            normalizedPricing.input = input;
        }
        if (output !== undefined) {
            normalizedPricing.output = output;
        }
        if (cache !== undefined) {
            normalizedPricing.cache = cache;
        }
        if (request !== undefined) {
            normalizedPricing.request = request;
        }

        if (Object.keys(normalizedPricing).length === 0) {
            return;
        }

        normalizedEntries.push([normalizedModel, normalizedPricing]);
    });

    return Object.fromEntries(normalizedEntries);
};

// Pricing 获取配置 API
export class PricingGetEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Get global pricing configuration',
        responses: {
            ...CommonSuccessfulResponse(z.record(z.string(), pricingModelSchema)),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const pricingConfig = await getJsonSetting<Record<string, ModelPricing>>(
            c,
            CONSTANTS.MODEL_PRICING_KEY
        );

        return {
            success: true,
            data: sanitizePricingConfig(pricingConfig)
        } as CommonResponse;
    }
}

// Pricing 更新配置 API
export class PricingUpdateEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Update global pricing configuration',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.record(z.string(), pricingModelSchema),
                    }
                }
            }
        },
        responses: {
            ...CommonSuccessfulResponse(),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const body = await c.req.json<Record<string, Partial<ModelPricing>>>();
        const normalizedConfig = sanitizePricingConfig(body);

        await saveSetting(
            c,
            CONSTANTS.MODEL_PRICING_KEY,
            JSON.stringify(normalizedConfig)
        );

        return {
            success: true,
            message: "Pricing config updated successfully"
        } as CommonResponse;
    }
}
