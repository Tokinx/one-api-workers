import { Context } from "hono"
import { getApiKeyFromHeaders, fetchTokenData, fetchChannelsForToken } from "./auth"
import { RouteId, getRoutePolicy } from "./route-policy"
import { findChannelModelMapping } from "../../utils"
import { TokenUtils } from "../../admin/token_utils"
import { normalizeChannelConfig } from "../../channel-config"
import {
    buildUsageRequestMetadata,
    hashTokenKey,
    writeUsageFailureEvent,
    writeUsageSuccessEvent,
} from "../../analytics/usage-logger"

export type ResolvedChannelCandidate = {
    key: string
    config: ChannelConfig
    mapping: ChannelModelMapping
}

export type ChannelResolution = {
    channels: ResolvedChannelCandidate[]
    initialChannel: ResolvedChannelCandidate
    requestBody: any
    saveUsage: (usage: Usage) => Promise<void>
    logFailure: (errorCode: string, errorSummary?: string) => void
    trackingState: RequestTrackingState
    setActiveChannel: (channel: ResolvedChannelCandidate) => void
}

export const pickHighestPriorityChannel = (
    channels: ResolvedChannelCandidate[]
): ResolvedChannelCandidate => {
    const maxWeight = channels.reduce((highest, current) => {
        return Math.max(highest, current.config.weight ?? 0);
    }, 0);
    const highestPriorityChannels = channels.filter((channel) => {
        return (channel.config.weight ?? 0) === maxWeight;
    });
    const randomIndex = Math.floor(Math.random() * highestPriorityChannels.length);
    return highestPriorityChannels[randomIndex];
}

export const resolveChannel = async (
    c: Context<HonoCustomType>,
    routeId: RouteId
): Promise<ChannelResolution | Response> => {
    const apiKey = getApiKeyFromHeaders(c);
    if (!apiKey) {
        return c.text("Authorization header or x-api-key not found", 401);
    }

    const tokenInfo = await fetchTokenData(c, apiKey);
    if (!tokenInfo) {
        return c.text("Invalid API key", 401);
    }

    const { tokenData, usage } = tokenInfo;

    if (usage >= tokenData.total_quota) {
        return c.text("Quota exceeded", 402);
    }

    const channelsResult = await fetchChannelsForToken(c, tokenData);

    if (!channelsResult.results || channelsResult.results.length === 0) {
        return c.text("No available channels for this token", 401);
    }

    let requestBody: any;
    try {
        requestBody = await c.req.json();
    } catch (error) {
        return c.text("Invalid JSON body", 400);
    }
    const requestedModel = requestBody.model;
    if (!requestedModel) {
        return c.text("Model is required", 400);
    }

    const policy = getRoutePolicy(routeId);
    const allowedTypes = policy.allowedTypes;

    const availableChannels: ResolvedChannelCandidate[] = [];
    let hasDisabledMatchingChannel = false;

    for (const row of channelsResult.results) {
        const config = (() => {
            try {
                return normalizeChannelConfig(JSON.parse(row.value) as ChannelConfig);
            } catch {
                return null;
            }
        })();
        if (!config) {
            console.error(`Invalid channel config for key: ${row.key}`);
            continue;
        }

        if (allowedTypes && (!config.type || !allowedTypes.includes(config.type))) {
            continue;
        }

        const mapping = findChannelModelMapping(config, requestedModel);
        if (!mapping) {
            continue;
        }

        if (!config.enabled) {
            hasDisabledMatchingChannel = true;
            continue;
        }

        availableChannels.push({
            key: row.key,
            config: config,
            mapping,
        });
    }

    if (availableChannels.length === 0) {
        if (hasDisabledMatchingChannel) {
            return c.text(`No enabled channels available for model: ${requestedModel}. Please enable a channel first.`, 503);
        }
        return c.text(`Model not supported: ${requestedModel}. Please configure models.`, 400);
    }

    const selectedChannel = pickHighestPriorityChannel(availableChannels);
    const trackingState: RequestTrackingState = {
        retryCount: 0,
    };
    const requestStartedAt = Date.now();
    const tokenHash = await hashTokenKey(apiKey);
    const tokenName = tokenData.name?.trim() || "未命名令牌";
    const requestMetadata = buildUsageRequestMetadata(c);
    const usageContext = {
        routeId,
        tokenHash,
        tokenName,
        channelKey: selectedChannel.key,
        providerType: selectedChannel.config.type || "unknown",
        requestedModel,
        upstreamModel: selectedChannel.mapping.id,
        streamMode: requestBody.stream ? "stream" as const : "sync" as const,
        requestId: requestMetadata.requestId,
        traceId: requestMetadata.traceId,
        clientIp: requestMetadata.clientIp,
        userAgent: requestMetadata.userAgent,
        country: requestMetadata.country,
        region: requestMetadata.region,
        city: requestMetadata.city,
        colo: requestMetadata.colo,
        timezone: requestMetadata.timezone,
        startedAt: requestStartedAt,
        trackingState,
    };
    let usageLogState: "idle" | "processing" | "done" = "idle";
    let activeChannel = selectedChannel;

    const setActiveChannel = (channel: ResolvedChannelCandidate) => {
        activeChannel = channel;
        usageContext.channelKey = channel.key;
        usageContext.providerType = channel.config.type || "unknown";
        usageContext.upstreamModel = channel.mapping.id;
    };

    const saveUsage = async (usage: Usage) => {
        if (usageLogState !== "idle") {
            return;
        }

        usageLogState = "processing";
        try {
            const costResult = await TokenUtils.processUsage(
                c,
                apiKey,
                requestedModel,
                activeChannel.key,
                activeChannel.config,
                usage
            );
            writeUsageSuccessEvent(c, usageContext, usage, costResult);
            usageLogState = "done";
        } catch (error) {
            usageLogState = "idle";
            console.error('Error processing usage:', error);
        }
    };

    const logFailure = (errorCode: string, errorSummary?: string) => {
        if (usageLogState === "done") {
            return;
        }

        writeUsageFailureEvent(c, usageContext, { errorCode, errorSummary });
    };

    return {
        channels: availableChannels,
        initialChannel: selectedChannel,
        requestBody,
        saveUsage,
        logFailure,
        trackingState,
        setActiveChannel,
    };
}
