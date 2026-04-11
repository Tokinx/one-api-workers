import { Context } from "hono";

import {
    MAX_RETRIES_PER_KEY,
    MAX_ROTATION_ATTEMPTS,
    normalizeChannelConfig,
} from "../../channel-config";
import {
    summarizeErrorFromResponse,
    summarizeErrorFromUnknown,
} from "../../analytics/usage-logger";
import { ProviderFetch } from "./provider-registry";

const RETRYABLE_STATUS_CODES = new Set([401, 403, 408, 409, 429, 500, 502, 503, 504, 529]);

const shuffleKeys = (keys: string[]): string[] => {
    const clonedKeys = [...keys];

    for (let index = clonedKeys.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [clonedKeys[index], clonedKeys[randomIndex]] = [clonedKeys[randomIndex], clonedKeys[index]];
    }

    return clonedKeys;
};

const cloneRequestBody = <T>(requestBody: T): T => {
    if (requestBody == null) {
        return requestBody;
    }

    return JSON.parse(JSON.stringify(requestBody)) as T;
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

const getCandidateKeys = (config: ChannelConfig): string[] => {
    const normalized = normalizeChannelConfig(config);
    const shuffledKeys = shuffleKeys(normalized.api_keys);

    if (!normalized.auto_rotate) {
        return shuffledKeys.slice(0, 1);
    }

    return shuffledKeys.slice(0, Math.min(shuffledKeys.length, 1 + MAX_ROTATION_ATTEMPTS));
};

export const executeWithChannelKeys = async (
    c: Context<HonoCustomType>,
    config: ChannelConfig,
    requestBody: any,
    saveUsage: (usage: Usage) => Promise<void>,
    logFailure: (errorCode: string, errorSummary?: string) => void,
    trackingState: RequestTrackingState,
    provider: ProviderFetch,
): Promise<Response> => {
    const normalizedConfig = normalizeChannelConfig(config);
    const candidateKeys = getCandidateKeys(normalizedConfig);

    if (candidateKeys.length === 0) {
        return c.text("Channel API keys not configured", 500);
    }

    const attemptsPerKey = normalizedConfig.auto_retry
        ? 1 + MAX_RETRIES_PER_KEY
        : 1;

    for (let keyIndex = 0; keyIndex < candidateKeys.length; keyIndex += 1) {
        const currentKey = candidateKeys[keyIndex];

        for (let attemptIndex = 0; attemptIndex < attemptsPerKey; attemptIndex += 1) {
            const isLastAttemptForKey = attemptIndex === attemptsPerKey - 1;
            const isLastKey = keyIndex === candidateKeys.length - 1;

            try {
                trackingState.retryCount = keyIndex * attemptsPerKey + attemptIndex;
                const runtimeConfig: ChannelConfig = {
                    ...normalizedConfig,
                    api_key: currentKey,
                    api_keys: [currentKey],
                };

                const response = await provider(
                    c,
                    runtimeConfig,
                    cloneRequestBody(requestBody),
                    saveUsage,
                    trackingState,
                );

                if (response.ok) {
                    return response;
                }

                if (!shouldRetryResponse(response)) {
                    const errorSummary = await summarizeErrorFromResponse(response);
                    trackingState.errorSummary = errorSummary;
                    logFailure(`http_${response.status}`, errorSummary);
                    return response;
                }

                console.warn(
                    `Retryable upstream failure for channel "${normalizedConfig.name || "unknown"}", `
                    + `key ${keyIndex + 1}/${candidateKeys.length}, `
                    + `attempt ${attemptIndex + 1}/${attemptsPerKey}, `
                    + `status ${response.status}`
                );

                if (isLastAttemptForKey && isLastKey) {
                    const errorSummary = await summarizeErrorFromResponse(response);
                    trackingState.errorSummary = errorSummary;
                    logFailure(`http_${response.status}`, errorSummary);
                    return response;
                }

                await discardResponse(response);
            } catch (error) {
                console.error(
                    `Upstream request error for channel "${normalizedConfig.name || "unknown"}", `
                    + `key ${keyIndex + 1}/${candidateKeys.length}, `
                    + `attempt ${attemptIndex + 1}/${attemptsPerKey}`,
                    error
                );

                if (isLastAttemptForKey && isLastKey) {
                    trackingState.upstreamStatus = 0;
                    trackingState.errorSummary = summarizeErrorFromUnknown(error);
                    logFailure("upstream_exception", trackingState.errorSummary);
                    const message = error instanceof Error ? error.message : "Unknown upstream error";
                    return c.text(`Upstream request failed: ${message}`, 502);
                }
            }
        }
    }

    return c.text("Upstream request failed after retries", 502);
};
