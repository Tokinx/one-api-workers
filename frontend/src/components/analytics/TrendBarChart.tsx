import { AnalyticsRange, AnalyticsTrendPoint } from "@/types";
import { formatCurrency, parseUtcTimestamp } from "@/lib/utils";
import { Card } from "../ui/card";

const formatAxisLabel = (value: string, range: AnalyticsRange): string => {
  const date = parseUtcTimestamp(value);
  if (!date) {
    return value;
  }

  if (range === "24h") {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
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
      <Card className="overflow-x-auto border-0 p-8 pb-6">
        <div className="w-full" style={{ minWidth: `${chartMinWidth}px` }}>
          <div className="relative">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-56">
              {yTicks.map((tick) => (
                <div
                  key={`${tick.value}-${tick.top}`}
                  className="absolute inset-x-0 flex items-center"
                  style={{ top: tick.top }}
                >
                  <span className="w-10 -translate-y-1/2 pr-1 text-right text-[11px] text-muted-foreground">
                    {formatCompactNumber(Math.round(tick.value))}
                  </span>
                  {/* <div className="h-px flex-1 bg-border/20" /> */}
                </div>
              ))}
            </div>

            <div
              className="ml-10 grid gap-1"
              style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
            >
              {points.map((point) => {
                const label = formatAxisLabel(point.timestamp, range);
                const barHeight = Math.max((point.requests / peakRequests) * 100, point.requests > 0 ? 6 : 0);

                return (
                  <div key={`${point.timestamp}-${point.requests}`} className="min-w-0">
                    <div
                      className="group relative flex h-56 items-end bg-muted/50 outline-none hover:bg-muted"
                      tabIndex={0}
                      aria-label={`${label}，请求数 ${formatCompactNumber(point.requests)}，花费 ${formatCurrency(point.totalCost)}`}
                    >
                      <div className="pointer-events-none absolute top-3 left-[-100%] right-[-100%] mx-auto z-20 w-24 rounded-md border border-border/50 bg-card px-3 py-2 text-left opacity-0 shadow-lg transition-all duration-200 translate-y-2 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                        <div className="text-[10px] text-muted-foreground">Requests</div>
                        <div className="text-xs font-semibold text-foreground">
                          {formatCompactNumber(point.requests)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Total Cost</div>
                        <div className="text-xs font-semibold text-foreground">{formatCurrency(point.totalCost)}</div>
                      </div>
                      <div className="absolute inset-0 ring-1 ring-sky-400/0 transition-all duration-300 group-focus-visible:ring-sky-400/30" />
                      <div
                        className="relative z-10 w-full bg-gradient-to-t from-sky-500 to-cyan-400 transition-all duration-300 group-hover:from-sky-400 group-hover:to-cyan-300 group-focus-visible:from-sky-400 group-focus-visible:to-cyan-300"
                        style={{ height: `${barHeight}%` }}
                      />
                    </div>
                    <div className="mt-1 text-center text-[11px] text-muted-foreground">{label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
