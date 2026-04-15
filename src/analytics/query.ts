import { Context } from "hono";

import { BILLING_RAW_SCALE, LEGACY_TO_RAW_FACTOR } from "../billing";
import { DEFAULT_USAGE_ANALYTICS_DATASET_NAME } from "./usage-logger";
import { t } from "../i18n";

export type AnalyticsRange = "24h" | "7d" | "30d" | "90d";
export type AnalyticsBreakdownDimension = "token" | "channel" | "model" | "provider";
export type UsageLogFilterDimension =
    | "route"
    | "token"
    | "channel"
    | "model"
    | "provider"
    | "requestId"
    | "traceId"
    | "clientIp"
    | "userAgent"
    | "country"
    | "region"
    | "city"
    | "colo"
    | "timezone"
    | "result"
    | "errorCode"
    | "errorSummary";

type RangeConfig = {
    lookbackValue: string;
    lookbackUnit: "HOUR" | "DAY";
    bucketValue: string;
    bucketUnit: "HOUR" | "DAY";
    bucketLabel: string;
    bucketCount: number;
}

type TimeWindow = {
    range?: AnalyticsRange;
    startTime?: string;
    endTime?: string;
    whereClause: string;
}

type AnalyticsQueryRawResult<T extends Record<string, unknown>> = {
    data: T[];
    meta?: Array<{ name?: string; type?: string }>;
}

type DatasetColumnSupport = {
    availableColumns: Set<string>;
}

type UsageLogQueryParams = {
    start?: string;
    end?: string;
    dimension?: string;
    keyword?: string;
    result?: string;
    page?: string;
}

export class AnalyticsQueryValidationError extends Error {}

const USAGE_LOG_PAGE_SIZE = 50;

const RANGE_CONFIG: Record<AnalyticsRange, RangeConfig> = {
    "24h": {
        lookbackValue: "24",
        lookbackUnit: "HOUR",
        bucketValue: "1",
        bucketUnit: "HOUR",
        bucketLabel: "1h",
        bucketCount: 24,
    },
    "7d": {
        lookbackValue: "7",
        lookbackUnit: "DAY",
        bucketValue: "1",
        bucketUnit: "DAY",
        bucketLabel: "1d",
        bucketCount: 7,
    },
    "30d": {
        lookbackValue: "30",
        lookbackUnit: "DAY",
        bucketValue: "1",
        bucketUnit: "DAY",
        bucketLabel: "1d",
        bucketCount: 30,
    },
    "90d": {
        lookbackValue: "90",
        lookbackUnit: "DAY",
        bucketValue: "1",
        bucketUnit: "DAY",
        bucketLabel: "1d",
        bucketCount: 90,
    },
};

const BLOB_FIELDS = {
    routeId: "blob1",
    tokenName: "blob2",
    channelKey: "blob3",
    providerType: "blob4",
    requestedModel: "blob5",
    upstreamModel: "blob6",
    result: "blob7",
    streamMode: "blob8",
    errorCode: "blob9",
    statusFamily: "blob10",
    requestId: "blob11",
    traceId: "blob12",
    clientIp: "blob13",
    userAgent: "blob14",
    country: "blob15",
    region: "blob16",
    city: "blob17",
    colo: "blob18",
    timezone: "blob19",
    errorSummary: "blob20",
} as const;

const DOUBLE_FIELDS = {
    promptTokens: "double1",
    completionTokens: "double2",
    cachedTokens: "double3",
    totalTokens: "double4",
    totalCost: "double5",
    latencyMs: "double6",
    retryCount: "double7",
    upstreamStatus: "double8",
    successFlag: "double9",
    billingScale: "double10",
    cacheCost: "double11",
} as const;

const BREAKDOWN_FIELDS: Record<AnalyticsBreakdownDimension, string> = {
    token: BLOB_FIELDS.tokenName,
    channel: BLOB_FIELDS.channelKey,
    model: BLOB_FIELDS.requestedModel,
    provider: BLOB_FIELDS.providerType,
};

const LOG_FILTER_FIELDS: Record<UsageLogFilterDimension, string> = {
    route: BLOB_FIELDS.routeId,
    token: BLOB_FIELDS.tokenName,
    channel: BLOB_FIELDS.channelKey,
    model: BLOB_FIELDS.requestedModel,
    provider: BLOB_FIELDS.providerType,
    requestId: BLOB_FIELDS.requestId,
    traceId: BLOB_FIELDS.traceId,
    clientIp: BLOB_FIELDS.clientIp,
    userAgent: BLOB_FIELDS.userAgent,
    country: BLOB_FIELDS.country,
    region: BLOB_FIELDS.region,
    city: BLOB_FIELDS.city,
    colo: BLOB_FIELDS.colo,
    timezone: BLOB_FIELDS.timezone,
    result: BLOB_FIELDS.result,
    errorCode: BLOB_FIELDS.errorCode,
    errorSummary: BLOB_FIELDS.errorSummary,
};

const LEGACY_BLOB_COLUMNS = [
    BLOB_FIELDS.routeId,
    BLOB_FIELDS.tokenName,
    BLOB_FIELDS.channelKey,
    BLOB_FIELDS.providerType,
    BLOB_FIELDS.requestedModel,
    BLOB_FIELDS.upstreamModel,
    BLOB_FIELDS.result,
    BLOB_FIELDS.streamMode,
    BLOB_FIELDS.errorCode,
    BLOB_FIELDS.statusFamily,
];

const EXTENDED_LOG_COLUMNS = [
    BLOB_FIELDS.requestId,
    BLOB_FIELDS.traceId,
    BLOB_FIELDS.clientIp,
    BLOB_FIELDS.userAgent,
    BLOB_FIELDS.country,
    BLOB_FIELDS.region,
    BLOB_FIELDS.city,
    BLOB_FIELDS.colo,
    BLOB_FIELDS.timezone,
    BLOB_FIELDS.errorSummary,
];

const USAGE_LOG_NUMERIC_COLUMNS = [
    DOUBLE_FIELDS.promptTokens,
    DOUBLE_FIELDS.completionTokens,
    DOUBLE_FIELDS.cachedTokens,
    DOUBLE_FIELDS.totalTokens,
    DOUBLE_FIELDS.totalCost,
    DOUBLE_FIELDS.latencyMs,
    DOUBLE_FIELDS.retryCount,
    DOUBLE_FIELDS.upstreamStatus,
    DOUBLE_FIELDS.successFlag,
    DOUBLE_FIELDS.billingScale,
    DOUBLE_FIELDS.cacheCost,
];

const ALL_PROBED_COLUMNS = [
    ...LEGACY_BLOB_COLUMNS,
    ...EXTENDED_LOG_COLUMNS,
    ...USAGE_LOG_NUMERIC_COLUMNS,
];

const DATASET_COLUMN_SUPPORT_CACHE_TTL_MS = 60_000;
const DATASET_COLUMN_SUPPORT_CACHE = new Map<string, {
    expiresAt: number;
    promise: Promise<DatasetColumnSupport>;
}>();

const sanitizeDatasetName = (value?: string): string => {
    if (value && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        return value;
    }

    return DEFAULT_USAGE_ANALYTICS_DATASET_NAME;
};

const toNumber = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
};

const toText = (value: unknown): string => {
    return typeof value === "string" ? value : "";
};

const TIMESTAMP_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;

const normalizeAnalyticsTimestamp = (value: unknown): string => {
    const rawValue = toText(value).trim();
    if (!rawValue) {
        return "";
    }

    const normalizedValue = rawValue.includes("T")
        ? rawValue
        : rawValue.replace(" ", "T");
    const candidate = TIMESTAMP_TIMEZONE_PATTERN.test(normalizedValue)
        ? normalizedValue
        : `${normalizedValue}Z`;
    const date = new Date(candidate);

    return Number.isNaN(date.getTime()) ? rawValue : date.toISOString();
};

const escapeSqlString = (value: string): string => {
    return value.replace(/'/g, "''");
};

const getRangeConfig = (range?: string): { range: AnalyticsRange; config: RangeConfig } => {
    if (range && range in RANGE_CONFIG) {
        return {
            range: range as AnalyticsRange,
            config: RANGE_CONFIG[range as AnalyticsRange],
        };
    }

    return {
        range: "24h",
        config: RANGE_CONFIG["24h"],
    };
};

const getDatasetName = (c: Context<HonoCustomType>): string => {
    return sanitizeDatasetName(c.env.USAGE_ANALYTICS_DATASET);
};

const formatSqlDateTime = (date: Date): string => {
    return date.toISOString().slice(0, 19).replace("T", " ");
};

const parseDateTimeInput = (value: string | undefined, fieldKey: string, lang: string): string | undefined => {
    if (!value) {
        return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AnalyticsQueryValidationError(
            t(lang, "analytics.invalidFormat", { field: t(lang, fieldKey) })
        );
    }

    return formatSqlDateTime(date);
};

const buildRangeWhereClause = (config: RangeConfig): string => {
    return `timestamp >= NOW() - INTERVAL '${config.lookbackValue}' ${config.lookbackUnit}`;
};

const buildBucketClause = (config: RangeConfig): string => {
    return `toStartOfInterval(timestamp, INTERVAL '${config.bucketValue}' ${config.bucketUnit})`;
};

const startOfUtcHour = (date: Date): Date => {
    return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        0,
        0,
        0
    ));
};

const startOfUtcDay = (date: Date): Date => {
    return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        0,
        0,
        0,
        0
    ));
};

const addUtcHours = (date: Date, hours: number): Date => {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
};

const addUtcDays = (date: Date, days: number): Date => {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
};

const buildExplicitTimeWhereClause = (start: Date, endExclusive: Date): string => {
    return [
        `timestamp >= toDateTime('${escapeSqlString(formatSqlDateTime(start))}')`,
        `timestamp < toDateTime('${escapeSqlString(formatSqlDateTime(endExclusive))}')`,
    ].join(" AND ");
};

const buildTrendWindow = (range: AnalyticsRange, config: RangeConfig) => {
    if (range === "24h") {
        const latestBucket = startOfUtcHour(new Date());
        const start = addUtcHours(latestBucket, -(config.bucketCount - 1));
        const endExclusive = addUtcHours(latestBucket, 1);

        return {
            whereClause: buildExplicitTimeWhereClause(start, endExclusive),
            bucketTimestamps: Array.from({ length: config.bucketCount }, (_, index) =>
                Math.floor(addUtcHours(start, index).getTime() / 1000)
            ),
        };
    }

    const latestBucket = startOfUtcDay(new Date());
    const start = addUtcDays(latestBucket, -(config.bucketCount - 1));
    const endExclusive = addUtcDays(latestBucket, 1);

    return {
        whereClause: buildExplicitTimeWhereClause(start, endExclusive),
        bucketTimestamps: Array.from({ length: config.bucketCount }, (_, index) =>
            Math.floor(addUtcDays(start, index).getTime() / 1000)
        ),
    };
};

const buildCustomTimeWindow = (
    requestedStart?: string,
    requestedEnd?: string,
    lang: string = "zh-CN"
): TimeWindow => {
    const startTime = parseDateTimeInput(requestedStart, "analytics.startTime", lang);
    const endTime = parseDateTimeInput(requestedEnd, "analytics.endTime", lang);

    if (startTime && endTime && startTime >= endTime) {
        throw new AnalyticsQueryValidationError(t(lang, "analytics.startBeforeEnd"));
    }

    const clauses: string[] = [];

    if (startTime) {
        clauses.push(`timestamp >= toDateTime('${escapeSqlString(startTime)}')`);
    }

    if (endTime) {
        clauses.push(`timestamp < toDateTime('${escapeSqlString(endTime)}')`);
    }

    if (clauses.length === 0) {
        const { range, config } = getRangeConfig("24h");
        return {
            range,
            whereClause: buildRangeWhereClause(config),
        };
    }

    return {
        startTime,
        endTime,
        whereClause: clauses.join(" AND "),
    };
};

const runAnalyticsQueryRaw = async <T extends Record<string, unknown>>(
    c: Context<HonoCustomType>,
    query: string
): Promise<AnalyticsQueryRawResult<T>> => {
    if (!c.env.CF_API_TOKEN || !c.env.CF_ACCOUNT_ID) {
        throw new Error("CF analytics query credentials are not configured");
    }

    const api = `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/analytics_engine/sql`;
    const response = await fetch(api, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${c.env.CF_API_TOKEN}`,
        },
        body: query,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Analytics query failed with ${response.status}`);
    }

    const json = await response.json() as {
        data?: T[];
        result?: T[];
        meta?: Array<{ name?: string; type?: string }>;
    };

    return {
        data: json.data || json.result || [],
        meta: json.meta,
    };
};

const runAnalyticsQuery = async <T extends Record<string, unknown>>(
    c: Context<HonoCustomType>,
    query: string
): Promise<T[]> => {
    const result = await runAnalyticsQueryRaw<T>(c, query);
    return result.data;
};

const probeColumnAvailability = async (
    c: Context<HonoCustomType>,
    dataset: string,
    columnName: string,
    whereClause?: string
): Promise<boolean> => {
    try {
        await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    ${columnName}
FROM ${dataset}
${whereClause ? `WHERE ${whereClause}` : ""}
LIMIT 1
        `.trim());
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("unable to find type of column")) {
            return false;
        }

        throw error;
    }
};

const getDatasetColumnSupport = async (
    c: Context<HonoCustomType>,
    dataset: string,
    whereClause?: string
): Promise<DatasetColumnSupport> => {
    const cacheKey = `${c.env.CF_ACCOUNT_ID || "unknown"}:${dataset}:${whereClause || "__all__"}`;
    const cached = DATASET_COLUMN_SUPPORT_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.promise;
    }

    const pending = (async () => {
        const availableColumns = new Set<string>();
        const results = await Promise.all(
            ALL_PROBED_COLUMNS.map(async (columnName) => ({
                columnName,
                supported: await probeColumnAvailability(c, dataset, columnName, whereClause),
            }))
        );

        results.forEach((result) => {
            if (result.supported) {
                availableColumns.add(result.columnName);
            }
        });

        return { availableColumns };
    })();

    DATASET_COLUMN_SUPPORT_CACHE.set(cacheKey, {
        expiresAt: Date.now() + DATASET_COLUMN_SUPPORT_CACHE_TTL_MS,
        promise: pending,
    });

    try {
        return await pending;
    } catch (error) {
        DATASET_COLUMN_SUPPORT_CACHE.delete(cacheKey);
        throw error;
    }
};

const isColumnAvailable = (support: DatasetColumnSupport, columnName: string): boolean => {
    return support.availableColumns.has(columnName);
};

const buildBlobSelect = (
    support: DatasetColumnSupport,
    columnName: string,
    alias: string
): string => {
    return isColumnAvailable(support, columnName)
        ? `${columnName} AS ${alias}`
        : `'' AS ${alias}`;
};

const buildDoubleSelect = (
    support: DatasetColumnSupport,
    columnName: string,
    alias: string
): string => {
    return isColumnAvailable(support, columnName)
        ? `${columnName} AS ${alias}`
        : `0 AS ${alias}`;
};

const buildNormalizedCostExpression = (
    support: DatasetColumnSupport,
    costField: string
): string => {
    if (!isColumnAvailable(support, costField)) {
        return "0";
    }

    if (!isColumnAvailable(support, DOUBLE_FIELDS.billingScale)) {
        return `${costField} * ${LEGACY_TO_RAW_FACTOR}`;
    }

    return `if(${DOUBLE_FIELDS.billingScale} > 0, ${costField} * (${BILLING_RAW_SCALE} / ${DOUBLE_FIELDS.billingScale}), ${costField} * ${LEGACY_TO_RAW_FACTOR})`;
};

const hasAnyLegacyLogSchema = (support: DatasetColumnSupport): boolean => {
    return LEGACY_BLOB_COLUMNS.some((columnName) => isColumnAvailable(support, columnName));
};

const hasExtendedLogSchema = (support: DatasetColumnSupport): boolean => {
    return EXTENDED_LOG_COLUMNS.every((columnName) => isColumnAvailable(support, columnName));
};

const getUsageLogCompatibilityWarning = (support: DatasetColumnSupport, lang: string): string | undefined => {
    if (!hasAnyLegacyLogSchema(support)) {
        return t(lang, "analytics.schemaV1Warning");
    }

    if (!hasExtendedLogSchema(support)) {
        return t(lang, "analytics.schemaV2Warning");
    }

    return undefined;
};

const buildUsageLogBaseResponse = (
    timeWindow: TimeWindow,
    dimension: UsageLogFilterDimension,
    keyword: string,
    result: "all" | "success" | "failure",
    compatibilityWarning?: string
) => ({
    sampled: true,
    dimension,
    keyword,
    result,
    startTime: timeWindow.startTime || "",
    endTime: timeWindow.endTime || "",
    compatibilityWarning,
});

const isUsageLogFilterSupported = (
    support: DatasetColumnSupport,
    dimension: UsageLogFilterDimension
): boolean => {
    return isColumnAvailable(support, LOG_FILTER_FIELDS[dimension]);
};

const buildUsageLogEmptyResponse = (
    timeWindow: TimeWindow,
    dimension: UsageLogFilterDimension,
    keyword: string,
    result: "all" | "success" | "failure",
    compatibilityWarning: string | undefined
) => ({
    ...buildUsageLogBaseResponse(
        timeWindow,
        dimension,
        keyword,
        result,
        compatibilityWarning
    ),
    page: 1,
    pageSize: USAGE_LOG_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    count: 0,
    hasPrevPage: false,
    hasNextPage: false,
    items: [],
});

export const queryUsageOverview = async (
    c: Context<HonoCustomType>,
    requestedRange?: string
) => {
    const { range, config } = getRangeConfig(requestedRange);
    const dataset = getDatasetName(c);
    const columnSupport = await getDatasetColumnSupport(c, dataset, buildRangeWhereClause(config));
    const normalizedTotalCostExpression = buildNormalizedCostExpression(columnSupport, DOUBLE_FIELDS.totalCost);
    const rows = await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    sum(_sample_interval) AS requests,
    sum(${DOUBLE_FIELDS.successFlag} * _sample_interval) AS successes,
    sum(${normalizedTotalCostExpression} * _sample_interval) AS total_cost,
    sum(${DOUBLE_FIELDS.totalTokens} * _sample_interval) AS total_tokens,
    sum(${DOUBLE_FIELDS.promptTokens} * _sample_interval) AS prompt_tokens,
    sum(${DOUBLE_FIELDS.completionTokens} * _sample_interval) AS completion_tokens,
    sum(${DOUBLE_FIELDS.latencyMs} * _sample_interval) / sum(_sample_interval) AS avg_latency_ms
FROM ${dataset}
WHERE ${buildRangeWhereClause(config)}
    `.trim());

    const row = rows[0] || {};
    const requests = toNumber(row.requests);
    const successes = toNumber(row.successes);

    return {
        range,
        totals: {
            requests,
            successes,
            failures: Math.max(0, requests - successes),
            successRate: requests > 0 ? successes / requests : 0,
            totalCost: toNumber(row.total_cost),
            totalTokens: toNumber(row.total_tokens),
            promptTokens: toNumber(row.prompt_tokens),
            completionTokens: toNumber(row.completion_tokens),
            avgLatencyMs: toNumber(row.avg_latency_ms),
        },
    };
};

export const queryUsageTrend = async (
    c: Context<HonoCustomType>,
    requestedRange?: string
) => {
    const { range, config } = getRangeConfig(requestedRange);
    const dataset = getDatasetName(c);
    const trendWindow = buildTrendWindow(range, config);
    const columnSupport = await getDatasetColumnSupport(c, dataset, trendWindow.whereClause);
    const normalizedTotalCostExpression = buildNormalizedCostExpression(columnSupport, DOUBLE_FIELDS.totalCost);
    const rows = await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    toUnixTimestamp(${buildBucketClause(config)}) AS bucket_ts,
    sum(_sample_interval) AS requests,
    sum(${DOUBLE_FIELDS.successFlag} * _sample_interval) AS successes,
    sum(${normalizedTotalCostExpression} * _sample_interval) AS total_cost
FROM ${dataset}
WHERE ${trendWindow.whereClause}
GROUP BY bucket_ts
ORDER BY bucket_ts ASC
    `.trim());

    const rowsByBucket = new Map<number, Record<string, unknown>>();
    rows.forEach((row) => {
        rowsByBucket.set(toNumber(row.bucket_ts), row);
    });

    return {
        range,
        bucket: config.bucketLabel,
        points: trendWindow.bucketTimestamps.map((bucketTimestamp) => {
            const row = rowsByBucket.get(bucketTimestamp) || {};
            const requests = toNumber(row.requests);
            const successes = toNumber(row.successes);

            return {
                timestamp: new Date(bucketTimestamp * 1000).toISOString(),
                requests,
                successes,
                failures: Math.max(0, requests - successes),
                successRate: requests > 0 ? successes / requests : 0,
                totalCost: toNumber(row.total_cost),
            };
        }),
    };
};

export const queryUsageBreakdown = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    requestedDimension?: string
) => {
    const { range, config } = getRangeConfig(requestedRange);
    const dimension = (requestedDimension && requestedDimension in BREAKDOWN_FIELDS
        ? requestedDimension
        : "token") as AnalyticsBreakdownDimension;
    const dataset = getDatasetName(c);
    const dimensionField = BREAKDOWN_FIELDS[dimension];
    const columnSupport = await getDatasetColumnSupport(c, dataset, buildRangeWhereClause(config));
    const normalizedTotalCostExpression = buildNormalizedCostExpression(columnSupport, DOUBLE_FIELDS.totalCost);
    const rows = await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    ${dimensionField} AS label,
    sum(_sample_interval) AS requests,
    sum(${DOUBLE_FIELDS.successFlag} * _sample_interval) AS successes,
    sum(${normalizedTotalCostExpression} * _sample_interval) AS total_cost,
    sum(${DOUBLE_FIELDS.totalTokens} * _sample_interval) AS total_tokens,
    sum(${DOUBLE_FIELDS.promptTokens} * _sample_interval) AS prompt_tokens,
    sum(${DOUBLE_FIELDS.completionTokens} * _sample_interval) AS completion_tokens,
    sum(${DOUBLE_FIELDS.latencyMs} * _sample_interval) / sum(_sample_interval) AS avg_latency_ms
FROM ${dataset}
WHERE ${buildRangeWhereClause(config)}
    AND ${dimensionField} != ''
GROUP BY label
ORDER BY requests DESC, total_cost DESC
LIMIT 12
    `.trim());

    return {
        range,
        dimension,
        items: rows.map((row) => {
            const requests = toNumber(row.requests);
            const successes = toNumber(row.successes);

            return {
                label: toText(row.label),
                requests,
                successes,
                failures: Math.max(0, requests - successes),
                successRate: requests > 0 ? successes / requests : 0,
                totalCost: toNumber(row.total_cost),
                totalTokens: toNumber(row.total_tokens),
                promptTokens: toNumber(row.prompt_tokens),
                completionTokens: toNumber(row.completion_tokens),
                avgLatencyMs: toNumber(row.avg_latency_ms),
            };
        }),
    };
};

export const queryUsageEvents = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    requestedLimit?: string
) => {
    const { range, config } = getRangeConfig(requestedRange);
    const dataset = getDatasetName(c);
    const lang = c.get('lang') || 'zh-CN';
    const limit = Math.min(Math.max(Number(requestedLimit || 40) || 40, 1), 100);
    const countRows = await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    count() AS total
FROM ${dataset}
WHERE ${buildRangeWhereClause(config)}
    `.trim());
    const total = toNumber(countRows[0]?.total);

    if (total === 0) {
        return {
            range,
            sampled: true,
            compatibilityWarning: undefined,
            items: [],
        };
    }

    const columnSupport = await getDatasetColumnSupport(c, dataset, buildRangeWhereClause(config));
    const compatibilityWarning = getUsageLogCompatibilityWarning(columnSupport, lang);
    const normalizedTotalCostExpression = buildNormalizedCostExpression(columnSupport, DOUBLE_FIELDS.totalCost);
    const normalizedCacheCostExpression = buildNormalizedCostExpression(columnSupport, DOUBLE_FIELDS.cacheCost);
    const rows = await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    timestamp,
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.routeId, "route_id")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.tokenName, "token_name")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.channelKey, "channel_key")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.providerType, "provider_type")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.requestedModel, "requested_model")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.upstreamModel, "upstream_model")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.result, "result")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.streamMode, "stream_mode")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.errorCode, "error_code")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.statusFamily, "status_family")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.requestId, "request_id")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.traceId, "trace_id")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.clientIp, "client_ip")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.userAgent, "user_agent")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.country, "country")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.region, "region")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.city, "city")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.colo, "colo")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.timezone, "timezone")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.errorSummary, "error_summary")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.promptTokens, "prompt_tokens")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.completionTokens, "completion_tokens")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.cachedTokens, "cached_tokens")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.totalTokens, "total_tokens")},
    ${normalizedTotalCostExpression} AS total_cost,
    ${normalizedCacheCostExpression} AS cache_cost,
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.latencyMs, "latency_ms")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.retryCount, "retry_count")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.upstreamStatus, "upstream_status")}
FROM ${dataset}
WHERE ${buildRangeWhereClause(config)}
ORDER BY timestamp DESC
LIMIT ${limit}
    `.trim());

    return {
        range,
        sampled: true,
        compatibilityWarning,
        items: rows.map((row) => ({
            timestamp: normalizeAnalyticsTimestamp(row.timestamp),
            routeId: toText(row.route_id),
            tokenName: toText(row.token_name),
            channelKey: toText(row.channel_key),
            providerType: toText(row.provider_type),
            requestedModel: toText(row.requested_model),
            upstreamModel: toText(row.upstream_model),
            result: toText(row.result),
            streamMode: toText(row.stream_mode),
            errorCode: toText(row.error_code),
            statusFamily: toText(row.status_family),
            requestId: toText(row.request_id),
            traceId: toText(row.trace_id),
            clientIp: toText(row.client_ip),
            userAgent: toText(row.user_agent),
            country: toText(row.country),
            region: toText(row.region),
            city: toText(row.city),
            colo: toText(row.colo),
            timezone: toText(row.timezone),
            errorSummary: toText(row.error_summary),
            promptTokens: toNumber(row.prompt_tokens),
            completionTokens: toNumber(row.completion_tokens),
            cachedTokens: toNumber(row.cached_tokens),
            totalTokens: toNumber(row.total_tokens),
            totalCost: toNumber(row.total_cost),
            cacheCost: toNumber(row.cache_cost),
            latencyMs: toNumber(row.latency_ms),
            retryCount: toNumber(row.retry_count),
            upstreamStatus: toNumber(row.upstream_status),
        })),
    };
};

export const queryUsageLogRecords = async (
    c: Context<HonoCustomType>,
    params: UsageLogQueryParams
) => {
    const dataset = getDatasetName(c);
    const lang = c.get('lang') || 'zh-CN';
    const timeWindow = buildCustomTimeWindow(params.start, params.end, lang);
    const requestedPage = Math.min(Math.max(Number(params.page || 1) || 1, 1), 1000);
    const dimension = (params.dimension && params.dimension in LOG_FILTER_FIELDS
        ? params.dimension
        : "token") as UsageLogFilterDimension;
    const keyword = params.keyword?.trim();
    const result = params.result === "success" || params.result === "failure" ? params.result : "all";
    const baseCountRows = await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    count() AS total
FROM ${dataset}
WHERE ${timeWindow.whereClause}
    `.trim());
    const baseTotal = toNumber(baseCountRows[0]?.total);

    if (baseTotal === 0) {
        return buildUsageLogEmptyResponse(
            timeWindow,
            dimension,
            keyword || "",
            result,
            undefined
        );
    }

    const columnSupport = await getDatasetColumnSupport(c, dataset, timeWindow.whereClause);
    const compatibilityWarning = getUsageLogCompatibilityWarning(columnSupport, lang);

    if (!hasAnyLegacyLogSchema(columnSupport)) {
        return buildUsageLogEmptyResponse(
            timeWindow,
            dimension,
            keyword || "",
            result,
            compatibilityWarning
        );
    }

    if (keyword && !isUsageLogFilterSupported(columnSupport, dimension)) {
        return buildUsageLogEmptyResponse(
            timeWindow,
            dimension,
            keyword,
            result,
            compatibilityWarning
        );
    }

    if (result !== "all" && !isUsageLogFilterSupported(columnSupport, "result")) {
        return buildUsageLogEmptyResponse(
            timeWindow,
            dimension,
            keyword || "",
            result,
            compatibilityWarning
        );
    }

    const clauses = [timeWindow.whereClause];

    if (keyword) {
        clauses.push(`${LOG_FILTER_FIELDS[dimension]} ILIKE '%${escapeSqlString(keyword)}%'`);
    }

    if (result === "success" || result === "failure") {
        clauses.push(`${BLOB_FIELDS.result} = '${result}'`);
    }

    const whereClause = clauses.join("\n    AND ");
    const countRows = await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    count() AS total
FROM ${dataset}
WHERE ${whereClause}
    `.trim());
    const total = toNumber(countRows[0]?.total);
    const totalPages = total > 0 ? Math.ceil(total / USAGE_LOG_PAGE_SIZE) : 0;
    const page = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;
    const offset = (page - 1) * USAGE_LOG_PAGE_SIZE;

    if (total === 0) {
        return {
            ...buildUsageLogEmptyResponse(
                timeWindow,
                dimension,
                keyword || "",
                result,
                compatibilityWarning
            ),
            page,
        };
    }

    const normalizedTotalCostExpression = buildNormalizedCostExpression(columnSupport, DOUBLE_FIELDS.totalCost);
    const normalizedCacheCostExpression = buildNormalizedCostExpression(columnSupport, DOUBLE_FIELDS.cacheCost);
    const rows = await runAnalyticsQuery<Record<string, unknown>>(c, `
SELECT
    timestamp,
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.routeId, "route_id")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.tokenName, "token_name")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.channelKey, "channel_key")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.providerType, "provider_type")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.requestedModel, "requested_model")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.upstreamModel, "upstream_model")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.result, "result")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.streamMode, "stream_mode")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.errorCode, "error_code")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.statusFamily, "status_family")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.requestId, "request_id")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.traceId, "trace_id")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.clientIp, "client_ip")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.userAgent, "user_agent")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.country, "country")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.region, "region")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.city, "city")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.colo, "colo")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.timezone, "timezone")},
    ${buildBlobSelect(columnSupport, BLOB_FIELDS.errorSummary, "error_summary")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.promptTokens, "prompt_tokens")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.completionTokens, "completion_tokens")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.cachedTokens, "cached_tokens")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.totalTokens, "total_tokens")},
    ${normalizedTotalCostExpression} AS total_cost,
    ${normalizedCacheCostExpression} AS cache_cost,
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.latencyMs, "latency_ms")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.retryCount, "retry_count")},
    ${buildDoubleSelect(columnSupport, DOUBLE_FIELDS.upstreamStatus, "upstream_status")}
FROM ${dataset}
WHERE ${whereClause}
ORDER BY timestamp DESC, route_id DESC, channel_key DESC, requested_model DESC
LIMIT ${USAGE_LOG_PAGE_SIZE}
OFFSET ${offset}
    `.trim());

    return {
        ...buildUsageLogBaseResponse(
            timeWindow,
            dimension,
            keyword || "",
            result,
            compatibilityWarning
        ),
        page,
        pageSize: USAGE_LOG_PAGE_SIZE,
        total,
        totalPages,
        count: rows.length,
        hasPrevPage: totalPages > 0 && page > 1,
        hasNextPage: totalPages > 0 && page < totalPages,
        items: rows.map((row) => ({
            timestamp: normalizeAnalyticsTimestamp(row.timestamp),
            routeId: toText(row.route_id),
            tokenName: toText(row.token_name),
            channelKey: toText(row.channel_key),
            providerType: toText(row.provider_type),
            requestedModel: toText(row.requested_model),
            upstreamModel: toText(row.upstream_model),
            result: toText(row.result),
            streamMode: toText(row.stream_mode),
            errorCode: toText(row.error_code),
            statusFamily: toText(row.status_family),
            requestId: toText(row.request_id),
            traceId: toText(row.trace_id),
            clientIp: toText(row.client_ip),
            userAgent: toText(row.user_agent),
            country: toText(row.country),
            region: toText(row.region),
            city: toText(row.city),
            colo: toText(row.colo),
            timezone: toText(row.timezone),
            errorSummary: toText(row.error_summary),
            promptTokens: toNumber(row.prompt_tokens),
            completionTokens: toNumber(row.completion_tokens),
            cachedTokens: toNumber(row.cached_tokens),
            totalTokens: toNumber(row.total_tokens),
            totalCost: toNumber(row.total_cost),
            cacheCost: toNumber(row.cache_cost),
            latencyMs: toNumber(row.latency_ms),
            retryCount: toNumber(row.retry_count),
            upstreamStatus: toNumber(row.upstream_status),
        })),
    };
};
