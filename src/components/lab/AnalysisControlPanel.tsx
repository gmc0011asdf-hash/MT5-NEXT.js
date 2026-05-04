"use client";

/**
 * Stage 5A — لوحة تحليل الفرصة (قراءة فقط)
 * Read-only opportunity analysis control panel.
 * No execution button — preview only.  Always shows: قراءة فقط — لا يتم تنفيذ أي صفقة.
 *
 * Symbol selector: populated exclusively from Convex getMyEnabledLabSymbols
 * (enabled=true AND showInLab=true AND visible in MT5 Market Watch).
 * Free-text entry is intentionally removed — only Settings-authorized pairs appear.
 *
 * A16: adds "حفظ القرار" button — calls saveAnalysisDecision (no trade execution).
 */

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
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

// Broker clock skew: فرق ≤ 5 دقائق طبيعي — أكبر منه مريب
const BROKER_SKEW_SMALL_MS = 5 * 60 * 1000;

function fmt(n: number | undefined, digits = 5): string {
  if (n === undefined) return "—";
  return n.toFixed(digits);
}

function fmtAge(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 0) {
    // small negative = normal broker clock skew → show as 0
    if (Math.abs(ms) < BROKER_SKEW_SMALL_MS) return "0ث";
    return "—"; // large negative — show separately as warning
  }
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
// A16: Mapping helpers — AnalysisResult → saveAnalysisDecision args
// لا تنفيذ تداول — للتوثيق التحليلي فقط
// ---------------------------------------------------------------------------

function mapToJournalStatus(status: AnalysisResult["status"]): string {
  if (status === "opportunity")        return "READY_FOR_REVIEW";
  if (status === "rejected")           return "BLOCKED";
  if (status === "wait")               return "HOLD";
  return "WATCHING";
}

function mapToFinalDecision(r: AnalysisResult): string {
  if (r.status === "opportunity" && r.direction === "bullish") return "BUY";
  if (r.status === "opportunity" && r.direction === "bearish") return "SELL";
  if (r.status === "rejected")                                 return "BLOCK";
  return "HOLD";
}

function deriveProbability(r: AnalysisResult): number {
  if (r.status === "insufficient_data") return 0;
  if (r.status === "rejected")          return 10;

  let score = 0;

  // Base score from opportunity type
  if      (r.status === "opportunity") score += 50;
  else if (r.status === "stale_data")  score += 30;
  else if (r.status === "wait")        score += 20;

  // Momentum strength bonus
  if      (r.indicators?.momentumBias === "strong") score += 12;
  else if (r.indicators?.momentumBias !== undefined) score +=  3;

  // Risk/reward bonus
  const rr = r.rrRatio;
  if (rr !== undefined) {
    if      (rr >= 3) score += 10;
    else if (rr >= 2) score +=  6;
    else if (rr >= 1) score +=  2;
    else              score -= 10; // RR < 1 خطر
  }

  // Stale data penalty
  if (r.freshness.stale) score -= 18;

  // Suspicious large-negative clock skew penalty
  if (r.freshness.candleAgeMs !== undefined && r.freshness.candleAgeMs < -BROKER_SKEW_SMALL_MS) {
    score -= 12;
  }

  // Warning count penalty
  score -= Math.min(r.warnings.length * 4, 20);

  return Math.max(5, Math.min(90, Math.round(score)));
}

function deriveGrade(r: AnalysisResult, probability: number): string {
  if (r.status === "insufficient_data" || r.status === "rejected") return "D";

  const hasStrongMomentum = r.indicators?.momentumBias === "strong";
  const goodRR            = r.rrRatio !== undefined && r.rrRatio >= 2;
  const fresh             = !r.freshness.stale;
  const noSuspiciousAge   =
    r.freshness.candleAgeMs === undefined ||
    r.freshness.candleAgeMs >= -BROKER_SKEW_SMALL_MS;
  const fewWarnings       = r.warnings.length <= 1;

  if (probability >= 72 && hasStrongMomentum && goodRR && fresh && noSuspiciousAge && fewWarnings) return "A";
  if (probability >= 58 && (hasStrongMomentum || goodRR) && fresh && noSuspiciousAge) return "B";
  if (probability >= 38 && noSuspiciousAge) return "C";
  if (probability >= 20) return "C";
  return "D";
}

function buildSaveArgs(r: AnalysisResult) {
  const timeframe   = r.selectedTimeframe ?? "UNKNOWN";
  const probability = deriveProbability(r);
  const grade       = deriveGrade(r, probability);
  const reasonText  = r.reasons.length > 0
    ? r.reasons.slice(0, 5).join(" | ")
    : "لا توجد أسباب محددة من التحليل";

  const verdictMap: Record<AnalysisResult["status"], string> = {
    opportunity:       "PASS",
    wait:              "WARN",
    rejected:          "BLOCK",
    stale_data:        "WARN",
    insufficient_data: "WARN",
  };

  // Single committee derived from the analysis engine output
  const committees = [
    {
      committeeId:   "lab-analysis-auto",
      committeeName: "تحليل المختبر الآلي",
      verdict:       verdictMap[r.status],
      score:         probability,
      summary:       r.reasons.slice(0, 3).join(" | ") || "لا ملخص متاح",
      reasons:       r.reasons.slice(0, 20),
    },
  ];

  // Risk snapshot — only when we have the essential numbers
  const risk =
    r.estimatedLot !== undefined &&
    r.stopLoss      !== undefined &&
    r.takeProfit    !== undefined
      ? {
          riskUsd:         r.riskUsd,
          riskPercent:     r.riskPercentOfEquity ?? 0,
          estimatedLot:    r.estimatedLot,
          stopLoss:        r.stopLoss,
          takeProfit1:     r.takeProfit,
          rewardRiskRatio: r.rrRatio ?? 0,
          marginSafe:
            !(r.lotValidation && r.lotValidation.warnings.length > 0),
        }
      : undefined;

  return {
    platform:          "MT5",          // ثابت — لا OKX real API
    symbol:            r.symbol,
    timeframe,
    status:            mapToJournalStatus(r.status),
    finalDecision:     mapToFinalDecision(r),
    grade,
    probability,
    entryPrice:        r.entry    ?? 0, // canSave يضمن أن entry موجود
    invalidationPrice: r.stopLoss ?? 0, // canSave يضمن أن stopLoss موجود
    reason:            reasonText,
    source:            "mt5-lab-analysis",
    committees,
    risk,
    // userId: مُستخرَج من ctx.auth server-side — لا يُمرَّر من الواجهة
    // readOnly: true مُجبَر server-side في saveAnalysisDecision
  };
}

// canSave: true فقط عند توفر الحقول الأساسية
function getMissingFields(r: AnalysisResult | null): string[] {
  if (!r) return [];
  const missing: string[] = [];
  if (r.error)                         missing.push("خطأ في التحليل");
  if (r.selectedTimeframe === null)    missing.push("الفريم الزمني");
  if (r.entry === undefined)           missing.push("سعر الدخول");
  if (r.stopLoss === undefined)        missing.push("وقف الخسارة");
  return missing;
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
  const symbolsLoading = canQuery && enabledSymbols === undefined;
  const allowedSymbols: string[] = enabledSymbols ?? [];

  // ── A16: save mutation — لا تنفيذ تداول ────────────────────────────────
  const saveDecision = useMutation(api.decisionJournal.saveAnalysisDecision);

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

  // ── async state — تحليل ─────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── async state — حفظ (A16) ────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [savedDecisionId, setSavedDecisionId] = useState<string | null>(null);
  const [savedDuplicate, setSavedDuplicate] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Auto-select: when allowedSymbols loads/changes, keep selection valid
  useEffect(() => {
    if (allowedSymbols.length === 0) {
      setSymbol("");
      return;
    }
    if (!allowedSymbols.includes(symbol)) {
      setSymbol(allowedSymbols[0]!);
    }
  }, [allowedSymbols]); // intentionally omit `symbol` to avoid loop

  const noAllowedSymbols = !symbolsLoading && allowedSymbols.length === 0;
  const canAnalyze = !busy && symbol !== "" && allowedSymbols.includes(symbol);

  // A16: save-readiness
  const missingFields = getMissingFields(result);
  const canSave = result !== null && missingFields.length === 0 && !saving && !busy;

  function toggleCandidateTF(tf: TF) {
    setCandidateTFs((prev) => {
      const next = new Set(prev);
      if (next.has(tf)) {
        if (next.size > 1) next.delete(tf);
      } else {
        next.add(tf);
      }
      return next;
    });
  }

  async function handleAnalyze() {
    setFetchError(null);
    setResult(null);
    setSavedDecisionId(null);
    setSavedDuplicate(false);
    setSaveError(null);
    setBusy(true);

    // ── Step 1: مزامنة شموع MT5 → Convex قبل التحليل ──────────────────────
    // analyze-preview يقرأ من Convex — يجب أن تكون الشموع حديثة أولاً
    const tfsToSync =
      timeframeMode === "manual" ? [manualTF] : Array.from(candidateTFs);
    setSyncStatus("مزامنة شموع MT5…");
    try {
      const syncParams = new URLSearchParams({
        symbols: symbol.trim().toUpperCase(),
        timeframes: tfsToSync.join(","),
        count:   String(candleCount),
      });
      await fetch(`/api/mt5-readonly/candles?${syncParams.toString()}`, {
        cache: "no-store",
      });
    } catch {
      // best-effort — نكمل حتى لو فشلت المزامنة
    }

    // ── Step 2: تشغيل التحليل على البيانات المحدّثة ─────────────────────────
    setSyncStatus("جاري التحليل…");
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
      setSyncStatus(null);
      setBusy(false);
    }
  }

  // A16: حفظ القرار — لا تنفيذ تداول — توثيق تحليلي فقط
  async function handleSaveDecision() {
    if (!result || !canSave) return;
    setSaving(true);
    setSaveError(null);
    setSavedDecisionId(null);
    try {
      const args = buildSaveArgs(result);
      const res  = await saveDecision(args);
      setSavedDecisionId(res.decisionId);
      if ("duplicate" in res && res.duplicate) setSavedDuplicate(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "فشل الحفظ — حاول مرة أخرى");
    } finally {
      setSaving(false);
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

          {noAllowedSymbols && (
            <div className="mb-4 rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
              لا توجد أزواج مفعّلة للتحليل — فعّل الأزواج من الإعدادات
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">

            {/* الزوج */}
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
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* وضع الفريم */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">وضع الفريم</label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={timeframeMode === "manual" ? "default" : "outline"} onClick={() => setTimeframeMode("manual")} disabled={busy}>يدوي</Button>
                <Button type="button" size="sm" variant={timeframeMode === "auto" ? "default" : "outline"} onClick={() => setTimeframeMode("auto")} disabled={busy}>تلقائي — أفضل فريم</Button>
              </div>
            </div>

            {/* الفريم اليدوي */}
            {timeframeMode === "manual" && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-muted-foreground">الفريم اليدوي</label>
                <div className="flex flex-wrap gap-1">
                  {CANDIDATE_TIMEFRAMES.map((tf) => (
                    <Button key={tf} type="button" size="sm" variant={manualTF === tf ? "default" : "outline"} onClick={() => setManualTF(tf)} disabled={busy} className="min-w-[3rem]">{tf}</Button>
                  ))}
                </div>
              </div>
            )}

            {/* الفريمات المرشحة */}
            {timeframeMode === "auto" && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-sm font-medium text-muted-foreground">الفريمات المرشحة</label>
                <div className="flex flex-wrap gap-1">
                  {CANDIDATE_TIMEFRAMES.map((tf) => (
                    <Button key={tf} type="button" size="sm" variant={candidateTFs.has(tf) ? "default" : "outline"} onClick={() => toggleCandidateTF(tf)} disabled={busy} className="min-w-[3rem]">{tf}</Button>
                  ))}
                </div>
              </div>
            )}

            {/* عدد الشموع */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">عدد الشموع</label>
              <Input type="number" value={candleCount} onChange={(e) => setCandleCount(Number(e.target.value))} min={50} max={350} disabled={busy} />
            </div>

            {/* نقاط وقف الخسارة */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">نقاط وقف الخسارة (Stop Points)</label>
              <Input type="number" value={stopPoints} onChange={(e) => setStopPoints(Number(e.target.value))} min={1} disabled={busy} />
            </div>

            {/* الهدف */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">الهدف</label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={useRR ? "default" : "outline"} onClick={() => setUseRR(true)} disabled={busy}>نسبة RR</Button>
                <Button type="button" size="sm" variant={!useRR ? "default" : "outline"} onClick={() => setUseRR(false)} disabled={busy}>نقاط الهدف</Button>
              </div>
              {useRR ? (
                <Input type="number" value={rrRatio} onChange={(e) => setRrRatio(Number(e.target.value))} min={0.1} step={0.1} placeholder="RR مثال: 2" disabled={busy} />
              ) : (
                <Input type="number" value={targetPoints} onChange={(e) => setTargetPoints(Number(e.target.value))} min={1} placeholder="نقاط الهدف" disabled={busy} />
              )}
            </div>

            {/* قيمة المخاطرة */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-muted-foreground">قيمة المخاطرة (USD)</label>
              <Input type="number" value={riskUsd} onChange={(e) => setRiskUsd(Number(e.target.value))} min={1} step={1} disabled={busy} />
            </div>

          </div>

          {/* زر التحليل */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button type="button" onClick={() => void handleAnalyze()} disabled={!canAnalyze} className="min-w-[160px]">
              {syncStatus ?? "تحليل الفرصة"}
            </Button>
            <span className="text-muted-foreground text-xs">
              قراءة فقط — لا يتم تنفيذ أي صفقة
            </span>
          </div>

          {fetchError && <p className="mt-3 text-sm text-red-400">{fetchError}</p>}
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
                  <Stat label="حالة الفرصة" value={<span className={statusColor(result.status)}>{statusLabel(result.status)}</span>} />
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
                {(() => {
                  const rawAge = result.freshness.candleAgeMs;
                  const isLargeNeg = rawAge !== undefined && rawAge < -BROKER_SKEW_SMALL_MS;
                  const isSmallNeg = rawAge !== undefined && rawAge < 0 && !isLargeNeg;
                  const freshnessLabel = isLargeNeg
                    ? <span className="text-orange-400">توقيت مريب ⚠⚠</span>
                    : result.freshness.stale
                      ? "قديمة ⚠"
                      : "حديثة ✓";
                  const ageLabel = isLargeNeg
                    ? <span className="text-orange-400">—</span>
                    : isSmallNeg
                      ? <span className="text-amber-400/80">0ث (skew)</span>
                      : fmtAge(rawAge);
                  return (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="خصائص الزوج" value={result.dataQuality.symbolPropsAvailable ? "متوفرة ✓" : "غير متوفرة ✗"} />
                      <Stat label="المؤشرات" value={result.dataQuality.indicatorsAvailable ? "متوفرة ✓" : "غير متوفرة ✗"} />
                      <Stat label="عمر الشمعة" value={ageLabel} />
                      <Stat label="حداثة البيانات" value={freshnessLabel} />
                    </div>
                  );
                })()}
                {result.freshness.candleAgeMs !== undefined && result.freshness.candleAgeMs < 0 && (
                  Math.abs(result.freshness.candleAgeMs) < BROKER_SKEW_SMALL_MS ? (
                    <p className="text-xs text-amber-300/60">
                      ⚠ توقيت الوسيط متقدم بـ{Math.abs(Math.round(result.freshness.candleAgeMs / 1000))}ث —
                      broker clock skew طبيعي
                    </p>
                  ) : (
                    <p className="text-xs text-red-400/90 font-medium">
                      ⚠⚠ فرق توقيت كبير: توقيت الوسيط متقدم بـ
                      {" "}{Math.round(Math.abs(result.freshness.candleAgeMs) / 60000)} دقيقة —
                      تحقق من timezone في MT5 أو أعد المزامنة
                    </p>
                  )
                )}

                {/* الإطارات المقيّمة */}
                {result.evaluatedTimeframes.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">الإطارات المقيّمة:</p>
                    <div className="flex flex-wrap gap-1">
                      {result.evaluatedTimeframes.map((tf) => (
                        <Badge key={tf} variant={tf === result.selectedTimeframe ? "default" : "outline"} className="text-xs">
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

                {/* ── Debug: معلومات التوقيت والمصدر ─────────────────────────── */}
                <details className="rounded border border-border/30 px-3 py-2 text-[10px] text-muted-foreground/55">
                  <summary className="cursor-pointer select-none">تفاصيل التوقيت والمصدر</summary>
                  <div className="mt-1.5 space-y-0.5 font-mono">
                    <p>الفريم: {result.selectedTimeframe}</p>
                    <p>candleAgeMs: {result.freshness.candleAgeMs ?? "—"}</p>
                    <p>
                      latestCandleTime:{" "}
                      {result.indicators?.latestCandleTime
                        ? new Date(result.indicators.latestCandleTime).toLocaleString("ar-IQ")
                        : "—"}
                    </p>
                    <p>مزامنة MT5 قبل التحليل: نعم (pre-sync A16.1)</p>
                  </div>
                </details>

                {/* ── A16: حفظ القرار في سجل القرارات ──────────────────────────── */}
                {/* لا تنفيذ تداول — للتوثيق التحليلي فقط */}
                {/* userId يُستخرَج من ctx.auth server-side — لا يُمرَّر من الواجهة */}
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4 mt-1">
                  <p className="mb-2 text-sm font-bold text-amber-200/90">
                    حفظ القرار في سجل القرارات
                  </p>

                  {/* تنبيه البيانات القديمة — الحفظ لا يزال متاحاً */}
                  {result.freshness.stale && missingFields.length === 0 && (
                    <p className="mb-2 text-xs text-amber-300/80 rounded bg-amber-500/10 px-2 py-1">
                      ⚠ بيانات قديمة — يمكن الحفظ مع ملاحظة أن الشموع قد لا تكون حديثة
                    </p>
                  )}

                  {/* حقول ناقصة — الزر معطّل */}
                  {missingFields.length > 0 && !savedDecisionId && (
                    <p className="mb-2 text-xs text-amber-300/70 rounded bg-amber-500/10 px-2 py-1">
                      الحفظ غير متاح — حقول ناقصة: {missingFields.join("، ")}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      disabled={!canSave}
                      onClick={() => void handleSaveDecision()}
                      className="bg-amber-600/80 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {saving ? "جاري الحفظ…" : "حفظ القرار"}
                    </Button>

                    {saveError && (
                      <p className="text-xs text-red-400">{saveError}</p>
                    )}
                  </div>

                  {/* نجاح الحفظ / مكرر */}
                  {savedDecisionId && (
                    <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                      savedDuplicate
                        ? "border-amber-500/30 bg-amber-500/10"
                        : "border-emerald-500/30 bg-emerald-500/10"
                    }`}>
                      <div>
                        {savedDuplicate ? (
                          <p className="text-xs font-semibold text-amber-300">
                            ⚠ قرار مشابه موجود — تم الربط بالقرار الحالي
                          </p>
                        ) : (
                          <p className="text-xs font-semibold text-emerald-300">✓ تم حفظ القرار بنجاح</p>
                        )}
                        <p className="font-mono text-[10px] text-muted-foreground">{savedDecisionId}</p>
                      </div>
                      <a
                        href="/decision-journal"
                        className="shrink-0 text-sm font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200"
                      >
                        عرض سجل القرارات ←
                      </a>
                    </div>
                  )}

                  <p className="mt-2 text-[10px] text-muted-foreground/50">
                    الحفظ للتوثيق والتحليل فقط — لا ينفذ أي تداول — لا يُرسل أوامر لـ MT5
                  </p>
                </div>

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
