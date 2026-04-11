type Variables = {
    lang: string | undefined | null
}

type AnalyticsEngineDataPoint = {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
}

interface AnalyticsEngineDataset {
    writeDataPoint: (point: AnalyticsEngineDataPoint) => void;
    writeDataPoints?: (points: AnalyticsEngineDataPoint[]) => void;
}

type CloudflareBindings = {
    DB: D1Database;
    ASSETS: Fetcher;
    ADMIN_TOKEN: string;
    CF_API_TOKEN?: string;
    CF_ACCOUNT_ID?: string;
    FRONTEND_DEV_SERVER_URL?: string;
    USAGE_ANALYTICS?: AnalyticsEngineDataset;
    USAGE_ANALYTICS_DATASET?: string;
}

type HonoCustomType = {
    "Bindings": CloudflareBindings;
    "Variables": Variables;
}

// 数据库表行的基础结构
type BaseDbRow = {
    created_at: string;
    updated_at: string;
}

// channel_config 表的行结构
type ChannelConfigRow = BaseDbRow & {
    key: string;
    value: string; // JSON 字符串，解析后为 ChannelConfig 类型
}

// api_token 表的行结构
type ApiTokenRow = BaseDbRow & {
    key: string;
    value: string; // JSON 字符串，解析后为 ApiTokenData 类型
    usage: number;
}

type ChannelType =
    | "azure-openai"
    | "openai"
    | "gemini"
    | "azure-openai-audio"
    | "openai-audio"
    | "claude"
    | "claude-to-openai"
    | "openai-responses"
    | "azure-openai-responses"
    | undefined
    | null;

type ChannelModelMapping = {
    id: string;
    name: string;
}

type ChannelConfig = {
    name: string;
    type: ChannelType;
    endpoint: string;
    api_key?: string;
    api_keys?: string[];
    auto_retry?: boolean;
    auto_rotate?: boolean;
    models?: ChannelModelMapping[];
    supported_models?: string[];
    deployment_mapper?: Record<string, string>;
    model_pricing?: Record<string, ModelPricing>;
}

type ChannelConfigMap = {
    [key: string]: ChannelConfig;
}

type OpenAIResponse = {
    usage?: Usage
}

type Usage = {
    prompt_tokens?: number,
    completion_tokens?: number,
    total_tokens?: number,
    cached_tokens?: number,
}

type oawKeyPayload = {
    channel_key: string;
    multipler: number | undefined | null;
}

type CommonResponse = {
    success?: boolean;
    message?: string;
    data?: any;
}

type ModelPricing = {
    input: number;
    output: number;
    cache?: number;
    request?: number;
}

type ApiTokenData = {
    name: string;
    channel_keys: string[];
    total_quota: number;
}

type RequestTrackingState = {
    retryCount: number;
    upstreamStatus?: number;
    errorSummary?: string;
}
