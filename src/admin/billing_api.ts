import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CONSTANTS } from "../constants";
import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import { BillingConfig, normalizeBillingConfig } from "../billing";
import { getJsonSetting, saveSetting } from "../utils";

const billingConfigSchema = z.object({
    displayDecimals: z.number().int().min(0).max(9),
});

export class BillingConfigGetEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get billing display configuration",
        responses: {
            ...CommonSuccessfulResponse(billingConfigSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const billingConfig = await getJsonSetting<BillingConfig>(
            c,
            CONSTANTS.BILLING_CONFIG_KEY
        );

        return {
            success: true,
            data: normalizeBillingConfig(billingConfig),
        } as CommonResponse;
    }
}

export class BillingConfigUpdateEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Update billing display configuration",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: billingConfigSchema,
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(billingConfigSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const body = await c.req.json<BillingConfig>();
        const config = normalizeBillingConfig(body);

        await saveSetting(
            c,
            CONSTANTS.BILLING_CONFIG_KEY,
            JSON.stringify(config)
        );

        return {
            success: true,
            data: config,
            message: "Billing config updated successfully",
        } as CommonResponse;
    }
}
