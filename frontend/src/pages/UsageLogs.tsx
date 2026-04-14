import { startTransition, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import {
  AnalyticsEventItem,
  AnalyticsRange,
  UsageLogFilterDimension,
  UsageLogFilters,
  UsageLogSearchData,
} from "@/types";
import { PageContainer } from "@/components/ui/page-container";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useBillingConfig } from "@/hooks/use-billing-config";
import { readScopedCache, writeScopedCache } from "@/lib/local-cache";
import { cn, formatCompactNumber, formatCurrency, parseUtcTimestamp } from "@/lib/utils";
import { Eye, RefreshCw, Search } from "lucide-react";

type UsageLogFilterState = {
  range: AnalyticsRange;
  dimension: UsageLogFilterDimension;
  keyword: string;
  result: "all" | "success" | "failure";
};

type UsageLogPageCacheSnapshot = {
  draftFilters: UsageLogFilterState;
  appliedFilters: UsageLogFilterState;
  currentPage: number;
  data: UsageLogSearchData;
};

const FILTER_DIMENSIONS: Array<{ value: UsageLogFilterDimension; label: string }> = [
  { value: "token", label: "令牌名称" },
  { value: "channel", label: "渠道标识" },
  { value: "model", label: "请求模型" },
  { value: "provider", label: "服务商类型" },
  { value: "route", label: "接口路由" },
  { value: "requestId", label: "Request ID" },
  { value: "traceId", label: "Trace ID" },
  { value: "clientIp", label: "请求 IP" },
  { value: "userAgent", label: "User-Agent" },
  { value: "country", label: "国家地区" },
  { value: "region", label: "省州 / Region" },
  { value: "city", label: "城市 / City" },
  { value: "colo", label: "边缘节点 / Colo" },
  { value: "timezone", label: "时区 / Timezone" },
  { value: "result", label: "结果" },
  { value: "errorCode", label: "错误码" },
  { value: "errorSummary", label: "错误摘要" },
];

const RESULT_OPTIONS: Array<{ value: "all" | "success" | "failure"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "success", label: "仅成功" },
  { value: "failure", label: "仅失败" },
];

const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" },
];

const PAGINATION_WINDOW_SIZE = 5;
const USAGE_LOGS_PAGE_CACHE_KEY = "usage-logs:page:v2";
const USAGE_LOG_RANGE_DURATION_MS: Record<AnalyticsRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

const isAnalyticsRange = (value: unknown): value is AnalyticsRange => {
  return RANGE_OPTIONS.some((option) => option.value === value);
};

const createFilterPreset = (range: AnalyticsRange): UsageLogFilterState => {
  return {
    range,
    dimension: "token",
    keyword: "",
    result: "all",
  };
};

const hydrateUsageLogFilters = (
  filters: UsageLogFilterState | undefined,
  fallback: UsageLogFilterState,
): UsageLogFilterState => {
  return {
    range: isAnalyticsRange(filters?.range) ? filters.range : fallback.range,
    dimension: filters?.dimension ?? fallback.dimension,
    keyword: filters?.keyword ?? fallback.keyword,
    result: filters?.result ?? fallback.result,
  };
};

const formatDateTime = (value: string): string => {
  const date = parseUtcTimestamp(value);
  if (!date) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const formatDuration = (value: number): string => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`;
  }

  return `${Math.round(value)} ms`;
};

const getUsageLogWindow = (range: AnalyticsRange): { start: Date; end: Date } => {
  const end = new Date();
  const start = new Date(end.getTime() - USAGE_LOG_RANGE_DURATION_MS[range]);

  return { start, end };
};

const buildSearchParams = (filters: UsageLogFilterState, page: number): UsageLogFilters => {
  const { start, end } = getUsageLogWindow(filters.range);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    dimension: filters.dimension,
    keyword: filters.keyword.trim() || undefined,
    result: filters.result,
    page,
  };
};

const isSameUsageLogFilterState = (left: UsageLogFilterState, right: UsageLogFilterState): boolean => {
  return (
    left.range === right.range &&
    left.dimension === right.dimension &&
    left.keyword === right.keyword &&
    left.result === right.result
  );
};

const ClientSummary = ({ item }: { item: AnalyticsEventItem }) => {
  const locationParts = [item.country, item.region, item.city].filter(Boolean);

  return (
    <div className="min-w-[190px]">
      <div className="font-medium">{item.clientIp || "--"}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {locationParts.length > 0 ? locationParts.join(" / ") : "未知位置"}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {item.colo || "--"} {item.timezone ? `· ${item.timezone}` : ""}
      </div>
    </div>
  );
};

const formatDetailValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "--";
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return "--";
  }

  return String(value);
};

const DetailMetric = ({ label, value }: { label: string; value: string | number }) => {
  const text = formatDetailValue(value);

  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/10 py-2.5 last:border-b-0">
      <div className="text-xs font-medium uppercase text-slate-300">{label}</div>
      <div className={cn("text-right text-slate-50 break-all font-mono text-xs")}>{text}</div>
    </div>
  );
};

const DetailSection = ({ title, children }: { title: string; children: React.ReactNode }) => {
  return (
    <section className="space-y-2">
      <div className="text-sm uppercase text-slate-600 font-bold">{title}</div>
      {children}
    </section>
  );
};

const DetailRow = ({
  label,
  value,
  mono = false,
  tone = "default",
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  tone?: "default" | "success" | "danger" | "subtle";
}) => {
  const text = formatDetailValue(value);
  const toneClassName =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "danger"
        ? "text-rose-600 dark:text-rose-400"
        : tone === "subtle"
          ? "text-muted-foreground"
          : "text-foreground";

  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("break-all", toneClassName, "font-mono text-xs")}>{text}</div>
    </div>
  );
};

export function UsageLogs() {
  const { data: billingConfig } = useBillingConfig();
  const displayDecimals = billingConfig?.displayDecimals ?? 6;
  const defaultFilters = useMemo(() => createFilterPreset("24h"), []);
  const cachedLogsSnapshot = useMemo(() => readScopedCache<UsageLogPageCacheSnapshot>(USAGE_LOGS_PAGE_CACHE_KEY), []);
  const initialDraftFilters = useMemo(
    () => hydrateUsageLogFilters(cachedLogsSnapshot?.data.draftFilters, defaultFilters),
    [cachedLogsSnapshot, defaultFilters],
  );
  const initialAppliedFilters = useMemo(
    () => hydrateUsageLogFilters(cachedLogsSnapshot?.data.appliedFilters, defaultFilters),
    [cachedLogsSnapshot, defaultFilters],
  );
  const [draftFilters, setDraftFilters] = useState<UsageLogFilterState>(() => initialDraftFilters);
  const [appliedFilters, setAppliedFilters] = useState<UsageLogFilterState>(() => initialAppliedFilters);
  const [currentPage, setCurrentPage] = useState(() => cachedLogsSnapshot?.data.currentPage ?? 1);
  const [selectedItem, setSelectedItem] = useState<AnalyticsEventItem | null>(null);
  const initialLogsData =
    cachedLogsSnapshot?.data &&
    cachedLogsSnapshot.data.currentPage === currentPage &&
    isSameUsageLogFilterState(cachedLogsSnapshot.data.appliedFilters, appliedFilters)
      ? cachedLogsSnapshot.data.data
      : undefined;

  const logsQuery = useQuery({
    queryKey: ["usage-logs", appliedFilters, currentPage],
    queryFn: async () => {
      const response = await apiClient.getUsageLogs(buildSearchParams(appliedFilters, currentPage));
      const data = response.data as UsageLogSearchData;
      writeScopedCache(USAGE_LOGS_PAGE_CACHE_KEY, {
        draftFilters: appliedFilters,
        appliedFilters,
        currentPage: data.page,
        data,
      });
      return data;
    },
    initialData: initialLogsData,
    initialDataUpdatedAt: initialLogsData ? cachedLogsSnapshot?.updatedAt : undefined,
  });

  const activePage = logsQuery.data?.page ?? currentPage;
  const totalPages = logsQuery.data?.totalPages ?? 0;
  const totalItems = logsQuery.data?.total ?? 0;
  const pageSize = logsQuery.data?.pageSize ?? 50;
  const currentStart = totalItems > 0 ? (activePage - 1) * pageSize + 1 : 0;
  const currentEnd = totalItems > 0 ? currentStart + (logsQuery.data?.count ?? 0) - 1 : 0;
  const visiblePages = useMemo(() => {
    if (totalPages <= 1) {
      return totalPages === 1 ? [1] : [];
    }

    const halfWindow = Math.floor(PAGINATION_WINDOW_SIZE / 2);
    let start = Math.max(1, activePage - halfWindow);
    let end = Math.min(totalPages, start + PAGINATION_WINDOW_SIZE - 1);

    start = Math.max(1, end - PAGINATION_WINDOW_SIZE + 1);

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [activePage, totalPages]);

  const handleSearch = () => {
    startTransition(() => {
      setCurrentPage(1);
      setAppliedFilters({ ...draftFilters });
    });
  };

  const handlePageChange = (page: number) => {
    if (page < 1 || page === activePage || (totalPages > 0 && page > totalPages)) {
      return;
    }

    startTransition(() => {
      setCurrentPage(page);
    });
  };

  return (
    <PageContainer
      title="使用日志"
      description="按最近时间范围与维度筛选可读取的使用记录，重点用于排查异常设备、失败请求和上游问题。"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => logsQuery.refetch()} disabled={logsQuery.isFetching}>
            <RefreshCw className={cn("h-4 w-4", logsQuery.isFetching && "animate-spin")} />
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4">
            {logsQuery.data?.compatibilityWarning && (
              <Alert>
                <AlertDescription>{logsQuery.data.compatibilityWarning}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:grid-cols-5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">时间范围</label>
                <Select
                  value={draftFilters.range}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      range: event.target.value as AnalyticsRange,
                    }))
                  }
                >
                  {RANGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">查询维度</label>
                <Select
                  value={draftFilters.dimension}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      dimension: event.target.value as UsageLogFilterDimension,
                    }))
                  }
                >
                  {FILTER_DIMENSIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">查询状态</label>
                <Select
                  value={draftFilters.result}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      result: event.target.value as UsageLogFilterState["result"],
                    }))
                  }
                >
                  {RESULT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">关键字</label>
                <Input
                  value={draftFilters.keyword}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, keyword: event.target.value }))}
                  placeholder="支持 ILIKE 模糊匹配"
                />
              </div>

              <div className="flex flex-wrap items-end gap-2 sm:col-end-4 xl:col-end-6">
                <div className="flex-1"></div>
                <Button onClick={handleSearch}>
                  <Search className="h-4 w-4" />
                  查询
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="p-6 pt-4">
          {logsQuery.isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">日志加载中...</div>
          ) : logsQuery.data?.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-3 font-medium">时间</th>
                    <th className="px-2 py-3 font-medium">模型 / 令牌</th>
                    <th className="px-2 py-3 font-medium">端点 / 渠道</th>
                    <th className="px-2 py-3 font-medium">结果 / 状态</th>
                    <th className="px-2 py-3 font-medium">方式 / 用时</th>
                    <th className="px-2 py-3 font-medium">资源消耗</th>
                    <th className="px-2 py-3 font-medium text-right">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {logsQuery.data.items.map((item) => (
                    <tr
                      key={`${item.requestId || item.timestamp}-${item.traceId || item.channelKey}`}
                      className="border-b align-top last:border-0"
                    >
                      <td className="px-2 py-3">
                        <div className="text-xs text-muted-foreground">{formatDateTime(item.timestamp)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.requestId || "--"}</div>
                      </td>

                      <td className="px-2 py-3">
                        <div className="text-xs text-muted-foreground">{item.requestedModel || "--"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.tokenName || "未命名令牌"}</div>
                      </td>
                      <td className="px-2 py-3">
                        <div className="text-xs text-muted-foreground">{item.providerType || "--"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.channelKey || "--"}</div>
                      </td>

                      <td className="px-2 py-3">
                        <div className="text-xs text-muted-foreground">
                          <span
                            className={cn(
                              item.result === "success"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400",
                            )}
                          >
                            {item.result === "success" ? "成功" : "失败"}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.upstreamStatus || "--"} · 重试 {item.retryCount}
                        </div>
                      </td>

                      <td className="px-2 py-3">
                        <div className="text-xs text-muted-foreground">
                          {item.streamMode === "stream" ? "流式" : "非流式"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatDuration(item.latencyMs)}</div>
                      </td>

                      <td className="px-2 py-3">
                        {/* <div className="font-medium">{formatCompactNumber(item.totalTokens)} tokens</div> */}
                        <div className="text-xs text-muted-foreground">
                          输入 {formatCompactNumber(item.promptTokens)} / 输出{" "}
                          {formatCompactNumber(item.completionTokens)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatCurrency(item.totalCost, displayDecimals)}
                        </div>
                      </td>

                      <td className="px-2 py-3 text-right">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-gray-600 border-0 rounded-0 shadow-none"
                          onClick={() => setSelectedItem(item)}
                          aria-label="查看详情"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {totalItems > 0 ? `显示第 ${currentStart}-${currentEnd} 条，共 ${totalItems} 条` : "暂无记录"}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(activePage - 1)}
                    disabled={!logsQuery.data?.hasPrevPage || logsQuery.isFetching}
                  >
                    上一页
                  </Button>
                  {visiblePages.map((page) => (
                    <Button
                      key={page}
                      variant={page === activePage ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePageChange(page)}
                      disabled={logsQuery.isFetching}
                    >
                      {page}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(activePage + 1)}
                    disabled={!logsQuery.data?.hasNextPage || logsQuery.isFetching}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-14 text-center">
              <p className="text-sm font-medium">没有匹配的日志记录</p>
              <p className="mt-1 text-sm text-muted-foreground">调整时间范围、维度或关键字后重试。</p>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>日志详情</DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
              <section className="overflow-hidden rounded-xl bg-gradient-to-tr from-slate-950 via-slate-500 to-slate-800 p-5 text-slate-50">
                <div className="flex flex-col gap-4 xl:flex-row xl:justify-between">
                  <div className="min-w-0 flex-1 flex flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={selectedItem.result === "success" ? "success" : "destructive"}
                        className="rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em]"
                      >
                        {selectedItem.result === "success" ? "成功" : "失败"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-white/10 backdrop-blur-xl bg-white/10 px-3 py-1 text-xs text-slate-100"
                      >
                        {selectedItem.streamMode === "stream" ? "流式" : "非流式"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-white/10 backdrop-blur-xl bg-white/10 px-3 py-1 font-mono text-xs text-slate-100 uppercase"
                      >
                        {formatDetailValue(selectedItem.routeId)}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-col h-full">
                      <div className="flex-1"></div>
                      <div className="break-all text-3xl font-mono font-bold tracking-tight">
                        {formatDetailValue(selectedItem.requestedModel || selectedItem.upstreamModel)}
                      </div>
                      <div className="flex-1"></div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs/5 text-slate-300/80 uppercase">
                        <div className="border-r border-slate-50/10 pr-4">
                          令牌
                          <br />
                          <span className="text-slate-100">{formatDetailValue(selectedItem.tokenName)}</span>
                        </div>
                        <div className="border-r border-slate-50/10 pr-4">
                          端点
                          <br />
                          <span className="text-slate-100">{formatDetailValue(selectedItem.providerType)}</span>
                        </div>
                        <div>
                          渠道
                          <br />
                          <span className="text-slate-100">{formatDetailValue(selectedItem.channelKey)}</span>
                        </div>
                      </div>
                      <div className="flex-1"></div>
                    </div>
                  </div>

                  <div className="min-w-0 rounded-lg bg-white/[0.04] px-4 py-2 xl:w-[340px] backdrop-blur-xl">
                    <DetailMetric label="总成本" value={formatCurrency(selectedItem.totalCost, displayDecimals)} />
                    <DetailMetric label="延迟" value={formatDuration(selectedItem.latencyMs)} />
                    <DetailMetric label="总 Tokens" value={formatCompactNumber(selectedItem.totalTokens)} />
                    <DetailMetric label="发生时间" value={formatDateTime(selectedItem.timestamp)} />
                  </div>
                </div>
              </section>

              <DetailSection title="请求概览">
                <div className="grid gap-x-8 border-t border-border/60 pt-2 md:grid-cols-2">
                  <div className="divide-y divide-border/60">
                    <DetailRow label="请求模型" value={selectedItem.requestedModel} />
                    <DetailRow label="上游模型" value={selectedItem.upstreamModel} />
                    <DetailRow label="令牌名称" value={selectedItem.tokenName} />
                    <DetailRow label="渠道标识" value={selectedItem.channelKey} />
                    <DetailRow label="服务商" value={selectedItem.providerType} />
                  </div>
                  <div className="divide-y divide-border/60">
                    <DetailRow label="接口路由" value={selectedItem.routeId} />
                    <DetailRow
                      label="HTTP 状态"
                      value={selectedItem.upstreamStatus}
                      tone={selectedItem.result === "success" ? "success" : "danger"}
                    />
                    <DetailRow label="流式模式" value={selectedItem.streamMode === "stream" ? "流式" : "非流式"} />
                    <DetailRow label="重试次数" value={selectedItem.retryCount} />
                    <DetailRow label="状态族" value={selectedItem.statusFamily} tone="subtle" />
                  </div>
                </div>
              </DetailSection>

              <DetailSection title="计费与性能">
                <div className="grid gap-x-8 border-t border-border/60 pt-2 md:grid-cols-2">
                  <div className="divide-y divide-border/60">
                    <DetailRow label="总成本" value={formatCurrency(selectedItem.totalCost, displayDecimals)} />
                    <DetailRow label="延迟" value={formatDuration(selectedItem.latencyMs)} />
                    <DetailRow label="总 Tokens" value={formatCompactNumber(selectedItem.totalTokens)} />
                  </div>
                  <div className="divide-y divide-border/60">
                    <DetailRow label="输入 Tokens" value={formatCompactNumber(selectedItem.promptTokens)} />
                    <DetailRow label="输出 Tokens" value={formatCompactNumber(selectedItem.completionTokens)} />
                    <DetailRow label="缓存 Tokens" value={formatCompactNumber(selectedItem.cachedTokens)} />
                  </div>
                </div>
              </DetailSection>

              <DetailSection title="诊断标识">
                <div className="grid gap-x-8 border-t border-border/60 pt-2 md:grid-cols-2">
                  <div className="divide-y divide-border/60">
                    <DetailRow label="Request ID" value={selectedItem.requestId} />
                    <DetailRow label="Trace ID" value={selectedItem.traceId} />
                  </div>
                  <div className="divide-y divide-border/60">
                    <DetailRow label="时间" value={formatDateTime(selectedItem.timestamp)} />
                    <DetailRow
                      label="错误码"
                      value={selectedItem.errorCode}
                      tone={selectedItem.result === "success" ? "subtle" : "danger"}
                    />
                  </div>
                </div>

                {selectedItem.result !== "success" && selectedItem.errorSummary && (
                  <div className="break-all p-3 text-xs leading-5 text-red-500 bg-red-50/50 border border-red-200 rounded-sm">
                    {formatDetailValue(selectedItem.errorSummary)}
                  </div>
                )}
              </DetailSection>

              <DetailSection title="客户端环境">
                <div className="grid gap-x-8 border-t border-border/60 pt-2 md:grid-cols-2">
                  <div className="divide-y divide-border/60">
                    <DetailRow label="客户端 IP" value={selectedItem.clientIp} />
                    <DetailRow
                      label="地理位置"
                      value={[selectedItem.country, selectedItem.region, selectedItem.city].filter(Boolean).join(" / ")}
                    />
                  </div>
                  <div className="divide-y divide-border/60">
                    <DetailRow
                      label="边缘节点 / 时区"
                      value={[selectedItem.colo, selectedItem.timezone].filter(Boolean).join(" · ")}
                    />
                    <DetailRow label="User-Agent" value={selectedItem.userAgent} />
                  </div>
                </div>
              </DetailSection>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
