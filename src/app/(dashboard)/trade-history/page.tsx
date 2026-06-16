"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { History, RefreshCw, TrendingUp, TrendingDown, Coins, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface MatchedSignal {
  id: number;
  confluenceLevel: string | null;
  signalStrength: number;
  sl: number | null;
  tp: number | null;
  rr: number | null;
  timestamp: string | null;
  matchedTimeDeltaSeconds: number | null;
}

interface ClosedTrade {
  id: number;
  positionId: number;
  symbol: string;
  direction: string;
  volume: number;
  openPrice: number;
  openTime: string | null;
  closePrice: number;
  closeTime: string | null;
  closeVolume: number;
  dealsCount: number;
  profit: number;
  commission: number;
  swap: number;
  matchedSignal: MatchedSignal | null;
  source?: "mt5" | "okx";
}

interface OpenPosition {
  id: number;
  ticket: number;
  symbol: string;
  direction: string;
  volume: number;
  openPrice: number;
  openTime: string | null;
  currentPrice: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  matchedSignal: MatchedSignal | null;
  source?: "mt5" | "okx";
}

interface ClosedResponse {
  ok: boolean;
  total: number;
  trades: ClosedTrade[];
  error?: string;
}

interface OpenResponse {
  ok: boolean;
  total: number;
  positions: OpenPosition[];
  error?: string;
}

interface SummaryResponse {
  ok: boolean;
  days: number;
  totalTrades: number;
  matchedTrades: number;
  unmatchedTrades: number;
  overallWinRatePct: number | null;
  matchedWinRatePct: number | null;
  unmatchedWinRatePct: number | null;
  netProfit: number;
  error?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatTimeDelta(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `قبل ${hours} ساعة و${minutes} دقيقة من فتح الصفقة`;
  return `قبل ${minutes} دقيقة من فتح الصفقة`;
}

function directionLabel(direction: string): string {
  return direction === "BUY" ? "شراء" : "بيع";
}

function profitClass(profit: number): string {
  if (profit > 0) return "text-emerald-400";
  if (profit < 0) return "text-rose-400";
  return "text-slate-400";
}

function signalBadge(signal: MatchedSignal | null) {
  if (!signal) {
    return (
      <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
        لا توجد إشارة مطابقة
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400 w-fit">
        ✅ مرتبطة بإشارة — {signal.confluenceLevel ?? "—"}
      </span>
      <span className="text-[10px] text-slate-500">{formatTimeDelta(signal.matchedTimeDeltaSeconds)}</span>
    </div>
  );
}

export default function TradeHistoryPage() {
  const [activeTab, setActiveTab] = useState<"mt5" | "okx">("mt5");
  const [closed, setClosed] = useState<ClosedResponse | null>(null);
  const [open, setOpen] = useState<OpenResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [closedRes, openRes, summaryRes] = await Promise.all([
        fetch(`/api/trade-history/closed?days=365&limit=50&offset=0&source=${activeTab}`, { cache: "no-store" }),
        fetch(`/api/trade-history/open?source=${activeTab}`, { cache: "no-store" }),
        fetch(`/api/trade-history/summary?days=365&source=${activeTab}`, { cache: "no-store" }),
      ]);
      const [closedBody, openBody, summaryBody]: [ClosedResponse, OpenResponse, SummaryResponse] =
        await Promise.all([closedRes.json(), openRes.json(), summaryRes.json()]);

      if (!closedBody.ok || !openBody.ok || !summaryBody.ok) {
        setError(closedBody.error ?? openBody.error ?? summaryBody.error ?? "تعذّر تحميل سجل الصفقات");
      }
      setClosed(closedBody);
      setOpen(openBody);
      setSummary(summaryBody);
    } catch {
      setError("تعذّر الاتصال بخدمة MT5 المحلية");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 60s for the currently open platform tab.
  useEffect(() => {
    const interval = setInterval(() => {
      loadData();
    }, 60_000);
    return () => clearInterval(interval);
  }, [loadData]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/trade-history/sync-now", { method: "POST", cache: "no-store" });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? "تعذّر تنفيذ المزامنة");
        return;
      }
      await loadData();
    } catch {
      setError("تعذّر الاتصال بخدمة MT5 المحلية");
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  const closedTrades = closed?.trades ?? [];
  const openPositions = open?.positions ?? [];

  // Calculate total closed lot size (volume)
  const totalClosedVolume = useMemo(() => {
    return closedTrades.reduce((acc, t) => acc + (t.volume || 0), 0);
  }, [closedTrades]);

  // Performance Chart Data (Cumulative Profit)
  const chartData = useMemo(() => {
    if (!closedTrades || closedTrades.length === 0) return [];
    const sorted = [...closedTrades]
      .filter((t) => t.closeTime)
      .sort((a, b) => new Date(a.closeTime!).getTime() - new Date(b.closeTime!).getTime());
    
    let cumulative = 0;
    return sorted.map((t, idx) => {
      cumulative += t.profit;
      return {
        tradeNum: idx + 1,
        symbol: t.symbol,
        pnl: t.profit,
        "الربح التراكمي": parseFloat(cumulative.toFixed(2)),
      };
    });
  }, [closedTrades]);

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl border transition-colors",
              activeTab === "mt5" ? "bg-amber-500/15 border-amber-500/25 text-amber-400" : "bg-cyan-500/15 border-cyan-500/25 text-cyan-400"
            )}>
              <History className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">سجل الصفقات المالي</h1>
              <p className="text-xs text-muted-foreground">
                كشف الأرباح واللوت والأداء التراكمي للمراكز المغلقة والمفتوحة مع عزل كامل لكل منصة
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={syncNow}
              disabled={syncing}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50",
                activeTab === "mt5"
                  ? "border-amber-500/20 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10"
                  : "border-cyan-500/20 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10"
              )}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              مزامنة MT5
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              تحديث
            </button>
          </div>
        </div>

        {/* Platform Tabs */}
        <div className="flex items-center gap-2 border-b border-border/50 pb-2">
          <button
            onClick={() => setActiveTab("mt5")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all border border-transparent",
              activeTab === "mt5"
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
            )}
          >
            <Coins className="h-4 w-4" />
            🥇 صفقات الذهب والفوركس [MT5]
          </button>
          <button
            onClick={() => setActiveTab("okx")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all border border-transparent",
              activeTab === "okx"
                ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
            )}
          >
            <Flame className="h-4 w-4" />
            🔥 صفقات العملات الرقمية [OKX]
          </button>
        </div>

        {/* Disclaimer */}
        <div className="rounded-xl border border-border bg-card/30 p-3 text-xs text-muted-foreground">
          ⚠️ هذه البيانات معروضة لأغراض الدراسة والتقييم الأكاديمي، وليست توصية مالية أو تعليمات استثمارية.
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-300">
            ⚠️ {error}
          </div>
        )}

        {/* Summary Statistics */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <div className="rounded-xl border border-border bg-card/50 px-4 py-4 text-center">
            <p className="text-2xl font-bold text-foreground">{summary?.totalTrades ?? 0}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">الصفقات المغلقة</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 px-4 py-4 text-center">
            <p className="text-2xl font-bold text-foreground">{totalClosedVolume.toFixed(2)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">حجم اللوت الإجمالي</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 px-4 py-4 text-center">
            <p className={cn("text-2xl font-bold", profitClass(summary?.netProfit ?? 0))}>
              {summary?.netProfit ?? 0} USD
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">صافي الأرباح</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{summary?.matchedWinRatePct ?? "—"}%</p>
            <p className="mt-1 text-[11px] text-muted-foreground">نسبة نجاح الإشارات</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 px-4 py-4 text-center">
            <p className="text-2xl font-bold text-foreground">{summary?.unmatchedWinRatePct ?? "—"}%</p>
            <p className="mt-1 text-[11px] text-muted-foreground">نسبة نجاح اليدوي</p>
          </div>
        </div>

        {/* Performance Chart */}
        {chartData.length >= 2 && (
          <div className="rounded-xl border border-border bg-card/30 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">الرسم البياني للأداء المالي التراكمي</h2>
              <p className="text-xs text-muted-foreground">تطور صافي الأرباح والخسائر التراكمية للصفقات المغلقة</p>
            </div>
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={activeTab === "mt5" ? "#f59e0b" : "#06b6d4"} stopOpacity={0.2}/>
                      <stop offset="95%" stopColor={activeTab === "mt5" ? "#f59e0b" : "#06b6d4"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="tradeNum" stroke="#9ca3af" fontSize={11} tickLine={false} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '0.75rem', direction: 'rtl' }}
                    labelFormatter={(label) => `الصفقة رقم ${label}`}
                    formatter={(value: any, name: any, props: any) => {
                      const p = props.payload;
                      return [
                        <span key="val" className="font-bold text-foreground">
                          {value} USD ({p.symbol} {p.pnl >= 0 ? `+${p.pnl}` : p.pnl})
                        </span>,
                        "صافي الربح"
                      ];
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="الربح التراكمي" 
                    stroke={activeTab === "mt5" ? "#f59e0b" : "#06b6d4"} 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorProfit)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Open positions */}
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-border/40 pb-2">
            <h2 className="text-xs uppercase font-bold tracking-wider text-muted-foreground">المراكز المفتوحة حالياً</h2>
          </div>

          {openPositions.length === 0 && !loading && (
            <p className="text-center text-sm text-muted-foreground py-8">لا توجد صفقات مفتوحة حالياً في هذه المنصة</p>
          )}

          {openPositions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground text-right">
                    <th className="p-2 text-right">الرمز</th>
                    <th className="p-2 text-right">الاتجاه</th>
                    <th className="p-2 text-right">الحجم</th>
                    <th className="p-2 text-right">سعر الفتح</th>
                    <th className="p-2 text-right">السعر الحالي</th>
                    <th className="p-2 text-right">الربح العائم</th>
                    <th className="p-2 text-right">إشارة النظام</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((p) => (
                    <tr key={p.id} className="border-b border-border/20 hover:bg-card/20 transition-colors">
                      <td className="p-2 font-bold text-foreground">{p.symbol}</td>
                      <td className="p-2">
                        <span className="flex items-center gap-1 text-foreground">
                          {p.direction === "BUY" ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-rose-400" />
                          )}
                          {directionLabel(p.direction)}
                        </span>
                      </td>
                      <td className="p-2 text-muted-foreground">{p.volume}</td>
                      <td className="p-2 text-muted-foreground font-mono">{p.openPrice}</td>
                      <td className="p-2 text-muted-foreground font-mono">{p.currentPrice}</td>
                      <td className={`p-2 font-bold font-mono ${profitClass(p.profit)}`}>{p.profit} USD</td>
                      <td className="p-2">{signalBadge(p.matchedSignal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Closed trades */}
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-border/40 pb-2">
            <h2 className="text-xs uppercase font-bold tracking-wider text-muted-foreground">الصفقات المغلقة (السجل الكامل -- آخر سنة)</h2>
          </div>

          {closedTrades.length === 0 && !loading && (
            <p className="text-center text-sm text-muted-foreground py-8">لا توجد صفقات مغلقة لهذه المنصة خلال السنة الماضية</p>
          )}

          {closedTrades.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground text-right">
                    <th className="p-2 text-right">الرمز</th>
                    <th className="p-2 text-right">الاتجاه</th>
                    <th className="p-2 text-right">الحجم</th>
                    <th className="p-2 text-right">وقت الفتح</th>
                    <th className="p-2 text-right">وقت الإغلاق</th>
                    <th className="p-2 text-right">الربح/الخسارة</th>
                    <th className="p-2 text-right">إشارة النظام</th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((t) => (
                    <tr key={t.id} className="border-b border-border/20 hover:bg-card/20 transition-colors">
                      <td className="p-2 font-bold text-foreground">{t.symbol}</td>
                      <td className="p-2">
                        <span className="flex items-center gap-1 text-foreground">
                          {t.direction === "BUY" ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-rose-400" />
                          )}
                          {directionLabel(t.direction)}
                        </span>
                      </td>
                      <td className="p-2 text-muted-foreground">{t.volume}</td>
                      <td className="p-2 text-muted-foreground font-mono">{formatDate(t.openTime)}</td>
                      <td className="p-2 text-muted-foreground font-mono">{formatDate(t.closeTime)}</td>
                      <td className={`p-2 font-bold font-mono ${profitClass(t.profit)}`}>{t.profit} USD</td>
                      <td className="p-2">{signalBadge(t.matchedSignal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/60 pb-4">
          نظام محكوم بالقواعد — لا يمثل توصية تداولية — للأغراض التعليمية فقط
        </p>
      </div>
    </div>
  );
}
