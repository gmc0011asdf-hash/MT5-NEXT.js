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
import {
  type DemoExecutionSettings,
  type ExecutionEligibility,
  type ExecutionRequestPreview,
  EXECUTION_BUTTON_TEXT,
  DEFAULT_DEMO_SETTINGS,
  loadDemoSettings,
} from "@/lib/trading/shared/demo-execution-settings";
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

// TickData — شكل tick واحد من /api/mt5-readonly/snapshot → snapshot.ticks[]
type TickData = {
  symbol:         string;
  bid?:           number;
  ask?:           number;
  spread?:        number;
  spread_points?: number;
  market_closed?: boolean;
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
  // A24: live MT5 tick — مدموج بعد التحليل، best-effort
  currentBid?:          number;
  currentAsk?:          number;
  currentSpread?:       number;
  currentSpreadPoints?: number;
  currentPriceSource?:  string;
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

function gradeColor(g: string): string {
  if (g === "A+" || g === "A") return "text-emerald-300";
  if (g === "B")               return "text-amber-300";
  return "text-red-300";
}

function verdictLabel(v: string): string {
  if (v === "PASS")  return "ناجح ✓";
  if (v === "WARN")  return "تحذير ⚠";
  if (v === "BLOCK") return "محظور ✗";
  return v;
}

function verdictBadgeClass(v: string): string {
  if (v === "PASS")  return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
  if (v === "WARN")  return "text-amber-300   bg-amber-500/10   border-amber-500/30";
  if (v === "BLOCK") return "text-red-300     bg-red-500/10     border-red-500/30";
  return "text-muted-foreground bg-muted/10 border-border";
}

function verdictBarColor(v: string): string {
  if (v === "PASS")  return "bg-emerald-500/70";
  if (v === "WARN")  return "bg-amber-500/70";
  if (v === "BLOCK") return "bg-red-500/70";
  return "bg-muted";
}

function finalDecisionColor(d: string): string {
  if (d === "BUY")   return "text-emerald-300";
  if (d === "SELL")  return "text-red-300";
  if (d === "BLOCK") return "text-red-400";
  return "text-amber-300";
}

function finalDecisionLabel(d: string): string {
  if (d === "BUY")   return "شراء ↑";
  if (d === "SELL")  return "بيع ↓";
  if (d === "HOLD")  return "انتظار ⏸";
  if (d === "BLOCK") return "حظر ✗";
  return d;
}

function journalStatusLabel(s: string): string {
  const map: Record<string, string> = {
    READY_FOR_REVIEW: "جاهز للمراجعة",
    BLOCKED:          "محظور",
    HOLD:             "تعليق",
    WATCHING:         "مراقبة",
    SETUP_FORMING:    "تهيؤ",
  };
  return map[s] ?? s;
}

// ---------------------------------------------------------------------------
// A18: Multi-Committee Scoring — AnalysisResult → saveAnalysisDecision args
// لا تنفيذ تداول — للتوثيق التحليلي فقط
// ---------------------------------------------------------------------------

type CommitteeResult = {
  committeeId:   string;
  committeeName: string;
  verdict:       "PASS" | "WARN" | "BLOCK";
  score:         number;  // 0–100
  summary:       string;
  reasons:       string[];
};

// أوزان اللجان — مجموعها 1.0
const COMMITTEE_WEIGHTS: Record<string, number> = {
  "trend":         0.25,
  "momentum":      0.20,
  "entry-quality": 0.20,
  "risk":          0.15,
  "freshness":     0.15,
  "protection":    0.05,
};

// اللجان الحرجة التي تستطيع إصدار BLOCK فعّال على القرار
const CRITICAL_COMMITTEES = new Set(["freshness", "entry-quality"]);

// ── 1. لجنة الاتجاه ──────────────────────────────────────────────────────────
function buildTrendCommittee(r: AnalysisResult): CommitteeResult {
  const ind = r.indicators;
  if (!ind || ind.status !== "ok" || !r.dataQuality.indicatorsAvailable) {
    return {
      committeeId: "trend", committeeName: "لجنة الاتجاه",
      verdict: "WARN", score: 20,
      summary: "بيانات المؤشرات غير متوفرة",
      reasons: ["لا توجد بيانات EMA لتحديد الاتجاه"],
    };
  }

  const { ema20, ema50, ema200, trendBias } = ind;
  const hasEMAs = ema20 !== undefined && ema50 !== undefined && ema200 !== undefined;
  const reasons: string[] = [];
  let score = 25;
  let verdict: CommitteeResult["verdict"] = "WARN";

  if (trendBias === "bullish") {
    if (hasEMAs && ema20! > ema50! && ema50! > ema200!) {
      score = 83; verdict = "PASS";
      reasons.push(`EMA20(${ema20!.toFixed(2)}) > EMA50(${ema50!.toFixed(2)}) > EMA200(${ema200!.toFixed(2)}) — ترند صاعد قوي`);
    } else if (hasEMAs && ema20! > ema50!) {
      score = 57; verdict = "WARN";
      reasons.push("ترند صاعد جزئي — EMA20 > EMA50 لكن EMA200 غير مؤكد");
    } else {
      score = 30; verdict = "WARN";
      reasons.push("إشارة اتجاه صاعد ضعيفة — EMAs غير متوافقة بالكامل");
    }
  } else if (trendBias === "bearish") {
    if (hasEMAs && ema20! < ema50! && ema50! < ema200!) {
      score = 83; verdict = "PASS";
      reasons.push(`EMA20(${ema20!.toFixed(2)}) < EMA50(${ema50!.toFixed(2)}) < EMA200(${ema200!.toFixed(2)}) — ترند هابط قوي`);
    } else if (hasEMAs && ema20! < ema50!) {
      score = 57; verdict = "WARN";
      reasons.push("ترند هابط جزئي — EMA20 < EMA50 لكن EMA200 غير مؤكد");
    } else {
      score = 30; verdict = "WARN";
      reasons.push("إشارة اتجاه هابط ضعيفة — EMAs غير متوافقة بالكامل");
    }
  } else {
    score = 22; verdict = "WARN";
    reasons.push("ترند محايد — لا اتجاه واضح من EMAs");
  }

  return {
    committeeId: "trend", committeeName: "لجنة الاتجاه",
    verdict, score,
    summary: `ترند: ${trendBias ?? "محايد"} — EMAs: ${hasEMAs ? "متوفرة" : "ناقصة"}`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 2. لجنة الزخم ────────────────────────────────────────────────────────────
function buildMomentumCommittee(r: AnalysisResult): CommitteeResult {
  const ind = r.indicators;
  if (!ind || ind.status !== "ok") {
    return {
      committeeId: "momentum", committeeName: "لجنة الزخم",
      verdict: "WARN", score: 20,
      summary: "بيانات الزخم غير متوفرة",
      reasons: ["RSI و MACD غير متوفرين"],
    };
  }

  const { rsi14, macdHistogram, momentumBias } = ind;
  const reasons: string[] = [];
  let score = 30;
  let verdict: CommitteeResult["verdict"] = "WARN";

  if (momentumBias === "strong") {
    score += 35;
    reasons.push("زخم قوي — RSI و MACD متوافقان مع الاتجاه");
  } else if (momentumBias !== undefined) {
    score += 8;
    reasons.push("زخم ضعيف — حركة بطيئة محتملة");
  }

  if (rsi14 !== undefined) {
    reasons.push(`RSI14: ${rsi14.toFixed(1)}`);
    if      (rsi14 > 78) { score -= 22; reasons.push("RSI: تشبع شرائي مفرط"); }
    else if (rsi14 < 22) { score -= 22; reasons.push("RSI: تشبع بيعي مفرط"); }
    else if (rsi14 >= 45 && rsi14 <= 65) { score += 8; }
  }

  if (macdHistogram !== undefined) {
    const dir = r.direction;
    if ((dir === "bullish" && macdHistogram > 0) || (dir === "bearish" && macdHistogram < 0)) {
      score += 8; reasons.push(`MACD (${macdHistogram.toFixed(5)}) يتوافق مع الاتجاه`);
    } else if (macdHistogram !== 0) {
      score -= 5; reasons.push(`MACD (${macdHistogram.toFixed(5)}) عكس الاتجاه`);
    }
  }

  score = Math.max(5, Math.min(90, score));
  verdict = score >= 60 ? "PASS" : "WARN";

  return {
    committeeId: "momentum", committeeName: "لجنة الزخم",
    verdict, score,
    summary: `زخم: ${momentumBias ?? "غير محدد"} — RSI: ${rsi14?.toFixed(1) ?? "—"}`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 3. لجنة جودة الدخول ──────────────────────────────────────────────────────
function buildEntryQualityCommittee(r: AnalysisResult): CommitteeResult {
  if (r.entry === undefined || r.stopLoss === undefined) {
    return {
      committeeId: "entry-quality", committeeName: "لجنة جودة الدخول",
      verdict: "WARN", score: 15,
      summary: "لا توجد نقاط دخول أو وقف محددة",
      reasons: ["entry أو stopLoss غير متوفر"],
    };
  }

  const rr = r.rrRatio;
  const reasons: string[] = [];
  let score = 30;
  let verdict: CommitteeResult["verdict"] = "WARN";

  if (rr !== undefined) {
    reasons.push(`نسبة R/R: ${rr.toFixed(2)}`);
    if      (rr >= 3)   { score = 88; verdict = "PASS";  reasons.push("R/R ممتاز ≥ 3:1"); }
    else if (rr >= 2)   { score = 72; verdict = "PASS";  reasons.push("R/R جيد ≥ 2:1"); }
    else if (rr >= 1.5) { score = 55; verdict = "WARN";  reasons.push("R/R مقبول ≥ 1.5:1"); }
    else if (rr >= 1)   { score = 38; verdict = "WARN";  reasons.push("R/R ضعيف — خطر/عائد متساوي"); }
    else                { score = 15; verdict = "BLOCK"; reasons.push(`R/R سيء ${rr.toFixed(2)}:1 — الخطر أكبر من العائد`); }
  } else {
    score = 25; verdict = "WARN"; reasons.push("نسبة R/R غير محسوبة");
  }

  if (r.indicators?.atr14 !== undefined) reasons.push(`ATR14: ${r.indicators.atr14.toFixed(5)}`);
  reasons.push(`دخول: ${r.entry?.toFixed(5)} — وقف: ${r.stopLoss?.toFixed(5)}`);

  return {
    committeeId: "entry-quality", committeeName: "لجنة جودة الدخول",
    verdict, score,
    summary: `R/R: ${rr?.toFixed(2) ?? "—"} — دخول: ${r.entry?.toFixed(5) ?? "—"}`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 4. لجنة المخاطرة ─────────────────────────────────────────────────────────
function buildRiskCommittee(r: AnalysisResult): CommitteeResult {
  const lotWarnings = r.lotValidation?.warnings ?? [];
  const reasons: string[] = [];
  let score = 72;
  let verdict: CommitteeResult["verdict"] = "PASS";

  if (lotWarnings.length > 0) {
    score -= lotWarnings.length * 15;
    verdict = "WARN";
    for (const w of lotWarnings.slice(0, 3)) reasons.push(w);
  }

  if (r.estimatedLot !== undefined && r.estimatedLot > 0) {
    reasons.push(`لوت محسوب: ${r.estimatedLot.toFixed(2)}`);
  } else {
    score -= 15; verdict = "WARN";
    reasons.push("اللوت غير محسوب — خصائص الزوج غير متوفرة");
  }

  if (r.riskPercentOfEquity !== undefined) {
    reasons.push(`مخاطرة: ${r.riskPercentOfEquity.toFixed(1)}%`);
    if      (r.riskPercentOfEquity > 5) { score -= 20; verdict = "WARN"; reasons.push("مخاطرة مرتفعة > 5% من الرصيد"); }
    else if (r.riskPercentOfEquity > 2) { score -= 5; }
  }

  reasons.push(`مخاطرة بالدولار: $${r.riskUsd}`);
  score = Math.max(5, Math.min(90, score));
  if (score >= 60) verdict = "PASS";

  return {
    committeeId: "risk", committeeName: "لجنة المخاطرة",
    verdict, score,
    summary: `لوت: ${r.estimatedLot?.toFixed(2) ?? "—"} — $${r.riskUsd}`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 5. لجنة حداثة البيانات ───────────────────────────────────────────────────
function buildFreshnessCommittee(r: AnalysisResult): CommitteeResult {
  const rawAge     = r.freshness.candleAgeMs;
  const isLargeNeg = rawAge !== undefined && rawAge < -BROKER_SKEW_SMALL_MS;
  const isSmallNeg = rawAge !== undefined && rawAge < 0 && !isLargeNeg;
  const reasons: string[] = [];
  let score = 82;
  let verdict: CommitteeResult["verdict"] = "PASS";

  if (isLargeNeg) {
    const negMin = Math.round(Math.abs(rawAge!) / 60000);
    score = 14; verdict = "BLOCK";
    reasons.push(`فرق توقيت كبير: الوسيط متقدم بـ ${negMin} دقيقة`);
    reasons.push("البيانات غير موثوقة — تحقق من timezone في MT5");
  } else if (isSmallNeg) {
    score = 78; verdict = "PASS";
    reasons.push(`broker clock skew بسيط: ${Math.abs(Math.round(rawAge! / 1000))}ث — مقبول`);
  } else if (r.freshness.stale) {
    score = 28; verdict = "WARN";
    if (rawAge !== undefined) reasons.push(`عمر الشمعة: ${Math.round(rawAge / 60000)} دقيقة — قديمة`);
    reasons.push("بيانات قديمة — أعد المزامنة");
  } else {
    if (rawAge !== undefined && rawAge >= 0) {
      const label = rawAge < 60_000 ? `${Math.round(rawAge / 1000)}ث` : `${Math.round(rawAge / 60000)}د`;
      reasons.push(`عمر الشمعة: ${label} — حديثة`);
    }
    reasons.push("بيانات حديثة ومزامنة ناجحة");
  }

  return {
    committeeId: "freshness", committeeName: "لجنة حداثة البيانات",
    verdict, score,
    summary: isLargeNeg ? "توقيت مريب ⚠⚠" : r.freshness.stale ? "بيانات قديمة ⚠" : "بيانات حديثة ✓",
    reasons: reasons.slice(0, 5),
  };
}

// ── 6. لجنة الحماية ──────────────────────────────────────────────────────────
function buildProtectionCommittee(r: AnalysisResult): CommitteeResult {
  const warnCount = r.warnings.length;
  const reasons   = r.warnings.slice(0, 5);
  let score = 80;
  let verdict: CommitteeResult["verdict"] = "PASS";

  if      (warnCount === 0) { score = 88; verdict = "PASS"; }
  else if (warnCount === 1) { score = 65; verdict = "WARN"; }
  else if (warnCount === 2) { score = 48; verdict = "WARN"; }
  else if (warnCount === 3) { score = 32; verdict = "WARN"; }
  else                     { score = 18; verdict = "WARN"; }

  if (warnCount === 0) reasons.push("لا توجد تحذيرات");
  else reasons.push(`${warnCount} تحذير — مراجعة مطلوبة`);

  return {
    committeeId: "protection", committeeName: "لجنة الحماية",
    verdict, score,
    summary: `${warnCount} تحذير — ${verdict === "PASS" ? "لا مخاوف" : "مراجعة مطلوبة"}`,
    reasons: reasons.slice(0, 8),
  };
}

// ── حساب الاحتمالية الموزونة من اللجان ──────────────────────────────────────
function computeWeightedProbability(committees: CommitteeResult[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const c of committees) {
    const w = COMMITTEE_WEIGHTS[c.committeeId] ?? 0.1;
    weightedSum += c.score * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return 0;
  return Math.max(5, Math.min(90, Math.round(weightedSum / totalWeight)));
}

// ── حساب الدرجة من اللجان ────────────────────────────────────────────────────
function deriveGradeFromCommittees(
  r: AnalysisResult,
  committees: CommitteeResult[],
  probability: number,
): string {
  const hasBlock    = committees.some(c => c.verdict === "BLOCK");
  const warnCount   = committees.filter(c => c.verdict === "WARN").length;
  const fresh       = !r.freshness.stale &&
    (r.freshness.candleAgeMs === undefined || r.freshness.candleAgeMs >= -BROKER_SKEW_SMALL_MS);

  if (hasBlock) return "D";
  if (probability >= 72 && warnCount <= 1 && fresh) return "A";
  if (probability >= 58 && warnCount <= 2 && fresh) return "B";
  if (probability >= 38) return "C";
  if (probability >= 20) return "C";
  return "D";
}

// ── DecisionSummary — نتيجة اللجان للعرض المسبق والحفظ معاً ─────────────────

type DecisionSummary = {
  committees:     CommitteeResult[];
  probability:    number;
  grade:          string;
  finalDecision:  string;
  journalStatus:  string;
  criticalBlocks: CommitteeResult[];
  anyBlock:       boolean;
};

// buildDecisionSummary — الدالة المشتركة بين العرض قبل الحفظ وعملية الحفظ الفعلية
// لا تنفيذ تداول — للتحليل والتوثيق فقط
function buildDecisionSummary(r: AnalysisResult): DecisionSummary {
  const committees: CommitteeResult[] = [
    buildTrendCommittee(r),
    buildMomentumCommittee(r),
    buildEntryQualityCommittee(r),
    buildRiskCommittee(r),
    buildFreshnessCommittee(r),
    buildProtectionCommittee(r),
  ];

  const probability = computeWeightedProbability(committees);
  const grade       = deriveGradeFromCommittees(r, committees, probability);

  const criticalBlocks = committees.filter(
    c => c.verdict === "BLOCK" && CRITICAL_COMMITTEES.has(c.committeeId),
  );
  const anyBlock = committees.some(c => c.verdict === "BLOCK");

  let finalDecision: string;
  if (r.status === "opportunity" && r.direction === "bullish") finalDecision = "BUY";
  else if (r.status === "opportunity" && r.direction === "bearish") finalDecision = "SELL";
  else if (r.status === "rejected") finalDecision = "BLOCK";
  else finalDecision = "HOLD";

  if (criticalBlocks.length > 0) {
    finalDecision = "BLOCK";
  } else if (anyBlock && (finalDecision === "BUY" || finalDecision === "SELL")) {
    finalDecision = "HOLD";
  }

  let journalStatus: string;
  if      (finalDecision === "BLOCK")  journalStatus = "BLOCKED";
  else if (finalDecision === "HOLD")   journalStatus = "HOLD";
  else if (r.status === "opportunity") journalStatus = "READY_FOR_REVIEW";
  else if (r.status === "wait")        journalStatus = "HOLD";
  else journalStatus = "WATCHING";

  return { committees, probability, grade, finalDecision, journalStatus, criticalBlocks, anyBlock };
}

// ── buildSaveArgs — يفوّض إلى buildDecisionSummary لتجنّب تكرار المنطق ────────
function buildSaveArgs(r: AnalysisResult) {
  const timeframe = r.selectedTimeframe ?? "UNKNOWN";
  const { committees, probability, grade, finalDecision, journalStatus } = buildDecisionSummary(r);

  const committeeInsights = committees
    .filter(c => c.verdict !== "PASS")
    .map(c => `[${c.committeeName}] ${c.summary}`)
    .slice(0, 3);
  const reasonText = committeeInsights.length > 0
    ? committeeInsights.join(" | ")
    : r.reasons.slice(0, 3).join(" | ") || "لا توجد ملاحظات من اللجان";

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
          marginSafe:      !(r.lotValidation && r.lotValidation.warnings.length > 0),
        }
      : undefined;

  return {
    platform:          "MT5",
    symbol:            r.symbol,
    timeframe,
    status:            journalStatus,
    finalDecision,
    grade,
    probability,
    entryPrice:        r.entry    ?? 0,
    invalidationPrice: r.stopLoss ?? 0,
    reason:            reasonText,
    source:            "mt5-lab-analysis",
    committees,
    risk,
    // userId: من ctx.auth server-side — لا يُمرَّر من الواجهة
    // readOnly: true مُجبَر server-side
  };
}

// ── CommitteeSummaryPreview — A22 ────────────────────────────────────────────
// يعرض ملخص اللجان قبل الحفظ — قراءة فقط — لا useMutation — لا تنفيذ تداول
function CommitteeSummaryPreview({ result }: { result: AnalysisResult }) {
  const {
    committees, probability, grade,
    finalDecision, journalStatus,
    criticalBlocks,
  } = buildDecisionSummary(result);

  const passCount  = committees.filter(c => c.verdict === "PASS").length;
  const warnCount  = committees.filter(c => c.verdict === "WARN").length;
  const blockCount = committees.filter(c => c.verdict === "BLOCK").length;

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4 space-y-4">
      <p className="text-sm font-bold text-amber-200/90">ملخص قرار اللجان قبل الحفظ</p>

      {/* تحذير عند وجود لجنة حرجة BLOCK */}
      {criticalBlocks.length > 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-start gap-2">
          <span className="shrink-0 font-bold mt-0.5">⚠</span>
          <span>
            لجنة حرجة أصدرت BLOCK ({criticalBlocks.map(c => c.committeeName).join("، ")}) —
            هذا القرار سيتم حفظه كحظر/مراجعة وليس كفرصة جاهزة.
          </span>
        </div>
      )}

      {/* القرار + حالة السجل + الاحتمالية + الدرجة */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">القرار المتوقع</span>
          <span className={`text-sm font-bold ${finalDecisionColor(finalDecision)}`}>
            {finalDecisionLabel(finalDecision)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">حالة السجل</span>
          <span className="text-sm font-medium text-foreground">{journalStatusLabel(journalStatus)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">الاحتمالية الموزونة</span>
          <span className="text-sm font-bold tabular-nums text-foreground">{probability}%</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">الدرجة</span>
          <span className={`text-sm font-bold ${gradeColor(grade)}`}>{grade}</span>
        </div>
      </div>

      {/* عداد PASS / WARN / BLOCK */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
          ✓ PASS: {passCount}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
          ⚠ WARN: {warnCount}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          blockCount > 0
            ? "border-red-500/30 bg-red-500/10 text-red-300"
            : "border-border bg-muted/10 text-muted-foreground"
        }`}>
          ✗ BLOCK: {blockCount}
        </span>
      </div>

      {/* بطاقات اللجان الست */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {committees.map((c) => (
          <div key={c.committeeId} className="rounded-md border border-border bg-muted/5 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground leading-tight">
                {c.committeeName}
              </span>
              <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${verdictBadgeClass(c.verdict)}`}>
                {verdictLabel(c.verdict)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted/40">
              <div
                className={`h-full rounded-full ${verdictBarColor(c.verdict)}`}
                style={{ width: `${Math.min(100, Math.max(0, c.score))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground gap-1">
              <span className="truncate">{c.summary}</span>
              <span className="font-mono shrink-0">{c.score}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TradeOrderPreview — A23 ──────────────────────────────────────────────────
// Preview فقط — لا order_send — لا تنفيذ تداول — لا pending order حقيقي

type OrderTypePreview =
  | "BUY_MARKET_PREVIEW"
  | "BUY_LIMIT_PREVIEW"
  | "BUY_STOP_PREVIEW"
  | "SELL_MARKET_PREVIEW"
  | "SELL_LIMIT_PREVIEW"
  | "SELL_STOP_PREVIEW"
  | "NONE";

type TradeOrderPreview = {
  allowed:          boolean;
  blockedReasons:   string[];
  orderType:        OrderTypePreview;
  symbol:           string;
  direction:        "bullish" | "bearish" | null;
  entry:            number | undefined;
  stopLoss:         number | undefined;
  takeProfit:       number | undefined;
  estimatedLot:     number | undefined;
  riskUsd:          number;
  rrRatio:          number | undefined;
  executionEnabled: false; // دائماً false في A23
};

// buildTradeOrderPreview — يستخدم DecisionSummary الجاهز لتجنب تكرار المنطق
// لا order_send — لا تنفيذ — Preview للمراجعة فقط
function buildTradeOrderPreview(
  result: AnalysisResult,
  summary: DecisionSummary,
): TradeOrderPreview {
  const { finalDecision, criticalBlocks, committees } = summary;
  const blockedReasons: string[] = [];

  // ── فحص شروط السماح ──────────────────────────────────────────────────────
  if (finalDecision !== "BUY" && finalDecision !== "SELL") {
    blockedReasons.push(`القرار "${finalDecisionLabel(finalDecision)}" لا يُولّد أمر تداول`);
  }
  if (criticalBlocks.length > 0) {
    blockedReasons.push(
      `لجنة حرجة أصدرت BLOCK: ${criticalBlocks.map(c => c.committeeName).join("، ")}`,
    );
  }
  if (result.entry === undefined)   blockedReasons.push("سعر الدخول غير متوفر");
  if (result.stopLoss === undefined) blockedReasons.push("وقف الخسارة غير متوفر");
  if (result.takeProfit === undefined) blockedReasons.push("الهدف غير متوفر");
  if (!result.estimatedLot || result.estimatedLot <= 0) {
    blockedReasons.push("اللوت غير محسوب — خصائص الزوج غير متوفرة");
  }
  if ((result.rrRatio ?? 0) < 1.5) {
    blockedReasons.push(
      `نسبة R/R = ${result.rrRatio?.toFixed(2) ?? "—"} أقل من الحد الأدنى 1.5:1`,
    );
  }
  if (result.freshness.stale) {
    blockedReasons.push("بيانات قديمة — أعد المزامنة قبل أي تنفيذ");
  }
  const freshnessC = committees.find(c => c.committeeId === "freshness");
  if (freshnessC?.verdict === "BLOCK") {
    blockedReasons.push("لجنة حداثة البيانات أصدرت BLOCK");
  }
  const riskC = committees.find(c => c.committeeId === "risk");
  if (riskC?.verdict === "BLOCK") {
    blockedReasons.push("لجنة المخاطرة أصدرت BLOCK");
  }

  const allowed = blockedReasons.length === 0;

  // ── تحديد نوع الأمر — A24: يستخدم live tick إذا توفّر ────────────────────
  // BUY → نقارن entry مع ask (سعر الشراء الفعلي لدى الوسيط)
  // SELL → نقارن entry مع bid (سعر البيع الفعلي لدى الوسيط)
  // fallback → lastClose إذا لم يتوفر tick حقيقي
  let orderType: OrderTypePreview = "NONE";

  if (finalDecision === "BUY" || finalDecision === "SELL") {
    const entry = result.entry;

    const refPrice =
      finalDecision === "BUY"
        ? (result.currentAsk ?? result.indicators?.lastClose)
        : (result.currentBid ?? result.indicators?.lastClose);

    // نسبة الفرق — threshold 0.05% ≈ 5 pips على 1.0000
    const MARKET_THRESHOLD_RATIO = 0.0005;
    const isMarket =
      !refPrice || !entry ||
      Math.abs(entry - refPrice) / refPrice < MARKET_THRESHOLD_RATIO;

    if (finalDecision === "BUY") {
      if (isMarket)             orderType = "BUY_MARKET_PREVIEW";
      else if (entry < refPrice!) orderType = "BUY_LIMIT_PREVIEW";
      else                      orderType = "BUY_STOP_PREVIEW";
    } else {
      if (isMarket)             orderType = "SELL_MARKET_PREVIEW";
      else if (entry > refPrice!) orderType = "SELL_LIMIT_PREVIEW";
      else                      orderType = "SELL_STOP_PREVIEW";
    }
  }

  return {
    allowed,
    blockedReasons,
    orderType,
    symbol:          result.symbol,
    direction:       result.direction ?? null,
    entry:           result.entry,
    stopLoss:        result.stopLoss,
    takeProfit:      result.takeProfit,
    estimatedLot:    result.estimatedLot,
    riskUsd:         result.riskUsd,
    rrRatio:         result.rrRatio,
    executionEnabled: false as const, // مُثبَّت في A23
  };
}

// ── خريطة أسماء أنواع الأوامر بالعربية ──────────────────────────────────────
const ORDER_TYPE_LABEL: Record<OrderTypePreview, string> = {
  BUY_MARKET_PREVIEW:  "شراء بالسوق — Market",
  BUY_LIMIT_PREVIEW:   "شراء بحد أدنى — Buy Limit",
  BUY_STOP_PREVIEW:    "شراء إيقاف — Buy Stop",
  SELL_MARKET_PREVIEW: "بيع بالسوق — Market",
  SELL_LIMIT_PREVIEW:  "بيع بحد أعلى — Sell Limit",
  SELL_STOP_PREVIEW:   "بيع إيقاف — Sell Stop",
  NONE:                "لا يوجد أمر",
};

// ── A26.2/A26.3: نوع نتيجة الأمر من /api/mt5-demo/order-send ─────────────────
type DemoOrderResult = {
  ok:                  boolean;
  accepted:            boolean;
  ticket?:             number;
  retcode?:            number;
  retcodeText?:        string;
  message?:            string;
  fillingModeUsed?:    string;    // A26.3: FOK | IOC | RETURN
  fillingModesTried?:  string[];  // A26.3: modes tried in order
  symbolFillingMode?:  number;    // A26.3: raw bitmask from symbol_info
  requestSummary?:     { symbol: string; orderType: string; lot: number; price: number; sl: number; tp: number };
  accountLogin?:       number;
  server?:             string;
  demoOnly:            boolean;
  error?:              string;
};

// ── TradePreviewPanel — A23/A24/A25/A26.1/A26.2 ──────────────────────────────
// A26.2: زر إرسال Demo مفعّل داخل الـ modal فقط بعد checkbox — لا real execution
function TradePreviewPanel({ result }: { result: AnalysisResult }) {
  // A25: load demo execution settings from localStorage (lazy init — no flash)
  const [settings] = useState<DemoExecutionSettings>(loadDemoSettings);
  // A26.1: state for review modal
  const [showModal,    setShowModal]    = useState(false);
  const [userConfirmed, setUserConfirmed] = useState(false);

  // A26.2: state for actual Demo order send — لا تنفيذ تداول خارج الـ modal
  const [ordering,    setOrdering]    = useState(false);
  const [orderResult, setOrderResult] = useState<DemoOrderResult | null>(null);
  const [orderError,  setOrderError]  = useState<string | null>(null);

  const summary = buildDecisionSummary(result);
  const preview = buildTradeOrderPreview(result, summary);
  const eligibility = buildExecutionEligibility(
    preview,
    settings,
    { spreadPoints: result.currentSpreadPoints },
  );

  // A26.1: زر المراجعة يُفعَّل فقط عند اكتمال جميع الشروط + DEMO_ARMED
  const canOpenReview =
    preview.allowed &&
    eligibility.eligible &&
    settings.executionMode === "DEMO_ARMED" &&
    !settings.killSwitchEnabled &&
    settings.isConfirmedDemo;

  // A26.2: يمكن الإرسال فقط بعد checkbox + جميع شروط canOpenReview + ليس قيد التنفيذ
  const canSend = canOpenReview && userConfirmed && !ordering;

  // A26.2: إرسال أمر Demo إلى MT5 — Demo فقط — بعد تأكيد يدوي
  async function handleSendToMT5Demo() {
    if (!canSend) return;
    setOrdering(true);
    setOrderResult(null);
    setOrderError(null);
    try {
      const execReq = buildExecutionRequestPreview(result, preview, eligibility);
      // إضافة manualConfirmation: true من هنا — لا يُمرَّر userId
      const body = { ...execReq, manualConfirmation: true as const };
      const res = await fetch("/api/mt5-demo/order-send", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        cache:   "no-store",
      });
      const data = (await res.json()) as DemoOrderResult;
      if (data.ok || data.accepted) {
        setOrderResult(data);
        setUserConfirmed(false); // إعادة تعيين التأكيد بعد الإرسال
      } else {
        setOrderError(data.error ?? "فشل إرسال الأمر إلى MT5");
      }
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : "خطأ غير معروف في الإرسال");
    } finally {
      setOrdering(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground">
          مراجعة أمر التداول — Demo Preview
        </p>
        <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
          Preview فقط — لا يُرسل أمر حقيقي
        </span>
      </div>

      {/* Allowed → تفاصيل الأمر */}
      {preview.allowed ? (
        <>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            ✓ الشروط متحققة — يمكن مراجعة الأرقام أدناه قبل أي قرار مستقبلي
          </div>

          {/* بيانات الأمر */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">نوع الأمر</span>
              <span className="text-sm font-semibold text-foreground">
                {ORDER_TYPE_LABEL[preview.orderType]}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">الرمز</span>
              <span className="text-sm font-mono font-bold text-foreground">{preview.symbol}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">الاتجاه</span>
              <span className={`text-sm font-bold ${
                preview.direction === "bullish" ? "text-emerald-300" : "text-red-300"
              }`}>
                {preview.direction === "bullish" ? "شراء ↑" : "بيع ↓"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">اللوت</span>
              <span className="text-sm font-mono font-bold text-foreground">
                {preview.estimatedLot?.toFixed(2) ?? "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">سعر الدخول</span>
              <span className="text-sm font-mono text-foreground">
                {preview.entry?.toFixed(5) ?? "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">وقف الخسارة</span>
              <span className="text-sm font-mono text-red-300">
                {preview.stopLoss?.toFixed(5) ?? "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">الهدف</span>
              <span className="text-sm font-mono text-emerald-300">
                {preview.takeProfit?.toFixed(5) ?? "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">RR / مخاطرة</span>
              <span className="text-sm font-mono text-foreground">
                {preview.rrRatio?.toFixed(2) ?? "—"} : 1 — ${preview.riskUsd}
              </span>
            </div>
          </div>

          {/* A24: live tick — Bid / Ask / Spread */}
          {result.currentPriceSource === "mt5-live-tick" ? (
            <div className="rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2 space-y-1.5">
              <p className="text-xs font-semibold text-sky-300">السعر الحالي — MT5 Live Tick</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Bid (بيع)</span>
                  <span className="text-sm font-mono text-red-300">
                    {result.currentBid?.toFixed(5) ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Ask (شراء)</span>
                  <span className="text-sm font-mono text-emerald-300">
                    {result.currentAsk?.toFixed(5) ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Spread</span>
                  <span className="text-sm font-mono text-muted-foreground">
                    {result.currentSpreadPoints !== undefined
                      ? `${result.currentSpreadPoints} pts`
                      : result.currentSpread?.toFixed(5) ?? "—"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80">
              ⚠ لم يتم جلب السعر الحالي — نوع الأمر تقديري بناءً على آخر سعر إغلاق
            </div>
          )}

          {/* A25: تقييم أهلية التنفيذ التجريبي */}
          <div className="rounded-md border border-border bg-muted/5 p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground/80">
              تقييم أهلية التنفيذ التجريبي
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {[
                { label: "وضع التنفيذ",      ok: settings.executionMode !== "READ_ONLY", val: settings.executionMode === "READ_ONLY" ? "مغلق" : settings.executionMode === "DEMO_PREVIEW" ? "معاينة" : "مسلّح" },
                { label: "Kill Switch",       ok: !eligibility.killSwitchOn,      val: eligibility.killSwitchOn      ? "مفعّل ✗" : "معطّل ✓" },
                { label: "حساب Demo مؤكد",   ok: eligibility.isDemoConfirmed,    val: eligibility.isDemoConfirmed   ? "نعم ✓" : "غير مؤكد ✗" },
                { label: "الرمز مسموح",      ok: eligibility.symbolAllowed,      val: eligibility.symbolAllowed     ? "مسموح ✓" : "غير مسموح ✗" },
                { label: "نسبة R/R",          ok: eligibility.rrOk,              val: eligibility.rrOk              ? `≥ ${settings.minRewardRiskRatio} ✓` : `< ${settings.minRewardRiskRatio} ✗` },
                { label: "السبريد",           ok: eligibility.spreadOk,          val: eligibility.spreadOk          ? "مقبول ✓" : "مرتفع ✗" },
                { label: "المخاطرة",          ok: eligibility.riskOk,            val: eligibility.riskOk            ? `ضمن $${settings.maxRiskUsdPerTrade} ✓` : `تتجاوز الحد ✗` },
                { label: "عدد الصفقات",      ok: true,                          val: `حد ${settings.maxTradesPerDay}/يوم — A26` },
                { label: "مراكز مفتوحة",     ok: true,                          val: `حد ${settings.maxOpenPositions} — A26` },
              ].map(({ label, ok, val }) => (
                <div key={label} className="flex items-center justify-between gap-1 rounded border border-border bg-muted/5 px-2 py-1">
                  <span className="text-[10px] text-muted-foreground truncate">{label}</span>
                  <span className={`text-[10px] font-medium shrink-0 ${ok ? "text-emerald-300" : "text-red-300"}`}>
                    {val}
                  </span>
                </div>
              ))}
            </div>

            {!eligibility.isDemoConfirmed && (
              <p className="text-[10px] text-amber-300/80">
                ⚠ لن يتم السماح بالتنفيذ إلا على حساب Demo مؤكد — فعّل من صفحة الإعدادات
              </p>
            )}
          </div>

          {/* A26.1: أزرار التنفيذ */}
          <div className="flex flex-wrap items-center gap-3">
            {/* زر مراجعة طلب التنفيذ — enabled فقط عند DEMO_ARMED + جميع الشروط */}
            <button
              type="button"
              disabled={!canOpenReview}
              onClick={() => { setShowModal(true); setUserConfirmed(false); }}
              className={`inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                canOpenReview
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                  : "border-zinc-500/20 bg-zinc-700/20 text-zinc-400/60 cursor-not-allowed"
              }`}
            >
              مراجعة طلب التنفيذ التجريبي
            </button>

            {/* زر التنفيذ — disabled دائماً — نص يتغير بالوضع */}
            <button
              disabled
              aria-disabled="true"
              className={`inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium cursor-not-allowed select-none ${
                settings.executionMode === "READ_ONLY"
                  ? "border-zinc-500/20 bg-zinc-700/20 text-zinc-400/60"
                  : settings.executionMode === "DEMO_PREVIEW"
                    ? "border-amber-500/20 bg-amber-700/20 text-amber-400/60"
                    : "border-emerald-500/20 bg-emerald-700/20 text-emerald-400/60"
              }`}
            >
              {eligibility.buttonText}
            </button>
          </div>

          {/* A26.1: Modal — المراجعة النهائية قبل تنفيذ Demo */}
          {showModal && (() => {
            const execReq = buildExecutionRequestPreview(result, preview, eligibility);
            return (
              <div className="mt-4 rounded-xl border-2 border-emerald-500/30 bg-card shadow-lg">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      المراجعة النهائية قبل تنفيذ Demo
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      A26.2 — إرسال Demo فقط بعد تأكيد يدوي
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-300">
                    ⚠ DEMO ONLY
                  </span>
                </div>

                <div className="p-5 space-y-5">
                  {/* تحذير واضح A26.2 */}
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200/90 space-y-1">
                    <p className="font-semibold">⚠ A26.2 — تنفيذ Demo حقيقي</p>
                    <p>
                      الضغط على الزر سيُرسل أمراً فعلياً إلى حساب MT5 Demo.
                      تأكد أن الحساب تجريبي (Demo) قبل الإرسال.
                      يتطلب تفعيل MT5_DEMO_EXECUTION_ENABLED=1 في خدمة MT5 المحلية.
                    </p>
                  </div>

                  {/* تفاصيل الطلب */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      { label: "المنصة",       val: execReq.platform,                     cls: "text-amber-300" },
                      { label: "نوع الحساب",   val: execReq.accountMode,                  cls: "text-emerald-300" },
                      { label: "الرمز",         val: execReq.symbol,                       cls: "font-mono font-bold" },
                      { label: "نوع الأمر",    val: ORDER_TYPE_LABEL[execReq.orderType as OrderTypePreview] ?? execReq.orderType, cls: "" },
                      { label: "الاتجاه",      val: execReq.direction === "bullish" ? "شراء ↑" : "بيع ↓", cls: execReq.direction === "bullish" ? "text-emerald-300" : "text-red-300" },
                      { label: "سعر الدخول",  val: execReq.entryPrice?.toFixed(5) ?? "—", cls: "font-mono" },
                      { label: "وقف الخسارة", val: execReq.stopLoss?.toFixed(5) ?? "—",   cls: "font-mono text-red-300" },
                      { label: "الهدف",        val: execReq.takeProfit?.toFixed(5) ?? "—", cls: "font-mono text-emerald-300" },
                      { label: "اللوت",         val: execReq.estimatedLot?.toFixed(2) ?? "—", cls: "font-mono font-bold" },
                      { label: "المخاطرة",     val: `$${execReq.riskUsd}`,                cls: "" },
                      { label: "نسبة RR",       val: `${execReq.rrRatio?.toFixed(2) ?? "—"} : 1`, cls: "" },
                      { label: "Bid الحالي",   val: execReq.currentBid?.toFixed(5) ?? "—", cls: "font-mono text-red-300" },
                      { label: "Ask الحالي",   val: execReq.currentAsk?.toFixed(5) ?? "—", cls: "font-mono text-emerald-300" },
                      { label: "السبريد",      val: execReq.spreadPoints !== undefined ? `${execReq.spreadPoints} pts` : "—", cls: "" },
                    ].map(({ label, val, cls }) => (
                      <div key={label} className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-muted-foreground">{label}</span>
                        <span className={`text-sm ${cls || "text-foreground"}`}>{val}</span>
                      </div>
                    ))}
                  </div>

                  {/* حالة الحارس */}
                  <div className="rounded-md border border-border bg-muted/5 p-3 space-y-1">
                    <p className="text-xs font-semibold text-foreground/80 mb-2">حالة الحارس</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { label: "Kill Switch",    ok: !eligibility.killSwitchOn,  val: !eligibility.killSwitchOn  ? "معطّل ✓" : "مفعّل ✗" },
                        { label: "حساب Demo مؤكد", ok: eligibility.isDemoConfirmed, val: eligibility.isDemoConfirmed ? "مؤكد ✓" : "غير مؤكد ✗" },
                        { label: "الرمز مسموح",   ok: eligibility.symbolAllowed,   val: eligibility.symbolAllowed  ? "مسموح ✓" : "ممنوع ✗" },
                        { label: "RR مقبول",       ok: eligibility.rrOk,            val: eligibility.rrOk           ? "مقبول ✓" : "ضعيف ✗" },
                      ].map(({ label, ok, val }) => (
                        <div key={label} className="flex items-center justify-between rounded border border-border px-2 py-1 text-[10px]">
                          <span className="text-muted-foreground">{label}</span>
                          <span className={ok ? "text-emerald-300" : "text-red-300"}>{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Checkbox تأكيد Demo */}
                  <label className="flex items-start gap-3 cursor-pointer rounded-md border border-border bg-muted/5 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={userConfirmed}
                      onChange={(e) => setUserConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-emerald-500"
                    />
                    <span className="text-xs text-foreground/90 leading-relaxed">
                      أؤكد أن هذا تنفيذ تجريبي Demo فقط، وأن الحساب ليس حساباً حقيقياً،
                      وأن هذا الإجراء للمراجعة والاختبار فقط بدون تداول فعلي.
                    </span>
                  </label>

                  {/* A26.2: الأزرار النهائية */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {/* زر الإرسال — مفعّل عند checkbox + DEMO_ARMED + جميع الشروط */}
                    <button
                      type="button"
                      disabled={!canSend}
                      onClick={() => void handleSendToMT5Demo()}
                      className={`inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                        canSend
                          ? "border-emerald-500/50 bg-emerald-600/25 text-emerald-300 hover:bg-emerald-600/40 cursor-pointer"
                          : "border-emerald-500/20 bg-emerald-700/20 text-emerald-400/50 cursor-not-allowed"
                      }`}
                    >
                      {ordering ? "جارٍ الإرسال إلى MT5…" : "إرسال إلى MT5 Demo"}
                    </button>

                    {/* زر الإغلاق */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowModal(false);
                        setUserConfirmed(false);
                        setOrderResult(null);
                        setOrderError(null);
                      }}
                      className="inline-flex items-center justify-center rounded-md border border-border bg-muted/20 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    >
                      إغلاق المراجعة
                    </button>
                  </div>

                  {/* A26.2/A26.3: نتيجة الإرسال — نجاح */}
                  {orderResult && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300 space-y-1">
                      <p className="font-semibold text-sm">✓ تم إرسال أمر Demo إلى MT5</p>
                      {orderResult.ticket != null && (
                        <p>رقم التذكرة: <span className="font-mono font-bold">{orderResult.ticket}</span></p>
                      )}
                      <p>الاستجابة: {orderResult.retcodeText ?? orderResult.message ?? "—"}</p>
                      {orderResult.fillingModeUsed && (
                        <p>وضع التنفيذ: <span className="font-mono">{orderResult.fillingModeUsed}</span></p>
                      )}
                      {orderResult.fillingModesTried && orderResult.fillingModesTried.length > 1 && (
                        <p className="text-emerald-300/60">
                          محاولات Filling: {orderResult.fillingModesTried.join(" → ")}
                        </p>
                      )}
                      <p className="text-muted-foreground">
                        الحساب: {orderResult.accountLogin ?? "—"} — {orderResult.server ?? "—"}
                      </p>
                    </div>
                  )}

                  {/* A26.2: نتيجة الإرسال — خطأ */}
                  {orderError && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300 space-y-1">
                      <p className="font-semibold">✗ فشل إرسال الأمر</p>
                      <p>{orderError}</p>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground/50 border-t border-border pt-2">
                    ⚠ A26.2 — Demo فقط — يُرسَل إلى MT5 عبر /api/mt5-demo/order-send —
                    manualConfirmation: true — accountMode: DEMO_ONLY — لا userId من الواجهة
                  </p>
                </div>
              </div>
            );
          })()}
        </>
      ) : (
        /* Blocked → أسباب المنع */
        <>
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            غير جاهز للتنفيذ التجريبي
          </div>
          <ul className="space-y-1.5">
            {preview.blockedReasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <span className="text-red-400 shrink-0 mt-0.5">✗</span>
                {reason}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* تحذير دائم — لا يختفي سواء كان allowed أم لا */}
      <p className="text-[10px] text-muted-foreground/50 border-t border-border pt-2">
        ⚠ هذا Preview فقط — لا يُرسل أي أمر إلى MT5 — لا order_send — لا order_close
        — لا تنفيذ تداول — لا pending order حقيقي — لا userId من الواجهة
      </p>
    </div>
  );
}

// ── buildExecutionEligibility — A25 ──────────────────────────────────────────
// يقيّم أهلية التنفيذ التجريبي — لا order_send — للمراجعة فقط
function buildExecutionEligibility(
  preview: TradeOrderPreview,
  settings: DemoExecutionSettings,
  opts?: { spreadPoints?: number },
): ExecutionEligibility {
  const reasons: string[] = [];

  if (!preview.allowed) {
    reasons.push("شروط التحليل غير متحققة — راجع ملخص اللجان");
  }
  if (settings.killSwitchEnabled) {
    reasons.push("Kill Switch مفعّل — جميع التنفيذات معطّلة");
  }
  if (settings.executionMode === "READ_ONLY") {
    reasons.push("وضع القراءة فقط — التنفيذ مغلق من الإعدادات");
  }
  if (!settings.isConfirmedDemo) {
    reasons.push("يجب تأكيد أن الحساب Demo من صفحة الإعدادات");
  }

  const allowedArr = settings.allowedExecutionSymbols
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const symbolAllowed =
    allowedArr.length === 0 || allowedArr.includes(preview.symbol.toUpperCase());
  if (!symbolAllowed) {
    reasons.push(`الرمز ${preview.symbol} غير مسموح — أضفه في الأزواج المسموحة بالإعدادات`);
  }

  const rrOk = (preview.rrRatio ?? 0) >= settings.minRewardRiskRatio;
  if (!rrOk) {
    reasons.push(
      `R/R ${preview.rrRatio?.toFixed(2) ?? "—"} أقل من الحد الأدنى ${settings.minRewardRiskRatio}`,
    );
  }

  const spreadOk =
    opts?.spreadPoints === undefined || opts.spreadPoints <= settings.maxSpreadPoints;
  if (opts?.spreadPoints !== undefined && !spreadOk) {
    reasons.push(
      `السبريد ${opts.spreadPoints} نقطة يتجاوز الحد ${settings.maxSpreadPoints} نقطة`,
    );
  }

  const riskOk = preview.riskUsd <= settings.maxRiskUsdPerTrade;
  if (!riskOk) {
    reasons.push(
      `المخاطرة $${preview.riskUsd} تتجاوز الحد $${settings.maxRiskUsdPerTrade} للصفقة الواحدة`,
    );
  }

  return {
    eligible:        reasons.length === 0,
    blockedReasons:  reasons,
    executionMode:   settings.executionMode,
    killSwitchOn:    settings.killSwitchEnabled,
    isDemoConfirmed: settings.isConfirmedDemo,
    symbolAllowed,
    rrOk,
    spreadOk,
    riskOk,
    buttonText: EXECUTION_BUTTON_TEXT[settings.executionMode],
  };
}

// ── buildExecutionRequestPreview — A26.1 ──────────────────────────────────────
// يبني عقد طلب التنفيذ التجريبي — Preview فقط — لا order_send — لا تنفيذ
// يُستدعى فقط عندما: allowed=true, eligible=true, DEMO_ARMED, !killSwitch, isConfirmedDemo
function buildExecutionRequestPreview(
  result: AnalysisResult,
  preview: TradeOrderPreview,
  _eligibility: ExecutionEligibility,
  opts?: { decisionId?: string },
): ExecutionRequestPreview {
  return {
    platform:                   "MT5",
    accountMode:                "DEMO_ONLY",
    symbol:                     preview.symbol,
    orderType:                  preview.orderType,
    direction:                  preview.direction,
    entryPrice:                 preview.entry,
    stopLoss:                   preview.stopLoss,
    takeProfit:                 preview.takeProfit,
    estimatedLot:               preview.estimatedLot,
    riskUsd:                    preview.riskUsd,
    rrRatio:                    preview.rrRatio,
    currentBid:                 result.currentBid,
    currentAsk:                 result.currentAsk,
    spreadPoints:               result.currentSpreadPoints,
    decisionId:                 opts?.decisionId,
    generatedAt:                Date.now(),
    requiresManualConfirmation: true  as const,
    executionEnabled:           false as const,
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

    // ── Step 2: تشغيل التحليل + جلب live tick بالتوازي — A24 ───────────────
    setSyncStatus("جاري التحليل…");
    try {
      const analysisBody = {
        symbol: symbol.trim().toUpperCase(),
        timeframeMode,
        ...(timeframeMode === "manual" ? { timeframe: manualTF } : {}),
        candidateTimeframes: Array.from(candidateTFs),
        candleCount,
        stopPoints,
        ...(useRR ? { rrRatio } : { targetPoints }),
        riskUsd,
      };

      // التحليل وجلب السعر الحالي يعملان بالتوازي — tick best-effort
      const [analysisSettled, tickSettled] = await Promise.allSettled([
        fetch("/api/lab/analyze-preview", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(analysisBody),
        }).then((r) => r.json() as Promise<AnalysisResult>),
        fetch("/api/mt5-readonly/snapshot", { cache: "no-store" })
          .then((r) => r.json() as Promise<{ ok: boolean; snapshot?: { ticks?: TickData[] } }>)
          .catch(() => null),
      ]);

      if (analysisSettled.status === "rejected") {
        throw new Error(String(analysisSettled.reason));
      }
      const json: AnalysisResult = analysisSettled.value;

      // ── A24: دمج live tick إذا كان متاحاً ────────────────────────────────
      // لا نمنع setResult إذا فشل tick — best-effort فقط
      if (
        tickSettled.status === "fulfilled" &&
        tickSettled.value?.ok &&
        Array.isArray(tickSettled.value.snapshot?.ticks)
      ) {
        const tick = tickSettled.value.snapshot!.ticks!.find(
          (t) => t.symbol === symbol.trim().toUpperCase(),
        );
        if (tick && typeof tick.bid === "number" && typeof tick.ask === "number") {
          json.currentBid           = tick.bid;
          json.currentAsk           = tick.ask;
          json.currentSpread        = typeof tick.spread       === "number" ? tick.spread       : undefined;
          json.currentSpreadPoints  = typeof tick.spread_points === "number" ? tick.spread_points : undefined;
          json.currentPriceSource   = "mt5-live-tick";
        }
      }

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

                {/* ── A22: ملخص اللجان قبل الحفظ ───────────────────────────── */}
                <CommitteeSummaryPreview result={result} />

                {/* ── A23: مراجعة أمر التداول Demo Preview ─────────────────── */}
                <TradePreviewPanel result={result} />

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
