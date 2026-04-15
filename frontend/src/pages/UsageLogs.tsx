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
import { useTranslation } from "react-i18next";
import { getLocaleString } from "@/i18n";

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

const RANGE_VALUES: AnalyticsRange[] = ["24h", "7d", "30d", "90d"];

const PAGINATION_WINDOW_SIZE = 5;
const USAGE_LOGS_PAGE_CACHE_KEY = "usage-logs:page:v2";
const USAGE_LOG_RANGE_DURATION_MS: Record<AnalyticsRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

const isAnalyticsRange = (value: unknown): value is AnalyticsRange => {
  return RANGE_VALUES.some((v) => v === value);
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

  return date.toLocaleString(getLocaleString(), {
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
  const { t } = useTranslation();
  const locationParts = [item.country, item.region, item.city].filter(Boolean);

  return (
    <div className="min-w-[190px]">
      <div className="font-medium">{item.clientIp || "--"}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {locationParts.length > 0 ? locationParts.join(" / ") : t('usageLogs.unknownLocation')}
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
  const { t } = useTranslation();
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

  const FILTER_DIMENSIONS: Array<{ value: UsageLogFilterDimension; label: string }> = [
    { value: "token", label: t('usageLogs.dimToken') },
    { value: "channel", label: t('usageLogs.dimChannel') },
    { value: "model", label: t('usageLogs.dimModel') },
    { value: "provider", label: t('usageLogs.dimProvider') },
    { value: "route", label: t('usageLogs.dimRoute') },
    { value: "requestId", label: t('usageLogs.dimRequestId') },
    { value: "traceId", label: t('usageLogs.dimTraceId') },
    { value: "clientIp", label: t('usageLogs.dimClientIp') },
    { value: "userAgent", label: t('usageLogs.dimUserAgent') },
    { value: "country", label: t('usageLogs.dimCountry') },
    { value: "region", label: t('usageLogs.dimRegion') },
    { value: "city", label: t('usageLogs.dimCity') },
    { value: "colo", label: t('usageLogs.dimColo') },
    { value: "timezone", label: t('usageLogs.dimTimezone') },
    { value: "result", label: t('usageLogs.dimResult') },
    { value: "errorCode", label: t('usageLogs.dimErrorCode') },
    { value: "errorSummary", label: t('usageLogs.dimErrorSummary') },
  ];

  const RESULT_OPTIONS: Array<{ value: "all" | "success" | "failure"; label: string }> = [
    { value: "all", label: t('usageLogs.resultAll') },
    { value: "success", label: t('usageLogs.resultSuccess') },
    { value: "failure", label: t('usageLogs.resultFailure') },
  ];

  const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
    { value: "24h", label: t('analytics.range24h') },
    { value: "7d", label: t('analytics.range7d') },
    { value: "30d", label: t('analytics.range30d') },
    { value: "90d", label: t('analytics.range90d') },
  ];

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
    const end = Math.min(totalPages, start + PAGINATION_WINDOW_SIZE - 1);

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
      title={t('usageLogs.title')}
      description={t('usageLogs.description')}
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
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('usageLogs.timeRange')}</label>
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
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('usageLogs.queryDimension')}</label>
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
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('usageLogs.queryStatus')}</label>
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
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('usageLogs.keyword')}</label>
                <Input
                  value={draftFilters.keyword}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, keyword: event.target.value }))}
                  placeholder={t('usageLogs.keywordPlaceholder')}
                />
              </div>

              <div className="flex flex-wrap items-end gap-2 sm:col-end-4 xl:col-end-6">
                <div className="flex-1"></div>
                <Button onClick={handleSearch}>
                  <Search className="h-4 w-4" />
                  {t('usageLogs.query')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="p-6 pt-4">
          {logsQuery.isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">{t('usageLogs.logsLoading')}</div>
          ) : logsQuery.data?.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-3 font-medium">{t('usageLogs.colTime')}</th>
                    <th className="px-2 py-3 font-medium">{t('usageLogs.colModelToken')}</th>
                    <th className="px-2 py-3 font-medium">{t('usageLogs.colEndpointChannel')}</th>
                    <th className="px-2 py-3 font-medium">{t('usageLogs.colResultStatus')}</th>
                    <th className="px-2 py-3 font-medium">{t('usageLogs.colModeLatency')}</th>
                    <th className="px-2 py-3 font-medium">{t('usageLogs.colResourceUsage')}</th>
                    <th className="px-2 py-3 font-medium text-right">{t('usageLogs.colDetail')}</th>
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
                        <div className="mt-1 text-xs text-muted-foreground">{item.tokenName || t('usageLogs.unknownToken')}</div>
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
                            {item.result === "success" ? t('usageLogs.success') : t('usageLogs.failure')}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.upstreamStatus || "--"} · {t('usageLogs.retry', { count: item.retryCount })}
                        </div>
                      </td>

                      <td className="px-2 py-3">
                        <div className="text-xs text-muted-foreground">
                          {item.streamMode === "stream" ? t('usageLogs.stream') : t('usageLogs.nonStream')}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatDuration(item.latencyMs)}</div>
                      </td>

                      <td className="px-2 py-3">
                        {/* <div className="font-medium">{formatCompactNumber(item.totalTokens)} tokens</div> */}
                        <div className="text-xs text-muted-foreground">
                          {formatCompactNumber(item.promptTokens)} / {formatCompactNumber(item.completionTokens)} /{" "}
                          {formatCompactNumber(item.cachedTokens)}
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
                          aria-label={t('usageLogs.colDetail')}
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
                  {totalItems > 0 ? t('usageLogs.showingRange', { start: currentStart, end: currentEnd, total: totalItems }) : t('usageLogs.noRecords')}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(activePage - 1)}
                    disabled={!logsQuery.data?.hasPrevPage || logsQuery.isFetching}
                  >
                    {t('common.previousPage')}
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
                    {t('common.nextPage')}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-14 text-center">
              <p className="text-sm font-medium">{t('usageLogs.noMatchingLogs')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('usageLogs.noMatchingLogsHint')}</p>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t('usageLogs.detailTitle')}</DialogTitle>
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
                        {selectedItem.result === "success" ? t('usageLogs.success') : t('usageLogs.failure')}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-white/10 backdrop-blur-xl bg-white/10 px-3 py-1 text-xs text-slate-100"
                      >
                        {selectedItem.streamMode === "stream" ? t('usageLogs.stream') : t('usageLogs.nonStream')}
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
                          {t('usageLogs.detailToken')}
                          <br />
                          <span className="text-slate-100">{formatDetailValue(selectedItem.tokenName)}</span>
                        </div>
                        <div className="border-r border-slate-50/10 pr-4">
                          {t('usageLogs.detailEndpoint')}
                          <br />
                          <span className="text-slate-100">{formatDetailValue(selectedItem.providerType)}</span>
                        </div>
                        <div>
                          {t('usageLogs.detailChannel')}
                          <br />
                          <span className="text-slate-100">{formatDetailValue(selectedItem.channelKey)}</span>
                        </div>
                      </div>
                      <div className="flex-1"></div>
                    </div>
                  </div>

                  <div className="min-w-0 rounded-lg bg-white/[0.04] px-4 py-2 xl:w-[340px] backdrop-blur-xl">
                    <DetailMetric label={t('usageLogs.labelTotalCost')} value={formatCurrency(selectedItem.totalCost, displayDecimals)} />
                    <DetailMetric label={t('usageLogs.labelLatency')} value={formatDuration(selectedItem.latencyMs)} />
                    <DetailMetric label={t('usageLogs.labelTotalTokens')} value={formatCompactNumber(selectedItem.totalTokens)} />
                    <DetailMetric label={t('usageLogs.labelTime')} value={formatDateTime(selectedItem.timestamp)} />
                  </div>
                </div>
              </section>

              <DetailSection title={t('usageLogs.sectionOverview')}>
                <div className="grid gap-x-8 border-t border-border/60 pt-2 md:grid-cols-2">
                  <div className="divide-y divide-border/60">
                    <DetailRow label={t('usageLogs.labelRequestModel')} value={selectedItem.requestedModel} />
                    <DetailRow label={t('usageLogs.labelUpstreamModel')} value={selectedItem.upstreamModel} />
                    <DetailRow label={t('usageLogs.labelTokenName')} value={selectedItem.tokenName} />
                    <DetailRow label={t('usageLogs.labelChannelKey')} value={selectedItem.channelKey} />
                    <DetailRow label={t('usageLogs.labelProvider')} value={selectedItem.providerType} />
                  </div>
                  <div className="divide-y divide-border/60">
                    <DetailRow label={t('usageLogs.labelRouteId')} value={selectedItem.routeId} />
                    <DetailRow
                      label={t('usageLogs.labelHttpStatus')}
                      value={selectedItem.upstreamStatus}
                      tone={selectedItem.result === "success" ? "success" : "danger"}
                    />
                    <DetailRow label={t('usageLogs.labelStreamMode')} value={selectedItem.streamMode === "stream" ? t('usageLogs.stream') : t('usageLogs.nonStream')} />
                    <DetailRow label={t('usageLogs.labelRetryCount')} value={selectedItem.retryCount} />
                    <DetailRow label={t('usageLogs.labelStatusFamily')} value={selectedItem.statusFamily} tone="subtle" />
                  </div>
                </div>
              </DetailSection>

              <DetailSection title={t('usageLogs.sectionBilling')}>
                <div className="grid gap-x-8 border-t border-border/60 pt-2 md:grid-cols-2">
                  <div className="divide-y divide-border/60">
                    <DetailRow label={t('usageLogs.labelTotalCost')} value={formatCurrency(selectedItem.totalCost, displayDecimals)} />
                    <DetailRow label={t('usageLogs.labelCacheCost')} value={formatCurrency(selectedItem.cacheCost, displayDecimals)} />
                    <DetailRow label={t('usageLogs.labelLatency')} value={formatDuration(selectedItem.latencyMs)} />
                    <DetailRow label={t('usageLogs.labelTotalTokens')} value={formatCompactNumber(selectedItem.totalTokens)} />
                  </div>
                  <div className="divide-y divide-border/60">
                    <DetailRow label={t('usageLogs.labelInputTokens')} value={formatCompactNumber(selectedItem.promptTokens)} />
                    <DetailRow label={t('usageLogs.labelOutputTokens')} value={formatCompactNumber(selectedItem.completionTokens)} />
                    <DetailRow label={t('usageLogs.labelCachedTokens')} value={formatCompactNumber(selectedItem.cachedTokens)} />
                  </div>
                </div>
              </DetailSection>

              <DetailSection title={t('usageLogs.sectionDiagnostics')}>
                <div className="grid gap-x-8 border-t border-border/60 pt-2 md:grid-cols-2">
                  <div className="divide-y divide-border/60">
                    <DetailRow label={t('usageLogs.labelRequestId')} value={selectedItem.requestId} />
                    <DetailRow label={t('usageLogs.labelTraceId')} value={selectedItem.traceId} />
                  </div>
                  <div className="divide-y divide-border/60">
                    <DetailRow label={t('usageLogs.labelTime')} value={formatDateTime(selectedItem.timestamp)} />
                    <DetailRow
                      label={t('usageLogs.labelErrorCode')}
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

              <DetailSection title={t('usageLogs.sectionClient')}>
                <div className="grid gap-x-8 border-t border-border/60 pt-2 md:grid-cols-2">
                  <div className="divide-y divide-border/60">
                    <DetailRow label={t('usageLogs.labelClientIp')} value={selectedItem.clientIp} />
                    <DetailRow
                      label={t('usageLogs.labelGeoLocation')}
                      value={[selectedItem.country, selectedItem.region, selectedItem.city].filter(Boolean).join(" / ")}
                    />
                  </div>
                  <div className="divide-y divide-border/60">
                    <DetailRow
                      label={t('usageLogs.labelEdgeTimezone')}
                      value={[selectedItem.colo, selectedItem.timezone].filter(Boolean).join(" · ")}
                    />
                    <DetailRow label={t('usageLogs.labelUserAgent')} value={selectedItem.userAgent} />
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
