export interface Channel {
  key: string
  value: string | ChannelConfig
  usage?: number
}

export interface ChannelModelMapping {
  id: string
  name: string
}

export interface ChannelConfig {
  name: string
  type: 'openai' | 'gemini' | 'azure-openai' | 'openai-audio' | 'azure-openai-audio' | 'claude' | 'claude-to-openai' | 'openai-responses' | 'azure-openai-responses'
  endpoint: string
  enabled?: boolean
  weight?: number
  api_key?: string
  api_keys?: string[]
  auto_retry?: boolean
  auto_rotate?: boolean
  models?: ChannelModelMapping[]
  supported_models?: string[]
  deployment_mapper?: Record<string, string>
  model_pricing?: Record<string, PricingModel>
}

export interface Token {
  key: string
  value: string | TokenConfig
  usage?: number
}

export interface TokenConfig {
  name: string
  channel_keys?: string[]
  total_quota: number
}

export interface PricingModel {
  input: number
  output: number
  cache?: number
  request?: number
}

export type PricingConfig = Record<string, PricingModel>

export type AnalyticsRange = '24h' | '7d' | '30d' | '90d'
export type AnalyticsBreakdownDimension = 'token' | 'channel' | 'model' | 'provider'
export type UsageLogFilterDimension =
  | 'route'
  | 'token'
  | 'channel'
  | 'model'
  | 'provider'
  | 'requestId'
  | 'traceId'
  | 'clientIp'
  | 'userAgent'
  | 'country'
  | 'region'
  | 'city'
  | 'colo'
  | 'timezone'
  | 'result'
  | 'errorCode'
  | 'errorSummary'

export interface AnalyticsOverviewData {
  range: AnalyticsRange
  totals: {
    requests: number
    successes: number
    failures: number
    successRate: number
    totalCost: number
    totalTokens: number
    promptTokens: number
    completionTokens: number
    avgLatencyMs: number
  }
}

export interface AnalyticsTrendPoint {
  timestamp: string
  requests: number
  successes: number
  failures: number
  successRate: number
  totalCost: number
}

export interface AnalyticsTrendData {
  range: AnalyticsRange
  bucket: string
  points: AnalyticsTrendPoint[]
}

export interface AnalyticsBreakdownItem {
  label: string
  requests: number
  successes: number
  failures: number
  successRate: number
  totalCost: number
  promptTokens: number
  completionTokens: number
  avgLatencyMs: number
}

export interface AnalyticsBreakdownData {
  range: AnalyticsRange
  dimension: AnalyticsBreakdownDimension
  items: AnalyticsBreakdownItem[]
}

export interface AnalyticsEventItem {
  timestamp: string
  routeId: string
  tokenName: string
  channelKey: string
  providerType: string
  requestedModel: string
  upstreamModel: string
  result: string
  streamMode: string
  errorCode: string
  statusFamily: string
  requestId: string
  traceId: string
  clientIp: string
  userAgent: string
  country: string
  region: string
  city: string
  colo: string
  timezone: string
  errorSummary: string
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  totalTokens: number
  totalCost: number
  latencyMs: number
  retryCount: number
  upstreamStatus: number
}

export interface AnalyticsEventsData {
  range: AnalyticsRange
  sampled: boolean
  compatibilityWarning?: string
  items: AnalyticsEventItem[]
}

export interface UsageLogFilters {
  start?: string
  end?: string
  dimension?: UsageLogFilterDimension
  keyword?: string
  result?: 'all' | 'success' | 'failure'
  page?: number
}

export interface UsageLogSearchData {
  sampled: boolean
  dimension: UsageLogFilterDimension
  keyword: string
  result: 'all' | 'success' | 'failure'
  startTime: string
  endTime: string
  compatibilityWarning?: string
  page: number
  pageSize: number
  total: number
  totalPages: number
  count: number
  hasPrevPage: boolean
  hasNextPage: boolean
  items: AnalyticsEventItem[]
}

export interface ApiResponse<T = any> {
  data?: T
  error?: string
  message?: string
}

export interface TestRequest {
  model: string
  messages?: Array<{
    role: string
    content: string
  }>
  prompt?: string
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

export interface AudioTestResponse {
  object: 'audio'
  contentType: string
  size: number
  url: string
  filename: string
}

export interface JsonTestResponse {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      role: string
      content: string
    }
    text?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  [key: string]: any
}

export type TestResponse = JsonTestResponse | AudioTestResponse
