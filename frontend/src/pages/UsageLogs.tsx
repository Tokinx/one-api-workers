import { startTransition, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { AnalyticsEventItem, AnalyticsRange, UsageLogFilterDimension, UsageLogFilters, UsageLogSearchData } from "@/types";
import { PageContainer } from "@/components/ui/page-container";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { readScopedCache, writeScopedCache } from "@/lib/local-cache";
import { cn, formatCurrency, parseUtcTimestamp } from "@/lib/utils";
import { Eye, RefreshCw, RotateCcw, Search } from "lucide-react";

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

const formatCompactNumber = (value: number): string => {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
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

const DetailField = ({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) => {
  const text = String(value || "--");

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm text-foreground break-all", mono && "font-mono text-xs")}>{text}</div>
    </div>
  );
};

export function UsageLogs() {
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
  const [draftFilters, setDraftFilters] = useState<UsageLogFilterState>(
    () => initialDraftFilters,
  );
  const [appliedFilters, setAppliedFilters] = useState<UsageLogFilterState>(
    () => initialAppliedFilters,
  );
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

  const handleReset = () => {
    const preset = createFilterPreset("24h");
    setDraftFilters(preset);
    startTransition(() => {
      setCurrentPage(1);
      setAppliedFilters(preset);
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
        {/* <Card className="overflow-hidden border-0 bg-gradient-to-br from-slate-950 to-slate-900 text-slate-50">
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Diagnostics
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight">面向排障的请求日志视图</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  记录 request id、trace id、错误摘要、IP、UA 与地理位置，适合定位某一批异常设备或单个失败链路。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => applyPreset(24)}>最近 24 小时</Button>
                <Button variant="secondary" size="sm" onClick={() => applyPreset(24 * 7)}>最近 7 天</Button>
                <Button variant="secondary" size="sm" onClick={() => applyPreset(24 * 30)}>最近 30 天</Button>
              </div>
            </div>
          </CardContent>
        </Card> */}

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
                <Button variant="outline" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">日志结果</CardTitle>
            <CardDescription>日志可能存在 30 秒左右的延迟</CardDescription>
          </CardHeader>
          <CardContent>
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
                          <div className="mt-1 text-xs text-muted-foreground">{formatCurrency(item.totalCost)}</div>
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
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>使用日志详情</DialogTitle>
            <DialogDescription>查看本次请求的完整上下文、客户端信息、错误摘要与资源消耗。</DialogDescription>
          </DialogHeader>

          {selectedItem && (
            <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailField label="时间" value={formatDateTime(selectedItem.timestamp)} />
                <DetailField label="结果" value={selectedItem.result === "success" ? "成功" : "失败"} />
                <DetailField label="HTTP 状态" value={selectedItem.upstreamStatus || "--"} />
                <DetailField label="状态族" value={selectedItem.statusFamily || "--"} />
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailField label="令牌名称" value={selectedItem.tokenName || "--"} />
                <DetailField label="渠道标识" value={selectedItem.channelKey || "--"} />
                <DetailField label="服务商" value={selectedItem.providerType || "--"} />
                <DetailField label="接口路由" value={selectedItem.routeId || "--"} />
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailField label="请求模型" value={selectedItem.requestedModel || "--"} />
                <DetailField label="上游模型" value={selectedItem.upstreamModel || "--"} />
                <DetailField label="流式模式" value={selectedItem.streamMode === "stream" ? "流式" : "非流式"} />
                <DetailField label="重试次数" value={selectedItem.retryCount} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <DetailField label="Request ID" value={selectedItem.requestId || "--"} mono />
                <DetailField label="Trace ID" value={selectedItem.traceId || "--"} mono />
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <DetailField label="客户端 IP" value={selectedItem.clientIp || "--"} mono />
                <DetailField
                  label="地理位置"
                  value={
                    [selectedItem.country, selectedItem.region, selectedItem.city].filter(Boolean).join(" / ") || "--"
                  }
                />
                <DetailField
                  label="边缘节点 / 时区"
                  value={[selectedItem.colo, selectedItem.timezone].filter(Boolean).join(" · ") || "--"}
                />
              </div>

              <div className="grid gap-3">
                <DetailField label="User-Agent" value={selectedItem.userAgent || "--"} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <DetailField label="错误码" value={selectedItem.errorCode || "--"} />
                <DetailField label="错误摘要" value={selectedItem.errorSummary || "--"} />
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailField label="总 Tokens" value={formatCompactNumber(selectedItem.totalTokens)} />
                <DetailField
                  label="输入 / 输出 Tokens"
                  value={`${formatCompactNumber(selectedItem.promptTokens)} / ${formatCompactNumber(selectedItem.completionTokens)}`}
                />
                <DetailField label="总成本" value={formatCurrency(selectedItem.totalCost)} />
                <DetailField label="延迟" value={formatDuration(selectedItem.latencyMs)} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
