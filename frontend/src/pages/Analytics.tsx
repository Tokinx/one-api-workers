import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import {
  AnalyticsOverviewData,
  AnalyticsTrendData,
  AnalyticsBreakdownData,
  AnalyticsRange,
  AnalyticsBreakdownDimension,
} from "@/types";
import { BreakdownChartCard } from "@/components/analytics/BreakdownChartCard";
import { TrendBarChart } from "@/components/analytics/TrendBarChart";
import { PageContainer } from "@/components/ui/page-container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useBillingConfig } from "@/hooks/use-billing-config";
import { readScopedCache, writeScopedCache } from "@/lib/local-cache";
import { cn, formatCurrency } from "@/lib/utils";
import { Activity, CircleDollarSign, Clock3, DatabaseZap, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" },
];

const BREAKDOWN_CHARTS: Array<{
  dimension: AnalyticsBreakdownDimension;
  title: string;
  description: string;
  barClassName: string;
  badgeClassName: string;
}> = [
  {
    dimension: "model",
    title: "模型排行",
    description: "看清哪些模型是主要成本与流量入口。",
    barClassName: "from-amber-500 to-orange-400",
    badgeClassName: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  },
  {
    dimension: "channel",
    title: "渠道排行",
    description: "对比不同渠道承载的请求与成本消耗。",
    barClassName: "from-emerald-500 to-teal-400",
    badgeClassName: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  },
  {
    dimension: "token",
    title: "令牌排行",
    description: "按成本优先排序，识别最活跃的访问凭证。",
    barClassName: "from-sky-500 to-cyan-400",
    badgeClassName: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  },
  {
    dimension: "provider",
    title: "服务商排行",
    description: "衡量各上游服务商的占比与稳定性表现。",
    barClassName: "from-rose-500 to-pink-400",
    badgeClassName: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
  },
];

const formatCompactNumber = (value: number): string => {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const formatDuration = (value: number): string => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${Math.round(value)} ms`;
};

const ANALYTICS_RANGE_CACHE_KEY = "analytics:selected-range";

const getAnalyticsOverviewCacheKey = (range: AnalyticsRange): string => `analytics:overview:${range}`;

const getAnalyticsTrendCacheKey = (range: AnalyticsRange): string => `analytics:trend:${range}`;

const getAnalyticsBreakdownCacheKey = (range: AnalyticsRange, dimension: AnalyticsBreakdownDimension): string =>
  `analytics:breakdown:${range}:${dimension}`;

const getInitialAnalyticsRange = (): AnalyticsRange => {
  const cachedRange = readScopedCache<AnalyticsRange>(ANALYTICS_RANGE_CACHE_KEY)?.data;

  return RANGE_OPTIONS.some((option) => option.value === cachedRange) ? cachedRange : "7d";
};

export function Analytics() {
  const [range, setRange] = useState<AnalyticsRange>(getInitialAnalyticsRange);
  const { data: billingConfig } = useBillingConfig();
  const displayDecimals = billingConfig?.displayDecimals ?? 6;

  const overviewCacheEntry = useMemo(
    () => readScopedCache<AnalyticsOverviewData>(getAnalyticsOverviewCacheKey(range)),
    [range],
  );
  const trendCacheEntry = useMemo(() => readScopedCache<AnalyticsTrendData>(getAnalyticsTrendCacheKey(range)), [range]);
  const tokenBreakdownCacheEntry = useMemo(
    () => readScopedCache<AnalyticsBreakdownData>(getAnalyticsBreakdownCacheKey(range, "token")),
    [range],
  );
  const channelBreakdownCacheEntry = useMemo(
    () => readScopedCache<AnalyticsBreakdownData>(getAnalyticsBreakdownCacheKey(range, "channel")),
    [range],
  );
  const modelBreakdownCacheEntry = useMemo(
    () => readScopedCache<AnalyticsBreakdownData>(getAnalyticsBreakdownCacheKey(range, "model")),
    [range],
  );
  const providerBreakdownCacheEntry = useMemo(
    () => readScopedCache<AnalyticsBreakdownData>(getAnalyticsBreakdownCacheKey(range, "provider")),
    [range],
  );

  useEffect(() => {
    writeScopedCache(ANALYTICS_RANGE_CACHE_KEY, range);
  }, [range]);

  const overviewQuery = useQuery({
    queryKey: ["analytics", "overview", range],
    queryFn: async () => {
      const response = await apiClient.getAnalyticsOverview(range);
      const data = response.data as AnalyticsOverviewData;
      writeScopedCache(getAnalyticsOverviewCacheKey(range), data);
      return data;
    },
    initialData: overviewCacheEntry?.data,
    initialDataUpdatedAt: overviewCacheEntry?.updatedAt,
  });

  const trendQuery = useQuery({
    queryKey: ["analytics", "trend", range],
    queryFn: async () => {
      const response = await apiClient.getAnalyticsTrend(range);
      const data = response.data as AnalyticsTrendData;
      writeScopedCache(getAnalyticsTrendCacheKey(range), data);
      return data;
    },
    initialData: trendCacheEntry?.data,
    initialDataUpdatedAt: trendCacheEntry?.updatedAt,
  });

  const tokenBreakdownQuery = useQuery({
    queryKey: ["analytics", "breakdown", range, "token"],
    queryFn: async () => {
      const response = await apiClient.getAnalyticsBreakdown(range, "token");
      const data = response.data as AnalyticsBreakdownData;
      writeScopedCache(getAnalyticsBreakdownCacheKey(range, "token"), data);
      return data;
    },
    initialData: tokenBreakdownCacheEntry?.data,
    initialDataUpdatedAt: tokenBreakdownCacheEntry?.updatedAt,
  });

  const channelBreakdownQuery = useQuery({
    queryKey: ["analytics", "breakdown", range, "channel"],
    queryFn: async () => {
      const response = await apiClient.getAnalyticsBreakdown(range, "channel");
      const data = response.data as AnalyticsBreakdownData;
      writeScopedCache(getAnalyticsBreakdownCacheKey(range, "channel"), data);
      return data;
    },
    initialData: channelBreakdownCacheEntry?.data,
    initialDataUpdatedAt: channelBreakdownCacheEntry?.updatedAt,
  });

  const modelBreakdownQuery = useQuery({
    queryKey: ["analytics", "breakdown", range, "model"],
    queryFn: async () => {
      const response = await apiClient.getAnalyticsBreakdown(range, "model");
      const data = response.data as AnalyticsBreakdownData;
      writeScopedCache(getAnalyticsBreakdownCacheKey(range, "model"), data);
      return data;
    },
    initialData: modelBreakdownCacheEntry?.data,
    initialDataUpdatedAt: modelBreakdownCacheEntry?.updatedAt,
  });

  const providerBreakdownQuery = useQuery({
    queryKey: ["analytics", "breakdown", range, "provider"],
    queryFn: async () => {
      const response = await apiClient.getAnalyticsBreakdown(range, "provider");
      const data = response.data as AnalyticsBreakdownData;
      writeScopedCache(getAnalyticsBreakdownCacheKey(range, "provider"), data);
      return data;
    },
    initialData: providerBreakdownCacheEntry?.data,
    initialDataUpdatedAt: providerBreakdownCacheEntry?.updatedAt,
  });

  const breakdownDataMap: Record<AnalyticsBreakdownDimension, AnalyticsBreakdownData | undefined> = {
    token: tokenBreakdownQuery.data,
    channel: channelBreakdownQuery.data,
    model: modelBreakdownQuery.data,
    provider: providerBreakdownQuery.data,
  };

  const breakdownStateMap: Record<AnalyticsBreakdownDimension, { isLoading: boolean; isError: boolean }> = {
    token: { isLoading: tokenBreakdownQuery.isLoading, isError: tokenBreakdownQuery.isError },
    channel: { isLoading: channelBreakdownQuery.isLoading, isError: channelBreakdownQuery.isError },
    model: { isLoading: modelBreakdownQuery.isLoading, isError: modelBreakdownQuery.isError },
    provider: { isLoading: providerBreakdownQuery.isLoading, isError: providerBreakdownQuery.isError },
  };

  const isFetching =
    overviewQuery.isFetching ||
    trendQuery.isFetching ||
    tokenBreakdownQuery.isFetching ||
    channelBreakdownQuery.isFetching ||
    modelBreakdownQuery.isFetching ||
    providerBreakdownQuery.isFetching;

  const overview = overviewQuery.data;
  const trend = trendQuery.data;

  const handleRefresh = async () => {
    await Promise.all([
      overviewQuery.refetch(),
      trendQuery.refetch(),
      tokenBreakdownQuery.refetch(),
      channelBreakdownQuery.refetch(),
      modelBreakdownQuery.refetch(),
      providerBreakdownQuery.refetch(),
    ]);
  };

  return (
    <PageContainer
      title="总览看板"
      description="聚合查看请求、成本、成功率与关键维度分布。详细排查请进入使用日志页面。"
      actions={
        <div className="flex items-center gap-2">
          <div className="w-28">
            <Select className="h-9" value={range} onChange={(event) => setRange(event.target.value as AnalyticsRange)}>
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card className="border-0">
            <CardHeader className="pb-3">
              <CardDescription>请求总量</CardDescription>
              <CardTitle className="text-3xl">{formatCompactNumber(overview?.totals.requests || 0)}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
              <span>成功 {formatCompactNumber(overview?.totals.successes || 0)}</span>
              <Activity className="h-4 w-4 text-sky-500" />
            </CardContent>
          </Card>

          <Card className="border-0">
            <CardHeader className="pb-3">
              <CardDescription>成功率</CardDescription>
              <CardTitle className="text-3xl">{formatPercent(overview?.totals.successRate || 0)}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
              <span>失败 {formatCompactNumber(overview?.totals.failures || 0)}</span>
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            </CardContent>
          </Card>

          <Card className="border-0">
            <CardHeader className="pb-3">
              <CardDescription>输入 Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatCompactNumber(overview?.totals.promptTokens || 0)}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
              <span>总计 {formatCompactNumber(overview?.totals.totalTokens || 0)}</span>
              <DatabaseZap className="h-4 w-4 text-violet-500" />
            </CardContent>
          </Card>

          <Card className="border-0">
            <CardHeader className="pb-3">
              <CardDescription>输出 Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatCompactNumber(overview?.totals.completionTokens || 0)}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{formatCurrency(overview?.totals.totalCost || 0, displayDecimals)}</span>
              <CircleDollarSign className="h-4 w-4 text-amber-500" />
            </CardContent>
          </Card>

          <Card className="border-0">
            <CardHeader className="pb-3">
              <CardDescription>平均延迟</CardDescription>
              <CardTitle className="text-3xl">{formatDuration(overview?.totals.avgLatencyMs || 0)}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{RANGE_OPTIONS.find((option) => option.value === range)?.label}</span>
              <Clock3 className="h-4 w-4 text-slate-500" />
            </CardContent>
          </Card>
        </div>

        {!trend || trend.points.length === 0 ? (
          <Card className="border-0 flex flex-col items-center justify-center py-16">
            <p className="text-sm font-medium">暂无趋势数据</p>
            <p className="mt-1 text-sm text-muted-foreground">写入第一批使用事件后，这里会展示完整柱状趋势。</p>
          </Card>
        ) : (
          <TrendBarChart points={trend.points} range={range} displayDecimals={displayDecimals} />
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {BREAKDOWN_CHARTS.map((chart) => (
            <BreakdownChartCard
              key={chart.dimension}
              title={chart.title}
              description={chart.description}
              items={breakdownDataMap[chart.dimension]?.items}
              isLoading={breakdownStateMap[chart.dimension].isLoading}
              isError={breakdownStateMap[chart.dimension].isError}
              barClassName={chart.barClassName}
              badgeClassName={chart.badgeClassName}
              displayDecimals={displayDecimals}
            />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
