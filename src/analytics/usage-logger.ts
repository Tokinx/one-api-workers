import { Context } from "hono";
import { BILLING_RAW_SCALE } from "../billing";

export const DEFAULT_USAGE_ANALYTICS_DATASET_NAME = "usage_events_by_token";

export type UsageLogContext = {
    routeId: string;
    tokenHash: string;
    tokenName: string;
    channelKey: string;
    providerType: string;
    requestedModel: string;
    upstreamModel: string;
    streamMode: "stream" | "sync";
    requestId: string;
    traceId: string;
    clientIp: string;
    userAgent: string;
    country: string;
    region: string;
    city: string;
    colo: string;
    timezone: string;
    startedAt: number;
    trackingState: RequestTrackingState;
}

type UsageCostResult = {
    totalCost: number;
    cacheCost: number;
}

type FailureLogParams = {
    errorCode: string;
    errorSummary?: string;
}

const MAX_DIMENSION_LENGTH = 200;

const safeNumber = (value: unknown): number => {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const normalizeDimension = (value: unknown): string => {
    if (typeof value !== "string") {
        return "";
    }

    return value.slice(0, MAX_DIMENSION_LENGTH);
};

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return "";
};

const getStatusFamily = (status?: number): string => {
    if (!status || status < 100) {
        return "network";
    }

    return `${Math.floor(status / 100)}xx`;
};

const getDatasetName = (c: Context<HonoCustomType>): string => {
    return c.env.USAGE_ANALYTICS_DATASET || DEFAULT_USAGE_ANALYTICS_DATASET_NAME;
};

const getAnalyticsBinding = (c: Context<HonoCustomType>): AnalyticsEngineDataset | null => {
    if (!c.env.USAGE_ANALYTICS || !getDatasetName(c)) {
        return null;
    }

    return c.env.USAGE_ANALYTICS;
};

const writeDataPoint = (
    c: Context<HonoCustomType>,
    point: AnalyticsEngineDataPoint
) => {
    const binding = getAnalyticsBinding(c);
    if (!binding) {
        return;
    }

    try {
        binding.writeDataPoint(point);
    } catch (error) {
        console.error("Failed to write usage analytics datapoint:", error);
    }
};

const extractSummaryFromUnknown = (value: unknown): string => {
    if (typeof value === "string") {
        return normalizeDimension(value.replace(/\s+/g, " ").trim());
    }

    if (value && typeof value === "object") {
        const candidateRecord = value as Record<string, unknown>;
        for (const key of ["message", "error", "detail", "description", "reason", "title"]) {
            const candidateValue = candidateRecord[key];
            if (typeof candidateValue === "string" && candidateValue.trim()) {
                return normalizeDimension(candidateValue.replace(/\s+/g, " ").trim());
            }
            if (candidateValue && typeof candidateValue === "object") {
                const nested = extractSummaryFromUnknown(candidateValue);
                if (nested) {
                    return nested;
                }
            }
        }
    }

    return "";
};

export const summarizeErrorText = (text: string): string => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "";
    }

    try {
        const parsed = JSON.parse(normalized) as unknown;
        const summary = extractSummaryFromUnknown(parsed);
        if (summary) {
            return summary;
        }
    } catch {
        // ignore JSON parse errors and fallback to plain text
    }

    return normalizeDimension(normalized);
};

export const summarizeErrorFromResponse = async (response: Response): Promise<string> => {
    try {
        const text = await response.clone().text();
        return summarizeErrorText(text);
    } catch {
        return "";
    }
};

export const summarizeErrorFromUnknown = (error: unknown): string => {
    if (error instanceof Error) {
        return summarizeErrorText(error.message);
    }

    return summarizeErrorText(String(error ?? ""));
};

export const buildUsageRequestMetadata = (c: Context<HonoCustomType>) => {
    const requestCf = (c.req.raw.cf || {}) as Partial<IncomingRequestCfProperties<unknown>>;
    const requestId = firstNonEmpty(
        c.req.header("x-request-id"),
        c.req.header("cf-ray"),
        crypto.randomUUID()
    );
    const traceId = firstNonEmpty(
        c.req.header("traceparent"),
        c.req.header("x-b3-traceid"),
        c.req.header("x-trace-id"),
        requestId
    );

    return {
        requestId,
        traceId,
        clientIp: firstNonEmpty(
            c.req.header("cf-connecting-ip"),
            c.req.header("x-real-ip"),
            c.req.header("x-forwarded-for")?.split(",")[0]
        ),
        userAgent: firstNonEmpty(c.req.header("user-agent")),
        country: firstNonEmpty(requestCf.country),
        region: firstNonEmpty(requestCf.region, requestCf.regionCode),
        city: firstNonEmpty(requestCf.city),
        colo: firstNonEmpty(requestCf.colo),
        timezone: firstNonEmpty(requestCf.timezone),
    };
};

const buildCommonPoint = (
    context: UsageLogContext,
    usage: Usage,
    costResult: UsageCostResult,
    result: "success" | "failure",
    errorCode: string,
    errorSummary: string
): AnalyticsEngineDataPoint => {
    const promptTokens = safeNumber(usage.prompt_tokens);
    const completionTokens = safeNumber(usage.completion_tokens);
    const cachedTokens = safeNumber(usage.cached_tokens);
    const totalTokens = safeNumber(
        usage.total_tokens ?? (promptTokens + completionTokens)
    );
    const upstreamStatus = safeNumber(context.trackingState.upstreamStatus);

    return {
        indexes: [context.tokenHash],
        blobs: [
            normalizeDimension(context.routeId),
            normalizeDimension(context.tokenName),
            normalizeDimension(context.channelKey),
            normalizeDimension(context.providerType),
            normalizeDimension(context.requestedModel),
            normalizeDimension(context.upstreamModel),
            result,
            context.streamMode,
            normalizeDimension(errorCode),
            getStatusFamily(upstreamStatus),
            normalizeDimension(context.requestId),
            normalizeDimension(context.traceId),
            normalizeDimension(context.clientIp),
            normalizeDimension(context.userAgent),
            normalizeDimension(context.country),
            normalizeDimension(context.region),
            normalizeDimension(context.city),
            normalizeDimension(context.colo),
            normalizeDimension(context.timezone),
            normalizeDimension(errorSummary),
        ],
        doubles: [
            promptTokens,
            completionTokens,
            cachedTokens,
            totalTokens,
            safeNumber(costResult.totalCost),
            Math.max(0, Date.now() - context.startedAt),
            safeNumber(context.trackingState.retryCount),
            upstreamStatus,
            result === "success" ? 1 : 0,
            BILLING_RAW_SCALE,
            safeNumber(costResult.cacheCost),
        ],
    };
};

export const writeUsageSuccessEvent = (
    c: Context<HonoCustomType>,
    context: UsageLogContext,
    usage: Usage,
    costResult: UsageCostResult
) => {
    writeDataPoint(c, buildCommonPoint(context, usage, costResult, "success", "", ""));
};

export const writeUsageFailureEvent = (
    c: Context<HonoCustomType>,
    context: UsageLogContext,
    params: FailureLogParams
) => {
    writeDataPoint(
        c,
        buildCommonPoint(
            context,
            {},
            {
                totalCost: 0,
                cacheCost: 0,
            },
            "failure",
            params.errorCode,
            params.errorSummary || context.trackingState.errorSummary || ""
        )
    );
};

export const hashTokenKey = async (value: string): Promise<string> => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((part) => part.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
};
