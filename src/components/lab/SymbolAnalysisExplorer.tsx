"use client";

/**
 * SymbolAnalysisExplorer — مستكشف رموز MT5
 *
 * يعرض كل رموز Market Watch المتاحة للتداول، ويتيح اختيار أي رمز لعرض
 * شارت حي (آخر 250 شمعة H1) + تفاصيل المؤشرات الفنية الكاملة.
 * نظام معلوماتي تحليلي فقط — لا تنفيذ صفقات — read-only.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Search, TrendingDown, TrendingUp, Minus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { analyzeSymbolCandles } from "@/lib/gold-pro/symbol-analysis";
import type { RawCandle } from "@/lib/gold-pro/types";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface SymbolMeta {
  name: string;
  description: string;
  path: string;
  digits: number;
}

const CANDLE_COUNT = 250;
const TIMEFRAME    = "H1";
const REFRESH_MS   = 30_000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fmt(v: number, digits: number) {
  if (!Number.isFinite(v) || v === 0) return "—";
  return v.toFixed(Math.min(Math.max(digits, 2), 6));
}

function IndicatorRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: "up" | "down" | "neutral";
}) {
  const cls =
    status === "up"
      ? "bg-emerald-500/15 text-emerald-400"
      : status === "down"
      ? "bg-rose-500/15 text-rose-400"
      : "bg-muted/30 text-muted-foreground";
  const Icon = status === "up" ? TrendingUp : status === "down" ? TrendingDown : Minus;
  return (
    <div className="flex items-center justify-between border-b border-border/15 py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground/80">{label}</span>
      <span className="font-mono tabular-nums text-foreground/90">{value}</span>
      <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5", cls)}>
        <Icon className="h-3 w-3" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SymbolAnalysisExplorer() {
  const [symbols, setSymbols]               = useState<SymbolMeta[]>([]);
  const [search, setSearch]                 = useState("");
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [symbolsError, setSymbolsError]     = useState<string | null>(null);

  const [selected, setSelected]             = useState<string | null>(null);
  const [candles, setCandles]               = useState<RawCandle[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError]     = useState<string | null>(null);

  // -- تحميل قائمة الرموز المتاحة في Market Watch --------------------------
  useEffect(() => {
    let cancelled = false;
    setSymbolsLoading(true);
    setSymbolsError(null);

    const params = new URLSearchParams({ visibleOnly: "true", limit: "500" });
    fetch(`/api/mt5-readonly/symbols?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list: SymbolMeta[] = Array.isArray(j.symbols) ? j.symbols : [];
        if (j.error || list.length === 0) {
          setSymbolsError(j.error ?? "لا توجد رموز متاحة في Market Watch");
        }
        setSymbols(list);
        setSelected((prev) => {
          if (prev) return prev;
          const xau = list.find((s) => s.name === "XAUUSD");
          return (xau ?? list[0])?.name ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) setSymbolsError("تعذّر الاتصال بخدمة MT5 المحلية");
      })
      .finally(() => {
        if (!cancelled) setSymbolsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // -- جلب شموع الرمز المختار -----------------------------------------------
  const fetchCandles = useCallback((symbol: string) => {
    setAnalysisLoading(true);
    setAnalysisError(null);

    const params = new URLSearchParams({
      symbols: symbol,
      timeframes: TIMEFRAME,
      count: String(CANDLE_COUNT),
    });

    fetch(`/api/mt5-readonly/candles?${params}`)
      .then((r) => r.json())
      .then((j) => {
        const list: RawCandle[] = Array.isArray(j.candles)
          ? j.candles.filter((c: RawCandle) => c.symbol === symbol)
          : [];
        setCandles(list);
        if (list.length === 0) {
          setAnalysisError(j.error ?? "لا توجد بيانات شموع متاحة لهذا الرمز");
        }
      })
      .catch(() => {
        setAnalysisError("تعذّر الاتصال بخدمة MT5 المحلية");
        setCandles([]);
      })
      .finally(() => setAnalysisLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetchCandles(selected);
    const id = setInterval(() => fetchCandles(selected), REFRESH_MS);
    return () => clearInterval(id);
  }, [selected, fetchCandles]);

  const filteredSymbols = search.trim()
    ? symbols.filter((s) => {
        const q = search.trim().toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q) ||
          (s.path ?? "").toLowerCase().includes(q)
        );
      })
    : symbols;

  const meta     = symbols.find((s) => s.name === selected);
  const digits   = meta?.digits ?? 2;
  const analysis = analyzeSymbolCandles(candles);
  const chartData = candles.map((c) => ({
    t: new Date(c.time).toLocaleString("ar-SA", { month: "short", day: "numeric", hour: "2-digit" }),
    close: c.close,
  }));

  const sigTheme =
    analysis?.signal === "BUY"
      ? { label: "ميل صاعد", cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" }
      : analysis?.signal === "SELL"
      ? { label: "ميل هابط", cls: "border-rose-500/40 bg-rose-500/15 text-rose-300" }
      : { label: "محايد",   cls: "border-border/40 bg-muted/20 text-muted-foreground" };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* قائمة الرموز */}
      <div className="rounded-xl border border-border/20 bg-card/40 p-3">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث عن رمز..."
            className="w-full rounded-lg border border-border/30 bg-background/60 py-1.5 pr-8 pl-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-amber-500/40"
            dir="rtl"
          />
        </div>

        {symbolsLoading && (
          <p className="px-1 py-3 text-center text-[11px] text-muted-foreground/60">
            جاري تحميل قائمة الرموز...
          </p>
        )}
        {symbolsError && !symbolsLoading && (
          <p className="px-1 py-3 text-center text-[11px] text-rose-400/80">{symbolsError}</p>
        )}

        <div className="max-h-[420px] space-y-0.5 overflow-y-auto pl-1">
          {filteredSymbols.map((s) => (
            <button
              key={s.name}
              onClick={() => setSelected(s.name)}
              className={cn(
                "flex w-full flex-col rounded-lg px-2.5 py-1.5 text-right transition-colors",
                s.name === selected
                  ? "bg-amber-500/15 text-amber-300"
                  : "text-foreground/80 hover:bg-muted/20",
              )}
            >
              <span className="text-xs font-bold tracking-wide">{s.name}</span>
              {s.description && (
                <span className="truncate text-[10px] text-muted-foreground/50">{s.description}</span>
              )}
            </button>
          ))}
          {!symbolsLoading && filteredSymbols.length === 0 && !symbolsError && (
            <p className="px-1 py-3 text-center text-[11px] text-muted-foreground/50">
              لا توجد نتائج مطابقة
            </p>
          )}
        </div>

        <p className="mt-2 px-1 text-[10px] text-muted-foreground/40">
          {symbols.length > 0 ? `${symbols.length} رمز متاح في Market Watch` : ""}
        </p>
      </div>

      {/* تفاصيل الرمز المختار */}
      <div className="space-y-3">
        {!selected ? (
          <div className="rounded-xl border border-border/20 bg-card/30 p-6 text-center text-xs text-muted-foreground/60">
            اختر رمزاً من القائمة لعرض التحليل
          </div>
        ) : (
          <>
            {/* رأس الرمز */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/20 bg-card/40 px-4 py-3">
              <div>
                <p className="text-lg font-black tracking-widest text-foreground">{selected}</p>
                {meta?.description && (
                  <p className="text-[11px] text-muted-foreground/60">{meta.description}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {analysis && (
                  <span className="font-mono text-sm tabular-nums text-foreground/90">
                    {fmt(analysis.price, digits)}
                  </span>
                )}
                {analysisLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
                <span className={cn("rounded-full border px-3 py-1 text-[11px] font-bold", sigTheme.cls)}>
                  {analysis ? sigTheme.label : "—"}
                </span>
              </div>
            </div>

            {analysisError && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-300/80">
                {analysisError}
              </div>
            )}

            {/* الشارت الحي */}
            <div className="rounded-xl border border-border/20 bg-card/40 p-3">
              <p className="mb-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                الشارت ({TIMEFRAME}) — آخر {candles.length} شمعة
              </p>
              {chartData.length >= 2 ? (
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                      <XAxis
                        dataKey="t"
                        tick={{ fontSize: 9, fill: "rgba(148,163,184,0.5)" }}
                        minTickGap={40}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={["dataMin", "dataMax"]}
                        tick={{ fontSize: 9, fill: "rgba(148,163,184,0.5)" }}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                        tickFormatter={(v: number) => fmt(v, digits)}
                      />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 8, fontSize: 11 }}
                        labelStyle={{ color: "rgba(226,232,240,0.7)" }}
                        formatter={(v) => [fmt(typeof v === "number" ? v : Number(v) || 0, digits), "الإغلاق"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="close"
                        stroke="#fbbf24"
                        fill="rgba(251,191,36,0.12)"
                        strokeWidth={1.5}
                        isAnimationActive={false}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-56 items-center justify-center text-xs text-muted-foreground/50">
                  {analysisLoading ? "جاري تحميل بيانات الشارت..." : "لا توجد بيانات كافية لعرض الشارت"}
                </div>
              )}
            </div>

            {/* تفاصيل المؤشرات */}
            {analysis && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/20 bg-card/40 p-4">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    📈 المؤشرات الفنية
                  </p>
                  <IndicatorRow label="EMA 21"  value={fmt(analysis.indicators.ema21, digits)}
                    status={analysis.price > analysis.indicators.ema21 ? "up" : "down"} />
                  <IndicatorRow label="EMA 50"  value={fmt(analysis.indicators.ema50, digits)}
                    status={analysis.price > analysis.indicators.ema50 ? "up" : "down"} />
                  <IndicatorRow label="EMA 200" value={fmt(analysis.indicators.ema200, digits)}
                    status={analysis.indicators.ema200 === 0 ? "neutral" : analysis.price > analysis.indicators.ema200 ? "up" : "down"} />
                  <IndicatorRow label="MACD Histogram" value={analysis.indicators.macd.histogram.toFixed(4)}
                    status={analysis.indicators.macd.histogram > 0 ? "up" : "down"} />
                  <IndicatorRow label="RSI (14)" value={analysis.indicators.rsi.toFixed(1)}
                    status={analysis.indicators.rsi > 55 ? "up" : analysis.indicators.rsi < 45 ? "down" : "neutral"} />
                  <IndicatorRow label="ADX (14)" value={analysis.indicators.adx.adx.toFixed(1)}
                    status={analysis.indicators.adx.adx >= 25 ? "up" : "neutral"} />
                  <IndicatorRow label="ATR (14)" value={fmt(analysis.indicators.atr, digits)}
                    status="neutral" />
                  <IndicatorRow label="Bollinger Middle" value={fmt(analysis.indicators.bollingerBands.middle, digits)}
                    status={analysis.indicators.bollingerBands.position === "above" ? "up" : analysis.indicators.bollingerBands.position === "below" ? "down" : "neutral"} />
                </div>

                <div className="rounded-xl border border-border/20 bg-card/40 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      🔍 تفاصيل التحليل (التوافق)
                    </p>
                    <p className="text-xs font-bold text-amber-400">{analysis.score}/100</p>
                  </div>
                  <div className="space-y-1.5">
                    {analysis.components.map((c) => (
                      <div
                        key={c.name}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-[11px]",
                          c.score > 0
                            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300/90"
                            : "border-rose-500/15 bg-rose-500/5 text-rose-300/80",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{c.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground/60">
                            {c.score}/{c.weight}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground/60">{c.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!analysis && candles.length > 0 && (
              <div className="rounded-xl border border-border/15 bg-card/20 p-4 text-center text-xs text-muted-foreground/50">
                البيانات غير كافية لحساب التحليل الكامل ({candles.length} شمعة فقط)
              </div>
            )}
          </>
        )}

        <p className="text-center text-[10px] text-muted-foreground/40">
          الإطار الزمني {TIMEFRAME} — تحديث كل {REFRESH_MS / 1000} ثانية — للأغراض التحليلية المعلوماتية فقط — ليس توصية مالية
        </p>
      </div>
    </div>
  );
}
