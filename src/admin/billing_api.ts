import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import { BillingConfig, normalizeBillingConfig } from "../billing";
import { getSystemConfig, saveSystemConfig } from "../system-config";

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
        return {
            success: true,
            data: normalizeBillingConfig(await getSystemConfig(c)),
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
        const currentSystemConfig = await getSystemConfig(c);
        const config = normalizeBillingConfig(body);

        await saveSystemConfig(c, {
            ...currentSystemConfig,
            displayDecimals: config.displayDecimals,
        });

        return {
            success: true,
            data: config,
            message: "Billing config updated successfully",
        } as CommonResponse;
    }
}
