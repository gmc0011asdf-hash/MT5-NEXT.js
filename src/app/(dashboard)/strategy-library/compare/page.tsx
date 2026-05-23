"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { ArrowRight, BarChart2 } from "lucide-react";

// ─── ثوابت ────────────────────────────────────────────────────────────────────

const STATUS_AR: Record<string, string> = {
  DRAFT:                  "مسودة",
  DOCUMENTED:             "موثقة",
  BACKTESTING:            "اختبار",
  SHADOW_MODE:            "مراقبة",
  CONTROLLED_EXPERIMENT:  "تجربة",
  CONDITIONALLY_APPROVED: "مشروط",
  APPROVED:               "معتمدة",
  PAUSED:                 "موقوف",
  REJECTED:               "مرفوض",
};

const STATUS_DOT: Record<string, string> = {
  DRAFT:                  "bg-zinc-400",
  DOCUMENTED:             "bg-blue-400",
  BACKTESTING:            "bg-yellow-400",
  SHADOW_MODE:            "bg-purple-400",
  CONTROLLED_EXPERIMENT:  "bg-orange-400",
  CONDITIONALLY_APPROVED: "bg-teal-400",
  APPROVED:               "bg-emerald-400",
  PAUSED:                 "bg-zinc-500",
  REJECTED:               "bg-rose-400",
};

const ALL_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

// ─── تقييم المقاييس ───────────────────────────────────────────────────────────

type MetricRating = "good" | "ok" | "poor" | "none";

function rateWinRate(v: number): MetricRating {
  if (v >= 60) return "good";
  if (v >= 50) return "ok";
  return "poor";
}
function ratePF(v: number): MetricRating {
  if (v >= 2)   return "good";
  if (v >= 1.3) return "ok";
  return "poor";
}
function rateDD(v: number): MetricRating {
  if (v <= 10)  return "good";
  if (v <= 20)  return "ok";
  return "poor";
}
function rateRR(v: number): MetricRating {
  if (v >= 2)   return "good";
  if (v >= 1.5) return "ok";
  return "poor";
}
function rateEV(v: number): MetricRating {
  if (v >= 0.5) return "good";
  if (v > 0)    return "ok";
  return "poor";
}
function computeEV(winRate: number, avgRR: number): number {
  const w = winRate / 100;
  return Math.round((w * avgRR - (1 - w) * 1) * 100) / 100;
}

const RATING_CLS: Record<MetricRating, string> = {
  good: "text-emerald-400 font-semibold",
  ok:   "text-amber-300",
  poor: "text-rose-400",
  none: "text-muted-foreground/50",
};

function MetricCell({
  value,
  rate,
  suffix = "",
  decimals = 1,
}: {
  value: number | null;
  rate: (v: number) => MetricRating;
  suffix?: string;
  decimals?: number;
}) {
  if (value === null) {
    return <span className={RATING_CLS.none}>—</span>;
  }
  const cls = RATING_CLS[rate(value)];
  return (
    <span className={`tabular-nums ${cls}`}>
      {value.toFixed(decimals)}{suffix}
    </span>
  );
}

// ─── نوع البيانات ─────────────────────────────────────────────────────────────

type Backtest = {
  _id: string;
  timeframe: string;
  totalTrades: number;
  winRate: number;
  netProfit: number;
  maxDrawdown: number;
  profitFactor: number;
  avgRR: number;
  selectedPlan?: string;
};

type StrategyWithBacktests = {
  _id: string;
  name: string;
  status: string;
  allowedTimeframes: string[];
  backtests: Backtest[];
};

// ─── صف الاستراتيجية ─────────────────────────────────────────────────────────

function bestBacktest(
  backtests: Backtest[],
  timeframe: string,
  plan: string,
): Backtest | null {
  const matches = backtests.filter(
    (b) => b.timeframe === timeframe && (!plan || b.selectedPlan === plan || !b.selectedPlan),
  );
  if (matches.length === 0) return null;
  // Return the one with most trades (most complete test)
  return matches.reduce((best, cur) => (cur.totalTrades > best.totalTrades ? cur : best));
}

function StrategyRow({
  strategy,
  timeframe,
  plan,
}: {
  strategy: StrategyWithBacktests;
  timeframe: string;
  plan: string;
}) {
  const bt = bestBacktest(strategy.backtests, timeframe, plan);
  const dotCls = STATUS_DOT[strategy.status] ?? "bg-zinc-400";
  const statusLabel = STATUS_AR[strategy.status] ?? strategy.status;

  return (
    <tr className="border-b border-border/30 hover:bg-muted/10 transition-colors">
      <td className="py-2.5 pe-3 min-w-[160px]">
        <Link
          href={`/strategy-library/${strategy._id}`}
          className="group flex items-center gap-2"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls}`} />
          <span className="text-foreground text-sm font-medium group-hover:text-amber-300 transition-colors truncate max-w-[160px]">
            {strategy.name}
          </span>
        </Link>
        <p className="ms-4 text-[11px] text-muted-foreground/60">{statusLabel}</p>
      </td>

      {bt ? (
        <>
          <td className="py-2.5 px-2 text-center text-xs">
            <span className="tabular-nums text-muted-foreground">{bt.totalTrades}</span>
          </td>
          <td className="py-2.5 px-2 text-center text-xs">
            <MetricCell value={bt.winRate}    rate={rateWinRate} suffix="%" />
          </td>
          <td className="py-2.5 px-2 text-center text-xs">
            <MetricCell value={bt.profitFactor} rate={ratePF} decimals={2} />
          </td>
          <td className="py-2.5 px-2 text-center text-xs">
            <MetricCell value={bt.avgRR}      rate={rateRR} decimals={2} />
          </td>
          <td className="py-2.5 px-2 text-center text-xs">
            <MetricCell value={bt.maxDrawdown} rate={rateDD} suffix="%" />
          </td>
          <td className="py-2.5 px-2 text-center text-xs">
            <span className="tabular-nums text-foreground">
              {bt.netProfit >= 0
                ? <span className="text-emerald-400">+{bt.netProfit.toFixed(0)}</span>
                : <span className="text-rose-400">{bt.netProfit.toFixed(0)}</span>
              }
            </span>
          </td>
          <td className="py-2.5 px-2 text-center text-xs">
            <MetricCell value={computeEV(bt.winRate, bt.avgRR)} rate={rateEV} decimals={2} />
          </td>
          <td className="py-2.5 px-2 text-center text-[11px] text-muted-foreground/70">
            {bt.selectedPlan ?? "—"}
          </td>
        </>
      ) : (
        <td colSpan={8} className="py-2.5 px-2 text-center text-xs text-muted-foreground/40">
          لا توجد نتائج للفريم {timeframe}
        </td>
      )}
    </tr>
  );
}

// ─── لوحة الترتيب ─────────────────────────────────────────────────────────────

type SortKey = "winRate" | "profitFactor" | "avgRR" | "maxDrawdown" | "netProfit" | "totalTrades";

function sortStrategies(
  strategies: StrategyWithBacktests[],
  timeframe: string,
  plan: string,
  sortKey: SortKey,
  sortAsc: boolean,
): StrategyWithBacktests[] {
  return [...strategies].sort((a, b) => {
    const btA = bestBacktest(a.backtests, timeframe, plan);
    const btB = bestBacktest(b.backtests, timeframe, plan);
    if (!btA && !btB) return 0;
    if (!btA) return 1;
    if (!btB) return -1;
    const valA = btA[sortKey] ?? 0;
    const valB = btB[sortKey] ?? 0;
    // For drawdown, lower is better → invert natural sort
    const factor = sortKey === "maxDrawdown" ? -1 : 1;
    return sortAsc ? (valA - valB) * factor : (valB - valA) * factor;
  });
}

// ─── الصفحة ───────────────────────────────────────────────────────────────────

export default function StrategyComparePage() {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !authLoading && isAuthenticated;

  const data = useQuery(
    api.strategies.listStrategiesWithBacktests,
    canUseConvex ? {} : "skip",
  );

  const [timeframe, setTimeframe] = useState("H1");
  const [plan, setPlan]           = useState("");
  const [sortKey, setSortKey]     = useState<SortKey>("winRate");
  const [sortAsc, setSortAsc]     = useState(false);

  // Derive available timeframes from loaded backtests
  const availableTimeframes = data
    ? Array.from(new Set(data.flatMap((s) => s.backtests.map((b) => b.timeframe))))
        .filter((tf) => ALL_TIMEFRAMES.includes(tf))
        .sort((a, b) => ALL_TIMEFRAMES.indexOf(a) - ALL_TIMEFRAMES.indexOf(b))
    : [];

  const sorted =
    data ? sortStrategies(data as StrategyWithBacktests[], timeframe, plan, sortKey, sortAsc) : [];

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortTh({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        className={`pb-2 px-2 text-center font-medium cursor-pointer select-none hover:text-amber-300 transition-colors text-xs ${
          active ? "text-amber-300" : "text-muted-foreground"
        }`}
        onClick={() => toggleSort(k)}
      >
        {label}
        {active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  return (
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* ─── header ─── */}
      <div>
        <Link
          href="/strategy-library"
          className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-amber-300 transition-colors mb-3"
        >
          <ArrowRight className="h-4 w-4" />
          مكتبة الاستراتيجيات
        </Link>
        <h2 className="page-title flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-amber-400" />
          مقارنة الاستراتيجيات
        </h2>
        <p className="label-secondary mt-1">
          قارن نتائج الاختبار التاريخي لجميع استراتيجياتك على نفس الفريم.
        </p>
      </div>

      {/* ─── filters ─── */}
      <Card className={institutionalCardClass("p-4")}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">الفريم:</span>
            <div className="flex flex-wrap gap-1.5">
              {(availableTimeframes.length > 0 ? availableTimeframes : ALL_TIMEFRAMES.slice(2, 7)).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    timeframe === tf
                      ? "bg-amber-500/30 text-amber-200 border border-amber-500/40"
                      : "bg-muted/20 text-muted-foreground border border-border/30 hover:bg-muted/30"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">الخطة:</span>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="rounded-md border border-amber-500/20 bg-muted/20 px-2 py-1 text-foreground text-xs"
            >
              <option value="">أي خطة</option>
              <option value="Conservative">Conservative</option>
              <option value="Balanced">Balanced</option>
              <option value="Aggressive">Aggressive</option>
            </select>
          </div>
        </div>
      </Card>

      {/* ─── legend ─── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted-foreground/70">
        <span className={RATING_CLS.good}>● ممتاز</span>
        <span className={RATING_CLS.ok}>● مقبول</span>
        <span className={RATING_CLS.poor}>● ضعيف</span>
        <span className="ms-3">Win% ≥ 60% = ممتاز · PF ≥ 2 = ممتاز · DD ≤ 10% = ممتاز · RR ≥ 2 = ممتاز</span>
      </div>

      {/* ─── table ─── */}
      {authLoading ? (
        <p className="text-muted-foreground text-sm animate-pulse">جاري التحقق...</p>
      ) : !isAuthenticated ? (
        <p className="text-muted-foreground text-sm">يجب تسجيل الدخول.</p>
      ) : data === undefined ? (
        <p className="text-muted-foreground text-sm animate-pulse">جاري تحميل البيانات...</p>
      ) : data.length === 0 ? (
        <Card className={institutionalCardClass("p-6")}>
          <p className="text-center text-muted-foreground text-sm">
            لا توجد استراتيجيات بعد —{" "}
            <Link href="/strategy-library" className="text-amber-400 hover:underline">
              أنشئ استراتيجيتك الأولى
            </Link>
          </p>
        </Card>
      ) : (
        <Card className={institutionalCardClass("p-0")}>
          <CardHeader className="border-b border-amber-500/10 px-5 py-4">
            <CardTitle className="card-title-inst">
              {sorted.length} استراتيجية — فريم {timeframe}
              {plan ? ` · خطة ${plan}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-500/10">
                  <th className="pb-2 px-5 text-start text-xs font-medium text-muted-foreground">
                    الاستراتيجية
                  </th>
                  <SortTh label="صفقات"   k="totalTrades" />
                  <SortTh label="Win %"   k="winRate" />
                  <SortTh label="PF"      k="profitFactor" />
                  <SortTh label="Avg RR"  k="avgRR" />
                  <SortTh label="DD %"    k="maxDrawdown" />
                  <SortTh label="ربح $"   k="netProfit" />
                  <th className="pb-2 px-2 text-center text-xs font-medium text-muted-foreground">EV</th>
                  <th className="pb-2 px-2 text-center text-xs font-medium text-muted-foreground">الخطة</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <StrategyRow
                    key={s._id}
                    strategy={s as StrategyWithBacktests}
                    timeframe={timeframe}
                    plan={plan}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* ─── multi-timeframe view ─── */}
      {data && data.length > 0 ? (
        <Card className={institutionalCardClass("p-0")}>
          <CardHeader className="border-b border-amber-500/10 px-5 py-4">
            <CardTitle className="card-title-inst">
              نفس الاستراتيجية — عبر الفريمات
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-500/10 text-muted-foreground text-xs">
                  <th className="pb-2 px-5 text-start font-medium">الاستراتيجية / الفريم</th>
                  {ALL_TIMEFRAMES.filter((tf) =>
                    (data as StrategyWithBacktests[]).some((s) =>
                      s.backtests.some((b) => b.timeframe === tf),
                    ),
                  ).map((tf) => (
                    <th key={tf} className="pb-2 px-3 text-center font-medium">{tf}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data as StrategyWithBacktests[])
                  .filter((s) => s.backtests.length > 0)
                  .map((s) => {
                    const tfs = ALL_TIMEFRAMES.filter((tf) =>
                      (data as StrategyWithBacktests[]).some((st) =>
                        st.backtests.some((b) => b.timeframe === tf),
                      ),
                    );
                    return (
                      <tr key={s._id} className="border-b border-border/30">
                        <td className="py-2.5 px-5 text-sm">
                          <Link
                            href={`/strategy-library/${s._id}`}
                            className="text-foreground hover:text-amber-300 transition-colors"
                          >
                            {s.name}
                          </Link>
                        </td>
                        {tfs.map((tf) => {
                          const bt = bestBacktest(s.backtests, tf, "");
                          return (
                            <td key={tf} className="py-2.5 px-3 text-center text-xs">
                              {bt ? (
                                <div className="space-y-0.5">
                                  <div>
                                    <MetricCell value={bt.winRate} rate={rateWinRate} suffix="%" decimals={0} />
                                  </div>
                                  <div className="text-[10px] text-muted-foreground/60">
                                    PF {bt.profitFactor.toFixed(1)}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/30 text-[11px]">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {/* ─── level 2: plan comparison per strategy ─── */}
      {data && (data as StrategyWithBacktests[]).some((s) =>
        new Set(s.backtests.filter((b) => b.timeframe === timeframe && b.selectedPlan).map((b) => b.selectedPlan)).size > 1,
      ) ? (
        <Card className={institutionalCardClass("p-0")}>
          <CardHeader className="border-b border-amber-500/10 px-5 py-4">
            <CardTitle className="card-title-inst">
              مقارنة الخطط — Conservative / Balanced / Aggressive — فريم {timeframe}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-500/10 text-muted-foreground text-xs">
                  <th className="pb-2 px-5 text-start font-medium">الاستراتيجية</th>
                  {(["Conservative", "Balanced", "Aggressive"] as const).map((p) => (
                    <th key={p} className="pb-2 px-3 text-center font-medium" colSpan={3}>
                      {p}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-border/20 text-muted-foreground/60 text-[11px]">
                  <th className="pb-1.5 px-5" />
                  {(["Conservative", "Balanced", "Aggressive"] as const).flatMap((p) =>
                    ["Win%", "PF", "EV"].map((m) => (
                      <th key={`${p}-${m}`} className="pb-1.5 px-2 text-center font-normal">{m}</th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {(data as StrategyWithBacktests[])
                  .filter((s) =>
                    new Set(
                      s.backtests.filter((b) => b.timeframe === timeframe && b.selectedPlan).map((b) => b.selectedPlan),
                    ).size > 1,
                  )
                  .map((s) => (
                    <tr key={s._id} className="border-b border-border/30 hover:bg-muted/10 transition-colors">
                      <td className="py-2.5 px-5 text-sm">
                        <Link href={`/strategy-library/${s._id}`} className="hover:text-amber-300 transition-colors">
                          {s.name}
                        </Link>
                      </td>
                      {(["Conservative", "Balanced", "Aggressive"] as const).flatMap((planType) => {
                        const bt = s.backtests
                          .filter((b) => b.timeframe === timeframe && b.selectedPlan === planType)
                          .reduce<Backtest | null>((best, cur) =>
                            !best || cur.totalTrades > best.totalTrades ? cur : best, null);
                        if (!bt) {
                          return [
                            <td key={`${planType}-wr`} className="py-2.5 px-2 text-center text-[11px] text-muted-foreground/30">—</td>,
                            <td key={`${planType}-pf`} className="py-2.5 px-2 text-center text-[11px] text-muted-foreground/30">—</td>,
                            <td key={`${planType}-ev`} className="py-2.5 px-2 text-center text-[11px] text-muted-foreground/30">—</td>,
                          ];
                        }
                        return [
                          <td key={`${planType}-wr`} className="py-2.5 px-2 text-center text-xs">
                            <MetricCell value={bt.winRate} rate={rateWinRate} suffix="%" decimals={0} />
                          </td>,
                          <td key={`${planType}-pf`} className="py-2.5 px-2 text-center text-xs">
                            <MetricCell value={bt.profitFactor} rate={ratePF} decimals={2} />
                          </td>,
                          <td key={`${planType}-ev`} className="py-2.5 px-2 text-center text-xs">
                            <MetricCell value={computeEV(bt.winRate, bt.avgRR)} rate={rateEV} decimals={2} />
                          </td>,
                        ];
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <p className="rounded-xl border border-amber-500/10 bg-amber-500/5 px-4 py-2.5 text-amber-100/60 text-xs">
        البيانات المعروضة من نتائج الاختبار التاريخي فقط — ليست ضماناً للأداء المستقبلي.
      </p>
    </div>
  );
}
