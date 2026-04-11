import { Context } from "hono";

import { CONSTANTS } from "../constants";
import { getJsonSetting } from "../utils";

type UsageCostResult = {
    totalCost: number;
    requestCost: number;
    inputCost: number;
    outputCost: number;
    cacheCost: number;
    hasPricing: boolean;
}

// Token 工具对象
export const TokenUtils = {
    async updateUsage(c: Context<HonoCustomType>, key: string, usageAmount: number): Promise<boolean> {
        try {
            const result = await c.env.DB.prepare(
                `UPDATE api_token SET usage = usage + ?, updated_at = datetime('now') WHERE key = ?`
            ).bind(usageAmount, key).run();

            return result.success;
        } catch (error) {
            console.error('Error updating token usage:', error);
            return false;
        }
    },
    async getPricing(c: Context<HonoCustomType>, model: string, channelConfig: ChannelConfig): Promise<ModelPricing | null> {
        // Check channel-specific pricing first
        if (channelConfig?.model_pricing?.[model]) {
            return channelConfig.model_pricing[model];
        }

        // Fallback to global pricing
        const globalPricingMap = await getJsonSetting(c, CONSTANTS.MODEL_PRICING_KEY);
        return globalPricingMap?.[model] || null;
    },

    async calculateUsageCost(
        c: Context<HonoCustomType>,
        model: string,
        targetChannelConfig: ChannelConfig,
        usage: Usage
    ): Promise<UsageCostResult> {
        const pricing = await this.getPricing(c, model, targetChannelConfig);
        const hasTokens = usage.prompt_tokens != null && usage.completion_tokens != null;
        const requestCost = pricing?.request || 0;

        if (!pricing || (!hasTokens && requestCost <= 0)) {
            return {
                totalCost: 0,
                requestCost,
                inputCost: 0,
                outputCost: 0,
                cacheCost: 0,
                hasPricing: false,
            };
        }

        const inputCost = hasTokens ? usage.prompt_tokens! * pricing.input : 0;
        const outputCost = hasTokens ? usage.completion_tokens! * pricing.output : 0;

        let cacheCost = 0;
        if (hasTokens && usage.cached_tokens && usage.cached_tokens > 0 && pricing.cache) {
            cacheCost = usage.cached_tokens * pricing.cache;
        }

        return {
            totalCost: inputCost + outputCost + cacheCost + requestCost,
            requestCost,
            inputCost,
            outputCost,
            cacheCost,
            hasPricing: true,
        };
    },

    async processUsage(
        c: Context<HonoCustomType>,
        apiKey: string,
        model: string,
        targetChannelKey: string,
        targetChannelConfig: ChannelConfig,
        usage: Usage
    ): Promise<UsageCostResult> {
        console.log("Usage data:", usage);

        const costResult = await this.calculateUsageCost(c, model, targetChannelConfig, usage);

        if (costResult.hasPricing) {
            await this.updateUsage(c, apiKey, costResult.totalCost);

            const maskedApiKey = apiKey.length < 3 ? '*'.repeat(apiKey.length) : (
                apiKey.slice(0, apiKey.length / 3)
                + '*'.repeat(apiKey.length / 3)
                + apiKey.slice((2 * apiKey.length) / 3)
            );
            console.log(
                `Model: ${model}, Channel: ${targetChannelKey}, apiKey: ${maskedApiKey}, `
                + `Cost: ${costResult.totalCost} (request: ${costResult.requestCost}, `
                + `input: ${costResult.inputCost}, cache: ${costResult.cacheCost}, `
                + `output: ${costResult.outputCost})`
            );
        } else {
            console.warn(`No pricing found for model: ${model} in channel: ${targetChannelKey}`);
        }

        return costResult;
    }
};
