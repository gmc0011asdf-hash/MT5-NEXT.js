"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingDown, TrendingUp, Minus, RefreshCw, Shield, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { analyzeSymbolCandles } from "@/lib/gold-pro/symbol-analysis";
import type { RawCandle } from "@/lib/gold-pro/types";

// ---------------------------------------------------------------------------
// Types & Agent Config
// ---------------------------------------------------------------------------
interface AgentVote {
  agent:      string;
  direction:  string;
  approved:   boolean;
  confidence: number;
  reason:     string;
  metadata?:  Record<string, any>;
}

const AGENT_CONFIG: Record<string, { label: string; indicator: string; veto: boolean }> = {
  TrendAgent:      { label: "وكيل الاتجاه",   indicator: "هيكلة السوق (ICT/EMA)", veto: true  },
  VolatilityAgent: { label: "وكيل التقلب",     indicator: "Bollinger Bands",       veto: false },
  MomentumAgent:   { label: "وكيل الزخم",      indicator: "RSI 14",                veto: false },
  RiskAgent:       { label: "وكيل المخاطرة",   indicator: "ATR 14 & RR",           veto: true  },
};
const AGENT_ORDER = ["TrendAgent", "VolatilityAgent", "MomentumAgent", "RiskAgent"] as const;

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------
const CANDLE_COUNT = 250;
const TIMEFRAMES   = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const OKX_BAR_MAP: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1H",
  H4: "4H",
  D1: "1D",
};
const REFRESH_MS   = 30_000;
const API_URL      = "http://127.0.0.1:8010"; // Base URL for FastAPI

function fmt(v: number, digits: number) {
  if (!Number.isFinite(v) || v === 0) return "—";
  return v.toFixed(Math.min(Math.max(digits, 2), 6));
}

// ---------------------------------------------------------------------------
// Agent Card Component
// ---------------------------------------------------------------------------
function AgentCard({ vote }: { vote: AgentVote }) {
  const meta = AGENT_CONFIG[vote.agent] ?? { label: vote.agent, indicator: "", veto: false };

  return (
    <div
      className={cn(
        "relative rounded-xl border p-4 transition-all duration-500",
        vote.approved
          ? "border-emerald-500/40 bg-emerald-950/30 shadow-sm"
          : "border-border/25 bg-card/40"
      )}
    >
      {meta.veto && (
        <div className="absolute right-2 top-2">
          <div className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5">
            <Shield className="h-2.5 w-2.5 text-amber-400" />
            <span className="text-[9px] font-medium text-amber-400">فيتو</span>
          </div>
        </div>
      )}
      <div className={cn("mt-1", meta.veto && "mt-5")}>
        <p className={cn("text-xs font-semibold", vote.approved ? "text-emerald-300" : "text-foreground/80")}>
          {meta.label}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground/55">{meta.indicator}</p>
      </div>
      <div
        className={cn(
          "mt-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5",
          vote.approved ? "border-emerald-500/30 bg-emerald-500/15" : "border-rose-500/20 bg-rose-950/30"
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", vote.approved ? "bg-emerald-400 animate-pulse" : "bg-rose-500")} />
        <span className={cn("text-[11px] font-medium", vote.approved ? "text-emerald-400" : "text-rose-400")}>
          {vote.approved ? "موافق" : "رفض"}
        </span>
        {vote.approved && (
          <span className="mr-auto text-[10px] tabular-nums text-emerald-500/80">
            {Math.round(vote.confidence * 100)}%
          </span>
        )}
      </div>
      {vote.reason && (
        <p className="mt-2.5 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground/65">
          {vote.reason}
        </p>
      )}
    </div>
  );
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
// Main Component
// ---------------------------------------------------------------------------
export function OkxChartAnalyzer({ symbol }: { symbol: string }) {
  const [timeframe, setTimeframe]           = useState<string>("H1");
  const [candles, setCandles]               = useState<RawCandle[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError]     = useState<string | null>(null);

  const fetchCandles = useCallback((sym: string) => {
    setAnalysisLoading(true);
    setAnalysisError(null);

    const params = new URLSearchParams({
      instId: sym,
      bar: OKX_BAR_MAP[timeframe] || "1H",
      limit: String(CANDLE_COUNT),
    });

    fetch(`${API_URL}/readonly/okx/candles?${params}`)
      .then((r) => r.json())
      .then((j) => {
        const list: RawCandle[] = Array.isArray(j.candles) ? j.candles : [];
        setCandles(list);
        if (list.length === 0) {
          setAnalysisError(j.error ?? "لا توجد بيانات شموع متاحة لهذا الرمز");
        }
      })
      .catch(() => {
        setAnalysisError("تعذّر الاتصال بخدمة OKX المحلية");
        setCandles([]);
      })
      .finally(() => setAnalysisLoading(false));
  }, [timeframe]);

  useEffect(() => {
    if (!symbol) return;
    fetchCandles(symbol);
    const id = setInterval(() => fetchCandles(symbol), REFRESH_MS);
    return () => clearInterval(id);
  }, [symbol, timeframe, fetchCandles]);



  const digits   = symbol.includes("USDT") ? 4 : 8; // Generic digit rule for crypto
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
    <div className="space-y-3 mt-6">
      {/* رأس الرمز */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/20 bg-card/40 px-4 py-3">
        <div>
          <p className="text-lg font-black tracking-widest text-foreground">{symbol}</p>
          <p className="text-[11px] text-muted-foreground/60">تحليل فني وهيكلة سوق لمنصة OKX</p>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            الشارت — آخر {candles.length} شمعة
          </p>
          <div className="flex flex-wrap gap-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "rounded px-2.5 py-1 text-[10px] font-bold transition-colors",
                  tf === timeframe
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        
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

          {/* ICT Patterns Section */}
          {analysis.ictPatterns && analysis.ictPatterns.length > 0 && (
            <div className="col-span-1 sm:col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-amber-500/80">
                ⚡ نماذج الشموع الانعكاسية (ICT / Smart Money Concepts)
              </p>
              <div className="flex flex-wrap gap-2">
                {analysis.ictPatterns.map((pattern, idx) => {
                  const isBullish = pattern.toLowerCase().includes("bullish");
                  const isBearish = pattern.toLowerCase().includes("bearish");
                  return (
                    <span
                      key={idx}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-[11px] font-bold",
                        isBullish
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                          : isBearish
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-400"
                      )}
                    >
                      {pattern}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}



      {!analysis && candles.length > 0 && (
        <div className="rounded-xl border border-border/15 bg-card/20 p-4 text-center text-xs text-muted-foreground/50">
          البيانات غير كافية لحساب التحليل الكامل ({candles.length} شمعة فقط)
        </div>
      )}
    </div>
  );
}
