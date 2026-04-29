"use client";

/**
 * Stage 5A — لوحة تحليل الفرصة (قراءة فقط)
 * Read-only opportunity analysis control panel.
 * No execution button — preview only.  Always shows: قراءة فقط — لا يتم تنفيذ أي صفقة.
 *
 * Symbol selector: populated exclusively from Convex getMyEnabledLabSymbols
 * (enabled=true AND showInLab=true AND visible in MT5 Market Watch).
 * Free-text entry is intentionally removed — only Settings-authorized pairs appear.
 */

import { useEffect, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { institutionalCardClass } from "@/lib/ui-institutional";

// ---------------------------------------------------------------------------
// Types (mirror the route response)
// ---------------------------------------------------------------------------

type LotValidation = {
  ok: boolean;
  clipped: boolean;
  warnings: string[];
  raw: number;
  normalized: number;
};

type IndicatorSnapshot = {
  status: string;
  candleCount?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi14?: number;
  atr14?: number;
  macd?: number;
  macdHistogram?: number;
  volatility?: number;
  recentHigh?: number;
  recentLow?: number;
  lastClose?: number;
  trendBias?: string;
  momentumBias?: string;
  latestCandleTime?: number;
  candleAgeMs?: number;
};

type AnalysisResult = {
  ok: boolean;
  readOnly: true;
  symbol: string;
  selectedTimeframe: string | null;
  evaluatedTimeframes: string[];
  status: "opportunity" | "wait" | "rejected" | "insufficient_data" | "stale_data";
  direction?: "bullish" | "bearish";
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  stopPoints: number;
  targetPoints?: number;
  rrRatio?: number;
  riskUsd: number;
  riskPercentOfEquity?: number;
  estimatedLot?: number;
  lotValidation?: LotValidation;
  dataQuality: { symbolPropsAvailable: boolean; indicatorsAvailable: boolean };
  freshness: { candleAgeMs?: number; stale: boolean };
  indicators?: IndicatorSnapshot;
  reasons: string[];
  warnings: string[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

const CANDIDATE_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"] as const;
type TF = (typeof CANDIDATE_TIMEFRAMES)[number];

function fmt(n: number | undefined, digits = 5): string {
  if (n === undefined) return "—";
  return n.toFixed(digits);
}

function fmtAge(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}ث`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}د`;
  return `${(ms / 3_600_000).toFixed(1)}س`;
}

function statusColor(status: string): string {
  if (status === "opportunity") return "text-green-400";
  if (status === "stale_data") return "text-amber-400";
  if (status === "wait") return "text-sky-400";
  if (status === "rejected") return "text-red-400";
  return "text-muted-foreground";
}

function statusLabel(status: string): string {
  if (status === "opportunity") return "فرصة متاحة ✓";
  if (status === "stale_data") return "بيانات قديمة ⚠";
  if (status === "wait") return "انتظار — لا فرصة واضحة";
  if (status === "rejected") return "مرفوض";
  if (status === "insufficient_data") return "بيانات غير كافية";
  return status;
}

function directionLabel(dir?: string): string {
  if (dir === "bullish") return "↑ شراء";
  if (dir === "bearish") return "↓ بيع";
  return "—";
}

function trendLabel(t?: string): string {
  if (t === "bullish") return "↑ صاعد";
  if (t === "bearish") return "↓ هابط";
  return "محايد";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalysisControlPanel() {
  // ── Convex auth + enabled-lab-symbols ──────────────────────────────────
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const canQuery = !authLoading && isAuthenticated;

  // getMyEnabledLabSymbols: enabled=true AND showInLab=true AND in MT5 Market Watch
  const enabledSymbols = useQuery(
    api.coreQueries.getMyEnabledLabSymbols,
    canQuery ? {} : "skip",
  );
  // undefined = loading, [] = no symbols
  const symbolsLoading = canQuery && enabledSymbols === undefined;
  const allowedSymbols: string[] = enabledSymbols ?? [];

  // ── form state ─────────────────────────────────────────────────────────
  const [symbol, setSymbol] = useState<string>("");
  const [timeframeMode, setTimeframeMode] = useState<"manual" | "auto">("manual");
  const [manualTF, setManualTF] = useState<TF>("M15");
  const [candidateTFs, setCandidateTFs] = useState<Set<TF>>(new Set(["M15", "H1", "H4"]));
  const [candleCount, setCandleCount] = useState(300);
  const [stopPoints, setStopPoints] = useState(300);
  const [useRR, setUseRR] = useState(true);
  const [rrRatio, setRrRatio] = useState(2);
  const [targetPoints, setTargetPoints] = useState(600);
  const [riskUsd, setRiskUsd] = useState(50);

  // ── async state ─────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Auto-select: when allowedSymbols loads/changes, keep selection valid
  useEffect(() => {
    if (allowedSymbols.length === 0) {
      setSymbol("");
      return;
    }
    // Keep current selection if still valid; else pick first
    if (!allowedSymbols.includes(symbol)) {
      setSymbol(allowedSymbols[0]!);
    }
  }, [allowedSymbols]); // intentionally omit `symbol` to avoid loop

  const noAllowedSymbols = !symbolsLoading && allowedSymbols.length === 0;
  const canAnalyze = !busy && symbol !== "" && allowedSymbols.includes(symbol);

  function toggleCandidateTF(tf: TF) {
    setCandidateTFs((prev) => {
      const next = new Set(prev);
      if (next.has(tf)) {
        if (next.size > 1) next.delete(tf); // keep at least one
      } else {
        next.add(tf);
      }
      return next;
    });
  }

  async function handleAnalyze() {
    setFetchError(null);
    setResult(null);
    setBusy(true);
    try {
      const body = {
        symbol: symbol.trim().toUpperCase(),
        timeframeMode,
        ...(timeframeMode === "manual" ? { timeframe: manualTF } : {}),
        candidateTimeframes: Array.from(candidateTFs),
        candleCount,
        stopPoints,
        ...(useRR ? { rrRatio } : { targetPoints }),
        riskUsd,
      };
      const res = await fetch("/api/lab/analyze-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as AnalysisResult;
      setResult(json);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "خطأ غير معروف في الطلب");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div dir="rtl" className="flex flex-col gap-6">

      {/* ── control panel card ──────────────────────────────────────────── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">لوحة تحليل الفرصة</CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            قراءة فقط — لا يتم تنفيذ أي صفقة. هذا تحليل استرشادي فقط.
          </p>
        </CardHeader>
        <CardContent className="px-4 py-4 md:px-6">

          {/* حالة فارغة — لا أزواج مفعّلة */}
          {noAllowedSymbols && (
            <div className="mb-4 rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
              لا توجد أزواج مفعّلة للتحليل — فعّل الأزواج من الإعدادات
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">

            {/* الزوج — قائمة منسدلة من الأزواج المفعّلة في الإعدادات */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">الزوج</label>
              {symbolsLoading ? (
                <p className="text-xs text-muted-foreground py-2">جاري تحميل الأزواج…</p>
              ) : (
                <Select
                  value={symbol}
                  onValueChange={(v: string | null) => { if (v) { setSymbol(v); setResult(null); } }}
                  disabled={busy || noAllowedSymbols}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="اختر الزوج" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedSymbols.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* وضع الفريم */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">وضع الفريم</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={timeframeMode === "manual" ? "default" : "outline"}
                  onClick={() => setTimeframeMode("manual")}
                  disabled={busy}
                >
                  يدوي
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={timeframeMode === "auto" ? "default" : "outline"}
                  onClick={() => setTimeframeMode("auto")}
                  disabled={busy}
                >
                  تلقائي — أفضل فريم
                </Button>
              </div>
            </div>

            {/* الفريم اليدوي */}
            {timeframeMode === "manual" && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-muted-foreground">الفريم اليدوي</label>
                <div className="flex flex-wrap gap-1">
                  {CANDIDATE_TIMEFRAMES.map((tf) => (
                    <Button
                      key={tf}
                      type="button"
                      size="sm"
                      variant={manualTF === tf ? "default" : "outline"}
                      onClick={() => setManualTF(tf)}
                      disabled={busy}
                      className="min-w-[3rem]"
                    >
                      {tf}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* الفريمات المرشحة للتلقائي */}
            {timeframeMode === "auto" && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-sm font-medium text-muted-foreground">الفريمات المرشحة</label>
                <div className="flex flex-wrap gap-1">
                  {CANDIDATE_TIMEFRAMES.map((tf) => (
                    <Button
                      key={tf}
                      type="button"
                      size="sm"
                      variant={candidateTFs.has(tf) ? "default" : "outline"}
                      onClick={() => toggleCandidateTF(tf)}
                      disabled={busy}
                      className="min-w-[3rem]"
                    >
                      {tf}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* عدد الشموع */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">عدد الشموع</label>
              <Input
                type="number"
                value={candleCount}
                onChange={(e) => setCandleCount(Number(e.target.value))}
                min={50}
                max={350}
                disabled={busy}
              />
            </div>

            {/* نقاط وقف الخسارة */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">نقاط وقف الخسارة (Stop Points)</label>
              <Input
                type="number"
                value={stopPoints}
                onChange={(e) => setStopPoints(Number(e.target.value))}
                min={1}
                disabled={busy}
              />
            </div>

            {/* الهدف: RR أو نقاط */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">الهدف</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={useRR ? "default" : "outline"}
                  onClick={() => setUseRR(true)}
                  disabled={busy}
                >
                  نسبة RR
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!useRR ? "default" : "outline"}
                  onClick={() => setUseRR(false)}
                  disabled={busy}
                >
                  نقاط الهدف
                </Button>
              </div>
              {useRR ? (
                <Input
                  type="number"
                  value={rrRatio}
                  onChange={(e) => setRrRatio(Number(e.target.value))}
                  min={0.1}
                  step={0.1}
                  placeholder="RR مثال: 2"
                  disabled={busy}
                />
              ) : (
                <Input
                  type="number"
                  value={targetPoints}
                  onChange={(e) => setTargetPoints(Number(e.target.value))}
                  min={1}
                  placeholder="نقاط الهدف"
                  disabled={busy}
                />
              )}
            </div>

            {/* قيمة المخاطرة بالدولار */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">قيمة المخاطرة (USD)</label>
              <Input
                type="number"
                value={riskUsd}
                onChange={(e) => setRiskUsd(Number(e.target.value))}
                min={1}
                step={1}
                disabled={busy}
              />
            </div>

          </div>

          {/* زر التحليل */}
          <div className="mt-6 flex items-center gap-4">
            <Button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={!canAnalyze}
              className="min-w-[140px]"
            >
              {busy ? "جاري التحليل…" : "تحليل الفرصة"}
            </Button>
            <span className="text-muted-foreground text-xs">
              قراءة فقط — لا يتم تنفيذ أي صفقة
            </span>
          </div>

          {fetchError && (
            <p className="mt-3 text-sm text-red-400">{fetchError}</p>
          )}
        </CardContent>
      </Card>

      {/* ── result card ─────────────────────────────────────────────────── */}
      {result && (
        <Card className={institutionalCardClass("p-0")}>
          <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="card-title-inst">نتيجة التحليل</CardTitle>
              <Badge variant="outline" className="text-xs text-amber-300">
                قراءة فقط — لا يتم تنفيذ أي صفقة
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-4 py-4 md:px-6">
            {result.error ? (
              <p className="text-red-400 text-sm">{result.error}</p>
            ) : (
              <div className="flex flex-col gap-5">

                {/* حالة الفرصة */}
                <div className="flex flex-wrap gap-4">
                  <Stat label="الزوج" value={result.symbol} />
                  <Stat label="حالة الفرصة"
                    value={<span className={statusColor(result.status)}>{statusLabel(result.status)}</span>}
                  />
                  <Stat label="الفريم المختار" value={result.selectedTimeframe ?? "—"} />
                  <Stat label="الاتجاه" value={directionLabel(result.direction)} />
                </div>

                {/* entry / SL / TP */}
                {result.entry !== undefined && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumStat label="سعر الدخول" value={result.entry} />
                    <NumStat label="وقف الخسارة" value={result.stopLoss} className="text-red-400" />
                    <NumStat label="الهدف" value={result.takeProfit} className="text-green-400" />
                    <NumStat label="نسبة RR" value={result.rrRatio} digits={2} />
                  </div>
                )}

                {/* lot / risk */}
                {(result.estimatedLot !== undefined || result.riskUsd) && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <NumStat label="اللوت المحسوب" value={result.estimatedLot} digits={2} />
                    <NumStat label="المخاطرة (USD)" value={result.riskUsd} digits={2} />
                    <NumStat label="نقاط الوقف" value={result.stopPoints} digits={0} />
                    <NumStat label="نقاط الهدف" value={result.targetPoints} digits={0} />
                  </div>
                )}

                {/* lot validation warnings */}
                {result.lotValidation && result.lotValidation.warnings.length > 0 && (
                  <WarnList items={result.lotValidation.warnings} />
                )}

                {/* indicators */}
                {result.indicators && result.indicators.status === "ok" && (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">المؤشرات الفنية</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <NumStat label="EMA20" value={result.indicators.ema20} />
                      <NumStat label="EMA50" value={result.indicators.ema50} />
                      <NumStat label="EMA200" value={result.indicators.ema200} />
                      <NumStat label="RSI14" value={result.indicators.rsi14} digits={1} />
                      <NumStat label="ATR14" value={result.indicators.atr14} digits={5} />
                      <NumStat label="MACD Hist" value={result.indicators.macdHistogram} digits={5} />
                      <Stat label="ترند" value={trendLabel(result.indicators.trendBias)} />
                      <Stat label="الزخم" value={result.indicators.momentumBias ?? "—"} />
                    </div>
                  </div>
                )}

                {/* data quality + freshness */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="خصائص الزوج" value={result.dataQuality.symbolPropsAvailable ? "متوفرة ✓" : "غير متوفرة ✗"} />
                  <Stat label="المؤشرات" value={result.dataQuality.indicatorsAvailable ? "متوفرة ✓" : "غير متوفرة ✗"} />
                  <Stat label="عمر الشمعة" value={fmtAge(result.freshness.candleAgeMs)} />
                  <Stat label="حداثة البيانات" value={result.freshness.stale ? "قديمة ⚠" : "حديثة ✓"} />
                </div>

                {/* الإطارات التي تم تقييمها */}
                {result.evaluatedTimeframes.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">الإطارات المقيّمة:</p>
                    <div className="flex flex-wrap gap-1">
                      {result.evaluatedTimeframes.map((tf) => (
                        <Badge
                          key={tf}
                          variant={tf === result.selectedTimeframe ? "default" : "outline"}
                          className="text-xs"
                        >
                          {tf}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* أسباب القرار */}
                {result.reasons.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">أسباب القرار</p>
                    <ul className="space-y-1">
                      {result.reasons.map((r, i) => (
                        <li key={i} className="text-sm text-foreground/80">• {r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* تحذيرات */}
                {result.warnings.length > 0 && <WarnList items={result.warnings} />}

              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini display atoms
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function NumStat({
  label,
  value,
  digits = 5,
  className = "",
}: {
  label: string;
  value: number | undefined;
  digits?: number;
  className?: string;
}) {
  return (
    <Stat
      label={label}
      value={<span className={className}>{fmt(value, digits)}</span>}
    />
  );
}

function WarnList({ items }: { items: string[] }) {
  return (
    <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
      <p className="mb-1 text-xs font-semibold text-amber-300">تحذيرات</p>
      <ul className="space-y-1">
        {items.map((w, i) => (
          <li key={i} className="text-xs text-amber-200/80">⚠ {w}</li>
        ))}
      </ul>
    </div>
  );
}
