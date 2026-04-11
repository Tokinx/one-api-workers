import { AnalyticsRange, AnalyticsTrendPoint } from "@/types";
import { formatCurrency } from "@/lib/utils";

const formatAxisLabel = (value: string, range: AnalyticsRange): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (range === "24h") {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
};

const formatCompactNumber = (value: number): string => {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
};

export function TrendBarChart({ points, range }: { points: AnalyticsTrendPoint[]; range: AnalyticsRange }) {
  const totalRequests = points.reduce((sum, point) => sum + point.requests, 0);
  const totalFailures = points.reduce((sum, point) => sum + point.failures, 0);
  const totalCost = points.reduce((sum, point) => sum + point.totalCost, 0);
  const peakRequests = Math.max(...points.map((point) => point.requests), 1);
  const minColumnWidth = range === "90d" ? 28 : range === "30d" ? 34 : range === "24h" ? 42 : 56;
  const chartMinWidth = Math.max(points.length * minColumnWidth, 720);
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = (peakRequests / 4) * (4 - index);

    return {
      value,
      top: `${index * 25}%`,
    };
  });

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-2xl bg-card p-8 pb-6">
        <div className="w-full" style={{ minWidth: `${chartMinWidth}px` }}>
          <div className="relative">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-56">
              {yTicks.map((tick) => (
                <div
                  key={`${tick.value}-${tick.top}`}
                  className="absolute inset-x-0 flex items-center"
                  style={{ top: tick.top }}
                >
                  <span className="w-10 -translate-y-1/2 pr-3 text-right text-[11px] text-muted-foreground">
                    {formatCompactNumber(Math.round(tick.value))}
                  </span>
                  {/* <div className="h-px flex-1 bg-border/20" /> */}
                </div>
              ))}
            </div>

            <div
              className="ml-12 grid gap-1"
              style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
            >
              {points.map((point) => {
                const label = formatAxisLabel(point.timestamp, range);
                const barHeight = Math.max((point.requests / peakRequests) * 100, point.requests > 0 ? 6 : 0);

                return (
                  <div key={`${point.timestamp}-${point.requests}`} className="min-w-0">
                    <div className="flex h-56 items-end bg-muted/50">
                      <div
                        className="w-full bg-gradient-to-t from-sky-500 to-cyan-400 transition-all duration-300"
                        style={{ height: `${barHeight}%` }}
                      />
                    </div>
                    <div className="mt-4 text-center text-[11px] text-muted-foreground">{label}</div>
                    <div className="text-center text-sm font-medium">{formatCompactNumber(point.requests)}</div>
                    <div className="text-center text-[11px] text-muted-foreground">
                      {formatCurrency(point.totalCost)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
