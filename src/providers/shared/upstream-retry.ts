import { Context } from "hono";

import {
    MAX_CHANNEL_FALLBACKS,
    MAX_CHANNEL_RETRIES,
    normalizeChannelConfig,
} from "../../channel-config";
import {
    summarizeErrorFromResponse,
    summarizeErrorFromUnknown,
} from "../../analytics/usage-logger";
import {
    pickHighestPriorityChannel,
    ResolvedChannelCandidate,
} from "./channel-resolver";
import {
    getProvider,
    ProviderFetch,
} from "./provider-registry";

const RETRYABLE_STATUS_CODES = new Set([401, 403, 408, 409, 429, 500, 502, 503, 504, 529]);

type ChannelExecutionResult = {
    response: Response
    shouldFallback: boolean
    errorCode: string
    errorSummary?: string
}

const shuffleKeys = (keys: string[]): string[] => {
    const clonedKeys = [...keys];

    for (let index = clonedKeys.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [clonedKeys[index], clonedKeys[randomIndex]] = [clonedKeys[randomIndex], clonedKeys[index]];
    }

    return clonedKeys;
};

const pickRandomItem = <T>(items: T[]): T => {
    return items[Math.floor(Math.random() * items.length)];
};

const cloneRequestBody = <T>(requestBody: T): T => {
    if (requestBody == null) {
        return requestBody;
    }

    return JSON.parse(JSON.stringify(requestBody)) as T;
};

const buildChannelRequestBody = (
    requestBody: any,
    channel: ResolvedChannelCandidate
) => {
    const runtimeRequestBody = cloneRequestBody(requestBody);
    if (runtimeRequestBody && typeof runtimeRequestBody === "object") {
        runtimeRequestBody.model = channel.mapping.id;
    }
    return runtimeRequestBody;
};

const shouldRetryResponse = (response: Response): boolean => {
    return RETRYABLE_STATUS_CODES.has(response.status);
};

const discardResponse = async (response: Response): Promise<void> => {
    try {
        await response.body?.cancel();
    } catch (error) {
        console.warn("Failed to cancel upstream response body:", error);
    }
};

const pickInitialKey = (config: ChannelConfig): string | null => {
    const normalizedConfig = normalizeChannelConfig(config);
    const shuffledKeys = shuffleKeys(normalizedConfig.api_keys);
    return shuffledKeys[0] || null;
};

const pickRetryKey = (
    config: ChannelConfig,
    currentKey: string,
    usedKeys: Set<string>
): string => {
    const normalizedConfig = normalizeChannelConfig(config);

    if (!normalizedConfig.auto_rotate) {
        return currentKey;
    }

    const unusedOtherKeys = normalizedConfig.api_keys.filter((key) => {
        return key !== currentKey && !usedKeys.has(key);
    });
    const otherKeys = normalizedConfig.api_keys.filter((key) => key !== currentKey);
    const nextPool = unusedOtherKeys.length > 0
        ? unusedOtherKeys
        : (otherKeys.length > 0 ? otherKeys : [currentKey]);
    const nextKey = pickRandomItem(nextPool);
    usedKeys.add(nextKey);
    return nextKey;
};

const pickNextFallbackChannel = (
    channels: ResolvedChannelCandidate[],
    attemptedChannelKeys: Set<string>
): ResolvedChannelCandidate | null => {
    const remainingChannels = channels.filter((channel) => {
        return !attemptedChannelKeys.has(channel.key);
    });

    if (remainingChannels.length === 0) {
        return null;
    }

    return pickHighestPriorityChannel(remainingChannels);
};

const executeChannelWithRetries = async (
    c: Context<HonoCustomType>,
    channel: ResolvedChannelCandidate,
    requestBody: any,
    saveUsage: (usage: Usage) => Promise<void>,
    trackingState: RequestTrackingState,
    provider: ProviderFetch,
): Promise<ChannelExecutionResult> => {
    const normalizedConfig = normalizeChannelConfig(channel.config);
    const initialKey = pickInitialKey(normalizedConfig);

    if (!initialKey) {
        const errorSummary = "Channel API keys not configured";
        trackingState.upstreamStatus = 0;
        trackingState.errorSummary = errorSummary;

        return {
            response: c.text(errorSummary, 500),
            shouldFallback: true,
            errorCode: "channel_keys_missing",
            errorSummary,
        };
    }

    const maxAttempts = 1 + (normalizedConfig.auto_retry ? MAX_CHANNEL_RETRIES : 0);
    const usedKeys = new Set<string>([initialKey]);
    let currentKey = initialKey;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        try {
            const runtimeConfig: ChannelConfig = {
                ...normalizedConfig,
                api_key: currentKey,
                api_keys: [currentKey],
            };

            const response = await provider(
                c,
                runtimeConfig,
                buildChannelRequestBody(requestBody, channel),
                saveUsage,
                trackingState,
            );

            if (response.ok) {
                return {
                    response,
                    shouldFallback: false,
                    errorCode: "",
                };
            }

            if (!shouldRetryResponse(response)) {
                const errorSummary = await summarizeErrorFromResponse(response);
                trackingState.errorSummary = errorSummary;

                return {
                    response,
                    shouldFallback: false,
                    errorCode: `http_${response.status}`,
                    errorSummary,
                };
            }

            const hasNextAttempt = attemptIndex < maxAttempts - 1;

            console.warn(
                `Retryable upstream failure for channel "${normalizedConfig.name || channel.key}", `
                + `attempt ${attemptIndex + 1}/${maxAttempts}, `
                + `status ${response.status}`
            );

            if (!hasNextAttempt) {
                const errorSummary = await summarizeErrorFromResponse(response);
                trackingState.errorSummary = errorSummary;

                return {
                    response,
                    shouldFallback: true,
                    errorCode: `http_${response.status}`,
                    errorSummary,
                };
            }

            await discardResponse(response);
            currentKey = pickRetryKey(normalizedConfig, currentKey, usedKeys);
            trackingState.retryCount += 1;
        } catch (error) {
            const hasNextAttempt = attemptIndex < maxAttempts - 1;

            console.error(
                `Upstream request error for channel "${normalizedConfig.name || channel.key}", `
                + `attempt ${attemptIndex + 1}/${maxAttempts}`,
                error
            );

            if (!hasNextAttempt) {
                trackingState.upstreamStatus = 0;
                trackingState.errorSummary = summarizeErrorFromUnknown(error);
                const message = error instanceof Error ? error.message : "Unknown upstream error";

                return {
                    response: c.text(`Upstream request failed: ${message}`, 502),
                    shouldFallback: true,
                    errorCode: "upstream_exception",
                    errorSummary: trackingState.errorSummary,
                };
            }

            trackingState.upstreamStatus = 0;
            currentKey = pickRetryKey(normalizedConfig, currentKey, usedKeys);
            trackingState.retryCount += 1;
        }
    }

    const errorSummary = trackingState.errorSummary || "Upstream request failed after retries";
    return {
        response: c.text("Upstream request failed after retries", 502),
        shouldFallback: true,
        errorCode: "upstream_retries_exhausted",
        errorSummary,
    };
};

export const executeWithFallbackChannels = async (
    c: Context<HonoCustomType>,
    channels: ResolvedChannelCandidate[],
    initialChannel: ResolvedChannelCandidate,
    requestBody: any,
    saveUsage: (usage: Usage) => Promise<void>,
    logFailure: (errorCode: string, errorSummary?: string) => void,
    trackingState: RequestTrackingState,
    setActiveChannel: (channel: ResolvedChannelCandidate) => void,
): Promise<Response> => {
    const attemptedChannelKeys = new Set<string>();
    let currentChannel = initialChannel;
    let fallbackCount = 0;

    while (true) {
        attemptedChannelKeys.add(currentChannel.key);
        setActiveChannel(currentChannel);
        trackingState.errorSummary = undefined;

        const provider = getProvider(currentChannel.config.type || "");
        if (!provider) {
            const errorSummary = "Channel type not supported";
            const response = c.text(errorSummary, 400);
            const nextChannel = fallbackCount < MAX_CHANNEL_FALLBACKS
                ? pickNextFallbackChannel(channels, attemptedChannelKeys)
                : null;

            trackingState.upstreamStatus = 0;
            trackingState.errorSummary = errorSummary;

            if (!nextChannel) {
                logFailure("channel_type_invalid", errorSummary);
                return response;
            }

            console.warn(
                `Fallback to channel "${nextChannel.key}" after unsupported provider `
                + `on channel "${currentChannel.key}"`
            );

            fallbackCount += 1;
            trackingState.retryCount += 1;
            currentChannel = nextChannel;
            continue;
        }

        const execution = await executeChannelWithRetries(
            c,
            currentChannel,
            requestBody,
            saveUsage,
            trackingState,
            provider,
        );

        if (execution.response.ok) {
            return execution.response;
        }

        const nextChannel = execution.shouldFallback && fallbackCount < MAX_CHANNEL_FALLBACKS
            ? pickNextFallbackChannel(channels, attemptedChannelKeys)
            : null;

        if (!nextChannel) {
            logFailure(execution.errorCode, execution.errorSummary);
            return execution.response;
        }

        await discardResponse(execution.response);

        console.warn(
            `Fallback to channel "${nextChannel.key}" after channel "${currentChannel.key}" `
            + `failed for model "${currentChannel.mapping.name}"`
        );

        fallbackCount += 1;
        trackingState.retryCount += 1;
        currentChannel = nextChannel;
    }
};
