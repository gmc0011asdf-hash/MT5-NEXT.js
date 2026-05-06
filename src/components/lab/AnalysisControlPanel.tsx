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
import {
  STRUCTURE_POINT_EXPLANATIONS,
  STRUCTURE_POINT_LABEL,
  TREND_STATE_EXPLANATIONS,
  BOS_EXPLANATION,
  CHOCH_EXPLANATION,
  CANDLE_PATTERN_EXPLANATIONS,
  ZONE_TYPE_EXPLANATIONS,
  PREMIUM_DISCOUNT_EXPLANATIONS,
  GENERAL_DISCLAIMER,
} from "@/lib/trading/shared/trading-term-explanations";

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

// ── B1: Market Structure types (mirror market-structure.ts) ─────────────────
type MarketSwing = {
  index:    number;
  time:     number;
  price:    number;
  type:     "HIGH" | "LOW";
  strength: number;
};

type StructurePoint = {
  type:       "HH" | "HL" | "LH" | "LL";
  price:      number;
  time:       number;
  swingIndex: number;
};

type MarketStructureAnalysis = {
  trendState:      "BULLISH" | "BEARISH" | "RANGE" | "TRANSITION";
  bias:            "BUY" | "SELL" | "NEUTRAL";
  swings:          MarketSwing[];
  structurePoints: StructurePoint[];
  lastSwingHigh:   MarketSwing | null;
  lastSwingLow:    MarketSwing | null;
  bosDirection:    "UP" | "DOWN" | null;
  chochDirection:  "UP" | "DOWN" | null;
  rangeDetected:   boolean;
  rangeHigh:       number | null;
  rangeLow:        number | null;
  confidence:      number;
  reasons:         string[];
  warnings:        string[];
};

// ── B2: Candlestick types (mirror candlestick-analysis.ts) ──────────────────
type CandlePatternType =
  | "BULLISH_ENGULFING" | "BEARISH_ENGULFING"
  | "PIN_BAR_BULLISH"   | "PIN_BAR_BEARISH"
  | "DOJI" | "STRONG_BULLISH_CLOSE" | "STRONG_BEARISH_CLOSE"
  | "INSIDE_BAR"
  | "LIQUIDITY_SWEEP_HIGH" | "LIQUIDITY_SWEEP_LOW"
  | "FAKE_BREAKOUT_UP"     | "FAKE_BREAKOUT_DOWN";

type CandlePattern = {
  type:        CandlePatternType;
  direction:   "BUY" | "SELL" | "NEUTRAL";
  strength:    number;
  candleIndex: number;
  time:        number;
  price:       number;
  reason:      string;
};

type LatestCandleQuality = {
  bodySize:         number;
  upperWick:        number;
  lowerWick:        number;
  candleRange:      number;
  bodyToRangeRatio: number;
  wickToBodyRatio:  number;
  isBullish:        boolean;
};

type WickRejection = {
  detected:  boolean;
  direction: "BUY" | "SELL" | null;
  ratio:     number;
  reason:    string;
};

type CandlestickAnalysis = {
  bias:                   "BUY" | "SELL" | "NEUTRAL";
  quality:                "STRONG" | "NORMAL" | "WEAK" | "SUSPICIOUS";
  patterns:               CandlePattern[];
  latestCandleQuality:    LatestCandleQuality | null;
  wickRejection:          WickRejection;
  fakeoutDetected:        boolean;
  liquiditySweepDetected: boolean;
  confidence:             number;
  reasons:                string[];
  warnings:               string[];
};

// ── B3: Zones types (mirror zones-analysis.ts) ───────────────────────────────
type PriceZoneType =
  | "SUPPLY" | "DEMAND"
  | "BULLISH_ORDER_BLOCK" | "BEARISH_ORDER_BLOCK"
  | "BULLISH_FVG" | "BEARISH_FVG"
  | "SUPPORT" | "RESISTANCE";

type PriceZone = {
  id:                  string;
  type:                PriceZoneType;
  direction:           "BUY" | "SELL" | "NEUTRAL";
  low:                 number;
  high:                number;
  midpoint:            number;
  createdAt:           number;
  candleIndex:         number;
  strength:            number;
  touched:             boolean;
  mitigated:           boolean;
  distanceFromCurrent: number;
  reason:              string;
};

type ZonesAnalysis = {
  bias:              "BUY" | "SELL" | "NEUTRAL";
  currentPrice:      number;
  nearestZone:       PriceZone | null;
  nearestDemand:     PriceZone | null;
  nearestSupply:     PriceZone | null;
  activeZones:       PriceZone[];
  fvgZones:          PriceZone[];
  orderBlocks:       PriceZone[];
  inPremiumDiscount: "PREMIUM" | "DISCOUNT" | "MID" | "UNKNOWN";
  confluenceScore:   number;
  confidence:        number;
  reasons:           string[];
  warnings:          string[];
};

// ── B4: Fibonacci types (mirror fibonacci-analysis.ts) ───────────────────────
type FibonacciLevel = {
  level:                  number;
  price:                  number;
  type:                   "RETRACEMENT" | "EXTENSION";
  label:                  string;
  distanceFromCurrentPct: number;
  nearCurrent:            boolean;
  reason:                 string;
};

type FibonacciSwing = {
  direction:  "BULLISH" | "BEARISH" | "UNKNOWN";
  swingLow:   number;
  swingHigh:  number;
  startTime:  number;
  endTime:    number;
  range:      number;
  valid:      boolean;
  reason:     string;
};

type GoldenZone = {
  low:                    number;
  high:                   number;
  active:                 boolean;
  direction:              "BUY" | "SELL" | "NEUTRAL";
  distanceFromCurrentPct: number;
};

// ── B6.2: News Protection Committee types ────────────────────────────────────
type NewsMatchType = "DIRECT" | "USER_OVERRIDE" | "MACRO_USD" | "MACRO_RISK" | "FOREX_GENERAL";
type NewsItemVerdict = "BLOCK" | "WARN" | "WATCH" | "PASS";

type MatchedNewsEvent = {
  headline:          string;
  source?:           string;
  category:          string;
  publishedAt:       number;
  finalImpact:       string;
  finalDecision:     string;
  affectedSymbols:   string[];
  relationshipType?: string;
  userNote?:         string;
  ageMinutes:        number;
  matchType:         NewsMatchType;
  itemVerdict:       NewsItemVerdict;
};

type NewsCommitteeResult = {
  committee:         "NEWS_PROTECTION_B6_2";
  verdict:           "PASS" | "WATCH" | "WARN" | "BLOCK";
  score:             number;
  symbol:            string;
  matchedNewsCount:  number;
  highImpactCount:   number;
  blockingNewsCount: number;
  reasons:           string[];
  warnings:          string[];
  blockers:          string[];
  matchedEvents:     MatchedNewsEvent[];
};

// ── B5: Multi-Timeframe Consensus types (mirror multi-timeframe-consensus.ts) ─
type TFBias = "bullish" | "bearish" | "neutral" | "unknown";

type TimeframeSummary = {
  timeframe:   string;
  trendBias:   TFBias;
  available:   boolean;
  candleCount: number | undefined;
  isEntry:     boolean;
};

type MultiTimeframeConsensus = {
  timeframeSummaries:    TimeframeSummary[];
  dominantTimeframe:     string | null;
  higherTimeframeBias:   "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  entryTimeframeBias:    TFBias;
  alignmentScore:        number;
  verdict:               "PASS" | "WARN" | "BLOCK";
  bias:                  "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  reasons:               string[];
  warnings:              string[];
  blockers:              string[];
};

type FibonacciAnalysis = {
  bias:                          "BUY" | "SELL" | "NEUTRAL";
  swing:                         FibonacciSwing;
  currentPrice:                  number;
  retracementLevels:             FibonacciLevel[];
  extensionLevels:               FibonacciLevel[];
  nearestLevel:                  FibonacciLevel | null;
  nearestRetracementLevels:      FibonacciLevel[];
  goldenZone:                    GoldenZone;
  inGoldenZone:                  boolean;
  confluenceWithZones:           boolean;
  confluenceWithMarketStructure: boolean;
  confluenceScore:               number;
  confidence:                    number;
  reasons:                       string[];
  warnings:                      string[];
};

// ── B3.2: Market State types (mirror market-state-analysis.ts, no closedCandles) ─
type SpreadStatus = "NORMAL" | "HIGH" | "EXTREME" | "UNKNOWN";
type MarketSessionStatus = "OPEN" | "CLOSED" | "LOW_LIQUIDITY" | "UNKNOWN";
type MarketStateDecision = "ALLOW_ANALYSIS" | "ANALYSIS_ONLY" | "BLOCK_EXECUTION" | "BLOCK_ALL";
type FakeCandleRisk = "LOW" | "MEDIUM" | "HIGH";

type SuspiciousCandle = {
  index:    number;
  time:     number;
  reason:   string;
  severity: "WARN" | "BLOCK";
  metrics:  { range: number; body: number; upperWick: number; lowerWick: number };
};

type MarketStateAnalysis = {
  marketOpen:              boolean;
  symbolTradable:          boolean;
  dataFresh:               boolean;
  usingClosedCandleOnly:   boolean;
  latestCandleClosed:      boolean;
  latestCandleTime:        number | null;
  latestClosedCandleTime:  number | null;
  tickFresh:               boolean;
  tickAgeMs:               number | null;
  candleAgeMs:             number | null;
  spreadPoints:            number | null;
  spreadStatus:            SpreadStatus;
  brokerClockSkewDetected: boolean;
  brokerClockSkewMs:       number;
  suspiciousCandlesCount:  number;
  suspiciousCandles:       SuspiciousCandle[];
  fakeCandleRisk:          FakeCandleRisk;
  marketSessionStatus:     MarketSessionStatus;
  decision:                MarketStateDecision;
  confidence:              number;
  reasons:                 string[];
  warnings:                string[];
  blockers:                string[];
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
  marketStateAnalysis?: MarketStateAnalysis;        // B3.2
  marketStructure?:     MarketStructureAnalysis;   // B1
  candlestickAnalysis?: CandlestickAnalysis;        // B2
  zonesAnalysis?:       ZonesAnalysis;              // B3
  fibonacciAnalysis?:        FibonacciAnalysis;          // B4
  multiTimeframeConsensus?:  MultiTimeframeConsensus;   // B5
  newsProtectionCommittee?:  NewsCommitteeResult;        // B6.2
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
  if (status === "opportunity") return "إشارة تقنية رُصدت";
  if (status === "stale_data") return "بيانات قديمة ⚠";
  if (status === "wait") return "انتظار — لا فرصة واضحة";
  if (status === "rejected") return "مرفوض";
  if (status === "insufficient_data") return "بيانات غير كافية";
  return status;
}

// ── B2.2: AnalysisDisplayStatus — حالة التحليل المنفصلة عن حالة التنفيذ ───────
type AnalysisDisplayStatus = {
  label:       string;
  tone:        "success" | "warning" | "danger" | "neutral";
  description: string;
};

function deriveAnalysisDisplayStatus(
  result:  AnalysisResult,
  summary: DecisionSummary | null,
  guard:   PriceActionExecutionGuard | null,
): AnalysisDisplayStatus {
  // حارس التنفيذ يُقدَّم على كل شيء
  if (guard && !guard.allowed) {
    const firstBlocker = guard.blockers[0] ?? "حارس جودة التنفيذ رفض الصفقة";
    return {
      label:       "إشارة متضاربة — ممنوعة من التنفيذ",
      tone:        "danger",
      description: firstBlocker,
    };
  }

  if (!summary) {
    if (result.status === "opportunity") {
      return { label: "إشارة تقنية — لم يُحسب الحارس", tone: "warning", description: "جارٍ التحقق من جودة الإشارة" };
    }
    if (result.status === "wait") {
      return { label: "لا توجد فرصة واضحة", tone: "neutral", description: "انتظر إشارة أوضح" };
    }
    return { label: "بيانات غير كافية", tone: "neutral", description: "تحقق من مزامنة الشموع" };
  }

  const { grade, probability, finalDecision, committees } = summary;
  const warnCount = committees.filter((c) => c.verdict === "WARN").length;

  if (finalDecision === "HOLD" || finalDecision === "BLOCK") {
    return {
      label:       "لا توجد فرصة تنفيذ حالياً",
      tone:        "neutral",
      description: finalDecision === "BLOCK"
        ? "أُغلقت الفرصة بسبب لجنة حرجة BLOCK"
        : "انتظر إشارة أقوى — القرار: انتظار",
    };
  }

  if ((grade === "A+" || grade === "A") && probability >= 68 && warnCount <= 1) {
    return {
      label:       "إشارة قوية قابلة للتنفيذ التجريبي",
      tone:        "success",
      description: `درجة ${grade} | احتمال ${probability}% | ${warnCount} تحذير`,
    };
  }

  if (grade === "B" && probability >= 60) {
    return {
      label:       "إشارة قابلة للمراجعة",
      tone:        "warning",
      description: `درجة ${grade} | احتمال ${probability}% | ${warnCount} تحذير — راجع التحذيرات قبل التنفيذ`,
    };
  }

  if (guard?.status === "WARN") {
    return {
      label:       "إشارة مع تحذيرات — مراجعة مطلوبة",
      tone:        "warning",
      description: `درجة ${grade} | احتمال ${probability}% | ${guard.warnings.length} تحذيرات تنفيذ`,
    };
  }

  return {
    label:       "إشارة ضعيفة أو متضاربة",
    tone:        "danger",
    description: `درجة ${grade} | احتمال ${probability}% — لا يستوفي شروط التنفيذ التجريبي`,
  };
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

// أوزان اللجان — مجموعها 1.0 — B4: أضيفت لجنة توافق Fibonacci
const COMMITTEE_WEIGHTS: Record<string, number> = {
  "market-state-data-quality":  0.09,  // B3.2 — critical
  "market-structure":           0.15,  // B1
  "candlestick-price-action":   0.10,  // B2
  "zones-confluence":           0.10,  // B3
  "fibonacci-confluence":       0.08,  // B4
  "multi-timeframe-consensus":  0.09,  // B5
  "news-protection":            0.09,  // B6.2 — news sentinel
  "entry-quality":              0.10,
  "trend":                      0.07,
  "momentum":                   0.06,
  "freshness":                  0.04,
  "risk":                       0.02,
  "protection":                 0.01,
}; // مجموع: 0.09+0.15+0.10+0.10+0.08+0.09+0.09+0.10+0.07+0.06+0.04+0.02+0.01 = 1.00

// اللجان الحرجة التي تستطيع إصدار BLOCK فعّال على القرار
const CRITICAL_COMMITTEES = new Set([
  "freshness",
  "entry-quality",
  "market-state-data-quality",  // B3.2 — critical
]);

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

// ── 7. لجنة هيكل السوق — B1 ──────────────────────────────────────────────────
function buildMarketStructureCommittee(r: AnalysisResult): CommitteeResult {
  const ms = r.marketStructure;

  if (!ms || ms.confidence === 0) {
    return {
      committeeId: "market-structure", committeeName: "لجنة هيكل السوق",
      verdict: "WARN", score: 25,
      summary: "هيكل السوق غير متوفر — بيانات ناقصة",
      reasons: ["لم يُحسب هيكل السوق — تحقق من مزامنة الشموع"],
    };
  }

  const reasons: string[] = [...ms.reasons.slice(0, 4)];
  let score = 35;
  let verdict: CommitteeResult["verdict"] = "WARN";

  // ── تطابق الاتجاه ──────────────────────────────────────────────────────────
  const trendMatchesBuy  = ms.trendState === "BULLISH" && r.direction === "bullish";
  const trendMatchesSell = ms.trendState === "BEARISH" && r.direction === "bearish";
  const trendConflict    =
    (ms.trendState === "BULLISH" && r.direction === "bearish") ||
    (ms.trendState === "BEARISH" && r.direction === "bullish");

  if (trendMatchesBuy || trendMatchesSell) {
    score += 25;
    reasons.push(`هيكل السوق يدعم القرار (${ms.trendState}) ✓`);
  } else if (trendConflict) {
    score -= 25;
    verdict = "BLOCK";
    reasons.push(`⚠ تعارض: الهيكل ${ms.trendState} والقرار ${r.direction} — اتجاهان عكسيان`);
  } else if (ms.trendState === "RANGE") {
    score -= 10; verdict = "WARN";
    reasons.push("السوق في نطاق — خطر في كلا الاتجاهين");
  } else if (ms.trendState === "TRANSITION") {
    score -= 5; verdict = "WARN";
    reasons.push("السوق في مرحلة تحوّل — ترقب اتجاه الكسر");
  }

  // ── BOS ───────────────────────────────────────────────────────────────────
  if (ms.bosDirection === "UP"   && r.direction === "bullish") { score += 12; reasons.push("BOS UP يؤكد الصعود ✓"); }
  if (ms.bosDirection === "DOWN" && r.direction === "bearish") { score += 12; reasons.push("BOS DOWN يؤكد الهبوط ✓"); }
  if (ms.bosDirection === "UP"   && r.direction === "bearish") { score -= 8;  reasons.push("BOS UP عكس القرار"); }
  if (ms.bosDirection === "DOWN" && r.direction === "bullish") { score -= 8;  reasons.push("BOS DOWN عكس القرار"); }

  // ── CHoCH ─────────────────────────────────────────────────────────────────
  if (ms.chochDirection === "UP"   && r.direction === "bullish") { score += 10; reasons.push("CHoCH UP يدعم الشراء ✓"); }
  if (ms.chochDirection === "DOWN" && r.direction === "bearish") { score += 10; reasons.push("CHoCH DOWN يدعم البيع ✓"); }
  if (ms.chochDirection === "UP"   && r.direction === "bearish") { score -= 10; verdict = "WARN"; reasons.push("CHoCH UP ضد القرار — تحوّل صاعد محتمل"); }
  if (ms.chochDirection === "DOWN" && r.direction === "bullish") { score -= 10; verdict = "WARN"; reasons.push("CHoCH DOWN ضد القرار — تحوّل هابط محتمل"); }

  // ── نطاق ──────────────────────────────────────────────────────────────────
  if (ms.rangeDetected) { score -= 12; if (verdict !== "BLOCK") verdict = "WARN"; }

  // ── معامل الثقة ───────────────────────────────────────────────────────────
  score = Math.round(score * (0.5 + ms.confidence / 200));

  score = Math.max(5, Math.min(92, score));
  if (verdict !== "BLOCK") verdict = score >= 60 ? "PASS" : "WARN";

  return {
    committeeId: "market-structure", committeeName: "لجنة هيكل السوق",
    verdict, score,
    summary: `${ms.trendState} | bias: ${ms.bias} | ثقة: ${ms.confidence}%`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 8. لجنة الشموع والسيولة — B2 ─────────────────────────────────────────────
function buildCandlestickCommittee(r: AnalysisResult): CommitteeResult {
  const cs = r.candlestickAnalysis;

  if (!cs || cs.confidence === 0) {
    return {
      committeeId: "candlestick-price-action", committeeName: "لجنة الشموع والسيولة",
      verdict: "WARN", score: 25,
      summary: "تحليل الشموع غير متوفر",
      reasons: ["لم يُحسب تحليل Candlestick — تحقق من مزامنة الشموع"],
    };
  }

  const reasons: string[] = [];
  let score = 35;
  let verdict: CommitteeResult["verdict"] = "WARN";

  // ── انحياز الشموع مع القرار ────────────────────────────────────────────────
  const csMatchesBuy  = cs.bias === "BUY"  && r.direction === "bullish";
  const csMatchesSell = cs.bias === "SELL" && r.direction === "bearish";
  const csConflict    =
    (cs.bias === "BUY"  && r.direction === "bearish") ||
    (cs.bias === "SELL" && r.direction === "bullish");

  if (csMatchesBuy || csMatchesSell) {
    score += 20;
    reasons.push(`انحياز الشموع (${cs.bias}) يتوافق مع القرار ✓`);
  } else if (csConflict) {
    score -= 15;
    reasons.push(`⚠ انحياز الشموع (${cs.bias}) عكس القرار (${r.direction})`);
  } else {
    reasons.push("انحياز الشموع محايد");
  }

  // ── أنماط قوية تدعم أو تعارض ──────────────────────────────────────────────
  const strongBuyPatterns  = cs.patterns.filter((p) => p.direction === "BUY"  && p.strength >= 75);
  const strongSellPatterns = cs.patterns.filter((p) => p.direction === "SELL" && p.strength >= 75);

  if ((r.direction === "bullish" && strongBuyPatterns.length > 0)) {
    score += 12;
    reasons.push(`${strongBuyPatterns.length} نمط شرائي قوي`);
  }
  if ((r.direction === "bearish" && strongSellPatterns.length > 0)) {
    score += 12;
    reasons.push(`${strongSellPatterns.length} نمط بيعي قوي`);
  }
  // Strong reversal AGAINST direction
  const reversal = r.direction === "bullish" ? strongSellPatterns : strongBuyPatterns;
  if (reversal.length > 0) {
    score -= 18;
    reasons.push(`⚠ ${reversal.length} نمط انعكاسي قوي ضد القرار`);
  }

  // ── Liquidity Sweep يدعم أو يعارض ─────────────────────────────────────────
  if (cs.liquiditySweepDetected) {
    const sweepBuy  = cs.patterns.some((p) => p.type === "LIQUIDITY_SWEEP_LOW");
    const sweepSell = cs.patterns.some((p) => p.type === "LIQUIDITY_SWEEP_HIGH");
    if ((sweepBuy && r.direction === "bullish") || (sweepSell && r.direction === "bearish")) {
      score += 12;
      reasons.push("سحب سيولة يدعم القرار ✓");
    } else if ((sweepSell && r.direction === "bullish") || (sweepBuy && r.direction === "bearish")) {
      score -= 12;
      reasons.push("⚠ سحب سيولة ضد اتجاه القرار");
    }
  }

  // ── Fakeout ────────────────────────────────────────────────────────────────
  if (cs.fakeoutDetected) {
    const fakeUp   = cs.patterns.some((p) => p.type === "FAKE_BREAKOUT_UP");
    const fakeDown = cs.patterns.some((p) => p.type === "FAKE_BREAKOUT_DOWN");
    if ((fakeUp && r.direction === "bearish") || (fakeDown && r.direction === "bullish")) {
      score += 10;
      reasons.push("Fakeout يدعم القرار (كسر وهمي عكس اتجاه الانعكاس) ✓");
    } else if ((fakeUp && r.direction === "bullish") || (fakeDown && r.direction === "bearish")) {
      score -= 15;
      reasons.push("⚠ Fakeout ضد القرار — خطر انعكاس");
    }
  }

  // ── BLOCK: Fakeout + Strong reversal معاً ─────────────────────────────────
  const blockCondition =
    cs.fakeoutDetected &&
    reversal.length > 0 &&
    csConflict;

  if (blockCondition) {
    verdict = "BLOCK";
    reasons.push("حظر: Fakeout + نمط انعكاسي قوي ضد القرار");
  }

  // ── الجودة ────────────────────────────────────────────────────────────────
  if (cs.quality === "STRONG") { score += 8; }
  else if (cs.quality === "WEAK") { score -= 5; }
  else if (cs.quality === "SUSPICIOUS") { score -= 8; verdict = verdict === "BLOCK" ? "BLOCK" : "WARN"; }

  // ── Doji / Inside Bar → WARN ───────────────────────────────────────────────
  const hasNeutral = cs.patterns.some((p) => p.type === "DOJI" || p.type === "INSIDE_BAR");
  if (hasNeutral && verdict !== "BLOCK") {
    verdict = "WARN";
    score -= 5;
    reasons.push("Doji أو Inside Bar — تردد في السوق");
  }

  score = Math.max(5, Math.min(90, Math.round(score * (0.5 + cs.confidence / 200))));
  if (verdict !== "BLOCK") verdict = score >= 60 ? "PASS" : "WARN";

  return {
    committeeId: "candlestick-price-action", committeeName: "لجنة الشموع والسيولة",
    verdict, score,
    summary: `${cs.bias} | ${cs.quality} | ثقة: ${cs.confidence}% | أنماط: ${cs.patterns.length}`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 10. لجنة حالة السوق وجودة البيانات — B3.2 ────────────────────────────────
function buildMarketStateCommittee(r: AnalysisResult): CommitteeResult {
  const ms = r.marketStateAnalysis;

  if (!ms) {
    return {
      committeeId: "market-state-data-quality", committeeName: "لجنة حالة السوق وجودة البيانات",
      verdict: "WARN", score: 30,
      summary: "حالة السوق غير متاحة",
      reasons: ["لم يُحسب تحليل حالة السوق — تحقق من مزامنة الشموع"],
    };
  }

  const reasons: string[] = [...ms.reasons.slice(0, 3)];
  let score   = 45;
  let verdict: CommitteeResult["verdict"] = "WARN";

  // ── BLOCK conditions ───────────────────────────────────────────────────────
  if (ms.decision === "BLOCK_ALL") {
    verdict = "BLOCK"; score = 5;
    reasons.push("بيانات غير كافية أو تالفة");
  } else if (ms.decision === "BLOCK_EXECUTION") {
    verdict = "BLOCK"; score = 18;
    if (!ms.marketOpen)          reasons.push("السوق مغلق أو جلسة منخفضة السيولة");
    if (!ms.dataFresh)           reasons.push("بيانات قديمة — لا يُسمح بالتنفيذ");
    if (ms.fakeCandleRisk === "HIGH") reasons.push("خطر شموع مشبوهة مرتفع");
    if (ms.spreadStatus === "EXTREME") reasons.push("سبريد مفرط");
  }

  // ── WARN conditions ────────────────────────────────────────────────────────
  else if (ms.decision === "ANALYSIS_ONLY") {
    verdict = "WARN"; score = 42;
    if (ms.usingClosedCandleOnly) reasons.push("تم تجاهل الشمعة المفتوحة — closed candle فقط ✓");
    if (ms.fakeCandleRisk === "MEDIUM") reasons.push("شموع مشبوهة محتملة");
    if (ms.marketSessionStatus === "LOW_LIQUIDITY") reasons.push("سيولة منخفضة");
  }

  // ── PASS conditions ───────────────────────────────────────────────────────
  else {
    verdict = "PASS"; score = 78;
    if (ms.dataFresh)            reasons.push("بيانات حديثة ✓");
    if (ms.marketOpen)           reasons.push("السوق مفتوح ✓");
    if (ms.fakeCandleRisk === "LOW") reasons.push("لا شموع مشبوهة ✓");
    if (ms.latestCandleClosed)   reasons.push("آخر شمعة مغلقة ✓");
    else if (ms.usingClosedCandleOnly) reasons.push("الشمعة الحالية قيد التكوين — التحليل يستخدم آخر شمعة مغلقة ✓");
    if (ms.spreadStatus === "NORMAL") reasons.push(`سبريد طبيعي (${ms.spreadPoints} نقطة) ✓`);
  }

  // ── Adjustments ───────────────────────────────────────────────────────────
  if (ms.spreadStatus === "HIGH")    { score -= 8;  if (verdict === "PASS") verdict = "WARN"; }
  if (ms.brokerClockSkewDetected)    { score -= 5; }
  if (ms.suspiciousCandlesCount > 0) { score -= ms.suspiciousCandlesCount * 4; }
  if (!ms.latestCandleClosed)        { score -= 5; }

  score = Math.max(5, Math.min(92, Math.round(score * (0.5 + ms.confidence / 200))));

  const spreadPt = ms.spreadPoints != null ? `${ms.spreadPoints}pt` : "—";
  return {
    committeeId: "market-state-data-quality", committeeName: "لجنة حالة السوق وجودة البيانات",
    verdict, score,
    summary: `${ms.marketSessionStatus} | spread: ${spreadPt} | risk: ${ms.fakeCandleRisk} | ${ms.decision}`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 9. لجنة المناطق والتوازن السعري — B3 ──────────────────────────────────────
function buildZonesCommittee(r: AnalysisResult): CommitteeResult {
  const za = r.zonesAnalysis;

  if (!za || za.confidence === 0) {
    return {
      committeeId: "zones-confluence", committeeName: "لجنة المناطق والتوازن السعري",
      verdict: "WARN", score: 25,
      summary: "مناطق العرض والطلب غير متوفرة",
      reasons: ["لم يُحسب تحليل المناطق — تحقق من مزامنة الشموع"],
    };
  }

  const reasons: string[] = [];
  let score   = 35;
  let verdict: CommitteeResult["verdict"] = "WARN";

  const dir    = r.direction;  // "bullish" | "bearish" | undefined
  const isBuy  = dir === "bullish";
  const isSell = dir === "bearish";

  // ── Premium/Discount alignment ────────────────────────────────────────────
  const pd = za.inPremiumDiscount;
  if (isBuy  && pd === "DISCOUNT") { score += 18; reasons.push("الشراء في منطقة Discount ✓"); }
  if (isSell && pd === "PREMIUM")  { score += 18; reasons.push("البيع في منطقة Premium ✓"); }
  if (isBuy  && pd === "PREMIUM")  { score -= 15; reasons.push("⚠ الشراء في منطقة Premium — سعر مرتفع"); }
  if (isSell && pd === "DISCOUNT") { score -= 15; reasons.push("⚠ البيع في منطقة Discount — سعر منخفض"); }
  if (pd === "MID") {
    score -= 8;
    reasons.push("الدخول من منتصف النطاق — لا أفضلية واضحة");
  }

  // ── Near supporting zone ──────────────────────────────────────────────────
  const NEAR_PCT = 0.5;
  const nearBuyZone  = za.activeZones.find((z) => z.direction === "BUY"  && z.distanceFromCurrent <= NEAR_PCT && !z.mitigated);
  const nearSellZone = za.activeZones.find((z) => z.direction === "SELL" && z.distanceFromCurrent <= NEAR_PCT && !z.mitigated);

  if (isBuy && nearBuyZone) {
    score += 15;
    reasons.push(`قريب من ${nearBuyZone.type} (${nearBuyZone.distanceFromCurrent.toFixed(2)}%) — يدعم الشراء ✓`);
  }
  if (isSell && nearSellZone) {
    score += 15;
    reasons.push(`قريب من ${nearSellZone.type} (${nearSellZone.distanceFromCurrent.toFixed(2)}%) — يدعم البيع ✓`);
  }

  // ── BLOCK: price inside opposing strong zone ───────────────────────────────
  const INSIDE_PCT = 0.15;
  const insideSell = za.activeZones.find(
    (z) => z.direction === "SELL" && z.distanceFromCurrent <= INSIDE_PCT && z.strength >= 65,
  );
  const insideBuy = za.activeZones.find(
    (z) => z.direction === "BUY" && z.distanceFromCurrent <= INSIDE_PCT && z.strength >= 65,
  );

  if (isBuy && insideSell) {
    verdict = "BLOCK"; score -= 25;
    reasons.push(`⛔ الشراء داخل منطقة ${insideSell.type} قوية (strength: ${insideSell.strength})`);
  }
  if (isSell && insideBuy) {
    verdict = "BLOCK"; score -= 25;
    reasons.push(`⛔ البيع داخل منطقة ${insideBuy.type} قوية (strength: ${insideBuy.strength})`);
  }

  // ── FVG / Order Block confluence ──────────────────────────────────────────
  const nearFVG = za.fvgZones.find((z) => {
    const aligned = (isBuy && z.direction === "BUY") || (isSell && z.direction === "SELL");
    return aligned && z.distanceFromCurrent <= NEAR_PCT;
  });
  if (nearFVG) { score += 8; reasons.push(`FVG قريبة تدعم القرار ✓`); }

  const nearOB = za.orderBlocks.find((z) => {
    const aligned = (isBuy && z.direction === "BUY") || (isSell && z.direction === "SELL");
    return aligned && z.distanceFromCurrent <= NEAR_PCT;
  });
  if (nearOB) { score += 8; reasons.push(`Order Block قريب يدعم القرار ✓`); }

  // ── Confluence score factor ───────────────────────────────────────────────
  score = Math.round(score * (0.5 + za.confidence / 200));
  score = Math.max(5, Math.min(92, score));
  if (verdict !== "BLOCK") verdict = score >= 60 ? "PASS" : "WARN";

  if (reasons.length === 0) reasons.push(`توازن سعري: ${pd}`);

  return {
    committeeId: "zones-confluence", committeeName: "لجنة المناطق والتوازن السعري",
    verdict, score,
    summary: `${pd} | ${za.bias} | FVG: ${za.fvgZones.length} | OB: ${za.orderBlocks.length} | ثقة: ${za.confidence}%`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 11. لجنة توافق Fibonacci — B4 ────────────────────────────────────────────
function buildFibonacciCommittee(r: AnalysisResult): CommitteeResult {
  const fa = r.fibonacciAnalysis;

  if (!fa || fa.confidence === 0) {
    return {
      committeeId: "fibonacci-confluence", committeeName: "لجنة توافق Fibonacci",
      verdict: "WARN", score: 30,
      summary: "Fibonacci غير متاح",
      reasons: ["لم يُحسب تحليل Fibonacci — تحقق من مزامنة الشموع"],
    };
  }

  const reasons: string[] = [];
  let score   = 35;
  let verdict: CommitteeResult["verdict"] = "WARN";

  const dir    = r.direction;  // "bullish" | "bearish" | undefined
  const isBuy  = dir === "bullish";
  const isSell = dir === "bearish";

  // ── Swing UNKNOWN → cap at WARN, max score 45 ────────────────────────────
  const swingUnknown = fa.swing.direction === "UNKNOWN";
  if (swingUnknown) {
    reasons.push("Fibonacci للمراقبة فقط — اتجاه Swing غير مؤكد");
    // Will cap score and verdict at end
  }

  // ── Golden Zone ───────────────────────────────────────────────────────────
  if (fa.inGoldenZone) {
    const gzSupports = (isBuy && fa.goldenZone.direction === "BUY") ||
                       (isSell && fa.goldenZone.direction === "SELL");
    if (gzSupports && !swingUnknown) {
      score += 22; reasons.push("السعر داخل Golden Zone ويدعم القرار ✓");
    } else if (gzSupports && swingUnknown) {
      score += 8;  reasons.push("Golden Zone — للمراقبة (Swing غير مؤكد)");
    } else {
      score -= 8; reasons.push("السعر داخل Golden Zone لكن باتجاه مخالف");
    }
  } else {
    // Use nearest retracement proximity (wider than strict nearCurrent)
    const nearPct = fa.nearestRetracementLevels[0]?.distanceFromCurrentPct ?? Infinity;
    if (nearPct < 0.25) {
      const nearLabel = fa.nearestRetracementLevels[0]!.label;
      const levelDir = fa.swing.direction;
      const levelSupports =
        (isBuy  && (levelDir === "BULLISH")) ||
        (isSell && (levelDir === "BEARISH"));
      if (levelSupports) {
        score += 10; reasons.push(`السعر قريب من Fib ${nearLabel} ✓`);
      } else if (!swingUnknown) {
        score -= 5;  reasons.push(`Fib ${nearLabel} قريب لكن الاتجاه غير متوافق`);
      }
    } else {
      reasons.push("السعر ليس عند مستوى Fibonacci قريب");
    }
  }

  // ── Confluence with B3 Zones ──────────────────────────────────────────────
  if (fa.confluenceWithZones) {
    score += 15; reasons.push("Fibonacci يتوافق مع منطقة B3 (Zone confluence) ✓");
  } else if (fa.inGoldenZone) {
    score -= 5; reasons.push("Golden Zone بدون Zone B3 داعمة — توافق جزئي");
  }

  // ── Confluence with Market Structure ──────────────────────────────────────
  if (fa.confluenceWithMarketStructure) {
    score += 10; reasons.push("Fibonacci يتوافق مع هيكل السوق ✓");
  } else if (r.marketStructure?.bias) {
    const msConflict =
      (isBuy  && r.marketStructure.bias === "SELL") ||
      (isSell && r.marketStructure.bias === "BUY");
    if (msConflict) {
      score -= 15; reasons.push("Fibonacci يعاكس هيكل السوق ⚠");
    }
  }

  // ── BLOCK: Fib + Zone against decision ────────────────────────────────────
  if (fa.confluenceWithZones && !fa.confluenceWithMarketStructure) {
    const activeFibDir = fa.bias;
    const conflict = (isBuy && activeFibDir === "SELL") || (isSell && activeFibDir === "BUY");
    if (conflict && fa.inGoldenZone) {
      verdict = "BLOCK"; score -= 20;
      reasons.push("Golden Zone + Zone B3 تعارضان القرار بوضوح ✗");
    }
  }

  // ── Range with mid Fib ────────────────────────────────────────────────────
  if (r.marketStructure?.trendState === "RANGE" && !fa.confluenceWithZones) {
    score -= 8; if (verdict !== "BLOCK") verdict = "WARN";
    reasons.push("Fibonacci في سوق نطاق بدون Zone داعمة — إشارة ضعيفة");
  }

  // ── RANGE without zone confluence → cap at WARN ───────────────────────────
  if (r.marketStructure?.trendState === "RANGE" && !fa.confluenceWithZones) {
    if (verdict !== "BLOCK") verdict = "WARN";
    score = Math.min(score, 48);
    reasons.push("Fibonacci في سوق نطاق بدون Zone داعمة — لا يكفي للدخول");
  }

  // ── Confidence factor ─────────────────────────────────────────────────────
  score = Math.round(score * (0.5 + fa.confidence / 200));

  // ── Swing UNKNOWN cap: max score 45, max verdict WARN ────────────────────
  if (swingUnknown) {
    score   = Math.min(score, 45);
    verdict = verdict === "BLOCK" ? "BLOCK" : "WARN";
  }

  score = Math.max(5, Math.min(90, score));
  if (verdict !== "BLOCK") verdict = score >= 60 ? "PASS" : "WARN";

  return {
    committeeId: "fibonacci-confluence", committeeName: "لجنة توافق Fibonacci",
    verdict, score,
    summary: `${fa.inGoldenZone ? "في Golden Zone" : `أقرب: Fib ${fa.nearestLevel?.label ?? "—"}`} | توافق: ${fa.confluenceScore}%`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 12. لجنة توافق الفريمات — B5 ─────────────────────────────────────────────
function buildMTFCommittee(r: AnalysisResult): CommitteeResult {
  const mtf = r.multiTimeframeConsensus;

  if (!mtf) {
    return {
      committeeId: "multi-timeframe-consensus", committeeName: "لجنة توافق الفريمات",
      verdict: "WARN", score: 30,
      summary: "توافق الفريمات غير متاح",
      reasons: ["لم يُحسب توافق الفريمات — تحقق من مزامنة H4/H1/M30/M15"],
    };
  }

  const reasons: string[] = [...mtf.reasons.slice(0, 3)];
  let score   = 35;
  let verdict: CommitteeResult["verdict"] = "WARN";

  // ── Map MTF verdict directly ────────────────────────────────────────────
  if (mtf.verdict === "BLOCK") {
    verdict = "BLOCK"; score = 12;
    for (const b of mtf.blockers.slice(0, 2)) reasons.push(`⛔ ${b}`);
  } else if (mtf.verdict === "PASS") {
    verdict = "PASS";
    score   = mtf.alignmentScore >= 80 ? 78 :
              mtf.alignmentScore >= 60 ? 65 : 52;
  } else {
    verdict = "WARN";
    score   = mtf.alignmentScore >= 50 ? 42 : 28;
    for (const w of mtf.warnings.slice(0, 2)) reasons.push(`⚠ ${w}`);
  }

  // ── Bonus for full alignment ────────────────────────────────────────────
  if (mtf.higherTimeframeBias === "bullish" && r.direction === "bullish") {
    score = Math.min(score + 10, 90);
  } else if (mtf.higherTimeframeBias === "bearish" && r.direction === "bearish") {
    score = Math.min(score + 10, 90);
  }

  score = Math.max(5, Math.min(90, score));

  return {
    committeeId: "multi-timeframe-consensus", committeeName: "لجنة توافق الفريمات",
    verdict, score,
    summary: `${mtf.higherTimeframeBias} | توافق: ${mtf.alignmentScore}% | ${mtf.verdict}`,
    reasons: reasons.slice(0, 8),
  };
}

// ── 13. لجنة الأخبار والحماية — B6.2 ─────────────────────────────────────────
function buildNewsCommittee(r: AnalysisResult): CommitteeResult {
  const nc = r.newsProtectionCommittee;

  if (!nc) {
    return {
      committeeId: "news-protection", committeeName: "لجنة الأخبار والحماية",
      verdict: "WARN", score: 42,
      summary: "لم تُجلب أخبار Finnhub بعد",
      reasons: ["افتح صفحة صحة النظام واضغط 'جلب الأخبار' لتفعيل حماية الأخبار"],
    };
  }

  const reasons  = [...nc.blockers.slice(0, 2), ...nc.warnings.slice(0, 2), ...nc.reasons.slice(0, 3)];
  const verdict: CommitteeResult["verdict"] =
    nc.verdict === "BLOCK" ? "BLOCK" :
    nc.verdict === "WARN"  ? "WARN"  : "PASS"; // WATCH → PASS in committee (just context)
  const score = Math.max(5, Math.min(90, nc.score));

  return {
    committeeId: "news-protection", committeeName: "لجنة الأخبار والحماية",
    verdict, score,
    summary: `${nc.verdict} | مطابق: ${nc.matchedNewsCount} | عالي: ${nc.highImpactCount} | حظر: ${nc.blockingNewsCount}`,
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

// ── B2.1: Price Action Execution Guard ────────────────────────────────────────
type PriceActionExecutionGuard = {
  allowed:  boolean;
  status:   "PASS" | "WARN" | "BLOCK";
  score:    number;
  reasons:  string[];
  blockers: string[];
  warnings: string[];
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
    buildMarketStateCommittee(r),        // B3.2 — first (data quality gate)
    buildMarketStructureCommittee(r),   // B1
    buildCandlestickCommittee(r),       // B2
    buildZonesCommittee(r),             // B3
    buildFibonacciCommittee(r),         // B4
    buildMTFCommittee(r),               // B5
    buildNewsCommittee(r),              // B6.2
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

// ── MarketStateSection — B3.2 ─────────────────────────────────────────────────
function MarketStateSection({ msa }: { msa: MarketStateAnalysis }) {
  const decisionColor = (d: MarketStateDecision) => {
    if (d === "ALLOW_ANALYSIS")  return "text-emerald-400";
    if (d === "ANALYSIS_ONLY")   return "text-amber-400";
    if (d === "BLOCK_EXECUTION") return "text-red-400";
    return "text-red-600";
  };
  const riskColor = (r: FakeCandleRisk) => {
    if (r === "LOW")    return "text-emerald-300";
    if (r === "MEDIUM") return "text-amber-300";
    return "text-red-300";
  };
  const spreadColor = (s: SpreadStatus) => {
    if (s === "NORMAL") return "text-emerald-300";
    if (s === "HIGH")   return "text-amber-300";
    if (s === "EXTREME") return "text-red-300";
    return "text-muted-foreground";
  };
  const sessionIcon = (s: MarketSessionStatus) =>
    s === "OPEN" ? "✓ مفتوح" : s === "CLOSED" ? "✗ مغلق" :
    s === "LOW_LIQUIDITY" ? "⚠ سيولة منخفضة" : "؟ غير معروف";

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${
      msa.decision === "BLOCK_ALL" || msa.decision === "BLOCK_EXECUTION"
        ? "border-red-500/30 bg-red-500/[0.04]"
        : msa.decision === "ANALYSIS_ONLY"
          ? "border-amber-500/25 bg-amber-500/[0.04]"
          : "border-emerald-500/20 bg-emerald-500/[0.04]"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground/90">حالة السوق وجودة البيانات — B3.2</p>
        <span className={`text-[10px] font-semibold font-mono ${decisionColor(msa.decision)}`}>
          {msa.decision}
        </span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">جلسة السوق</span>
          <span className={`text-sm font-semibold ${
            msa.marketSessionStatus === "OPEN" ? "text-emerald-400" :
            msa.marketSessionStatus === "CLOSED" ? "text-red-400" :
            msa.marketSessionStatus === "LOW_LIQUIDITY" ? "text-amber-400" :
            "text-muted-foreground"
          }`}>{sessionIcon(msa.marketSessionStatus)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">آخر شمعة</span>
          <span className={`text-sm font-semibold ${msa.latestCandleClosed ? "text-emerald-300" : "text-amber-400"}`}>
            {msa.latestCandleClosed ? "مغلقة ✓" : "قيد التكوين ⚠"}
          </span>
          {!msa.latestCandleClosed && msa.usingClosedCandleOnly && (
            <span className="text-[9px] text-amber-300/70">تم تجاهلها للتحليل</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">السبريد</span>
          <span className={`text-sm font-semibold ${spreadColor(msa.spreadStatus)}`}>
            {msa.spreadPoints != null ? `${msa.spreadPoints} نقطة` : "—"}
          </span>
          <span className={`text-[9px] ${spreadColor(msa.spreadStatus)}`}>{msa.spreadStatus}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">خطر الشموع</span>
          <span className={`text-sm font-semibold ${riskColor(msa.fakeCandleRisk)}`}>
            {msa.fakeCandleRisk}
          </span>
          {msa.suspiciousCandlesCount > 0 && (
            <span className="text-[9px] text-amber-300/70">{msa.suspiciousCandlesCount} مشبوهة</span>
          )}
        </div>
      </div>

      {/* Blockers */}
      {msa.blockers.length > 0 && (
        <ul className="space-y-0.5">
          {msa.blockers.map((b, i) => (
            <li key={i} className="text-[11px] text-red-300/90 font-medium">✗ {b}</li>
          ))}
        </ul>
      )}

      {/* Warnings */}
      {msa.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {msa.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300/80">⚠ {w}</li>
          ))}
        </ul>
      )}

      {/* Reasons (only when things are good) */}
      {msa.decision === "ALLOW_ANALYSIS" && msa.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {msa.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="text-[11px] text-emerald-300/70">• {r}</li>
          ))}
        </ul>
      )}

      {/* Clock skew */}
      {msa.brokerClockSkewDetected && (
        <p className="text-[10px] text-orange-400/80 font-medium">
          ⚠ Broker clock skew: الوسيط متقدم بـ {Math.round(msa.brokerClockSkewMs / 60000)} دقيقة
        </p>
      )}
    </div>
  );
}

// ── MarketStructureSection — B1 ───────────────────────────────────────────────
// يعرض هيكل السوق — قراءة فقط — لا تنفيذ تداول
function MarketStructureSection({ ms }: { ms: MarketStructureAnalysis }) {
  const trendColor = (s: string) => {
    if (s === "BULLISH")    return "text-emerald-400";
    if (s === "BEARISH")    return "text-red-400";
    if (s === "TRANSITION") return "text-amber-400";
    return "text-sky-400";
  };
  const biasColor = (b: string) => {
    if (b === "BUY")  return "text-emerald-300";
    if (b === "SELL") return "text-red-300";
    return "text-muted-foreground";
  };
  const trendLabel = (s: string) => {
    if (s === "BULLISH")    return "صاعد ↑";
    if (s === "BEARISH")    return "هابط ↓";
    if (s === "RANGE")      return "نطاق ↔";
    if (s === "TRANSITION") return "تحوّل ⚡";
    return s;
  };
  const bosLabel  = ms.bosDirection   ? `BOS ${ms.bosDirection}` : null;
  const chochLabel= ms.chochDirection ? `CHoCH ${ms.chochDirection}` : null;

  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-sky-200/90">هيكل السوق — B1</p>
        <span className="text-[10px] text-muted-foreground/60 font-mono">
          ثقة: {ms.confidence}% | pivots: {ms.swings.length}
        </span>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">حالة السوق</span>
          <span
            className={`text-sm font-bold ${trendColor(ms.trendState)}`}
            title={TREND_STATE_EXPLANATIONS[ms.trendState]}
          >
            {trendLabel(ms.trendState)}
          </span>
          <span className="text-[9px] text-muted-foreground/55 leading-tight">
            {ms.trendState === "RANGE"      ? "تحرك بين دعم ومقاومة" :
             ms.trendState === "TRANSITION" ? "بداية تحول محتمل" :
             ms.trendState === "BULLISH"    ? "قمم وقيعان أعلى" :
             ms.trendState === "BEARISH"    ? "قمم وقيعان أدنى" : ""}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">الانحياز</span>
          <span className={`text-sm font-semibold ${biasColor(ms.bias)}`}>{ms.bias}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">آخر قمة (SH)</span>
          <span className="text-sm font-mono text-foreground">
            {ms.lastSwingHigh ? ms.lastSwingHigh.price.toFixed(5) : "—"}
          </span>
          <span className="text-[9px] text-muted-foreground/55">مقاومة محتملة</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">آخر قاع (SL)</span>
          <span className="text-sm font-mono text-foreground">
            {ms.lastSwingLow ? ms.lastSwingLow.price.toFixed(5) : "—"}
          </span>
          <span className="text-[9px] text-muted-foreground/55">دعم محتمل</span>
        </div>
      </div>

      {/* BOS / CHoCH badges with tooltips */}
      {(bosLabel || chochLabel || ms.rangeDetected) && (
        <div className="flex flex-wrap gap-1.5 items-start">
          {bosLabel && (
            <div className="flex flex-col gap-0.5">
              <span
                title={BOS_EXPLANATION}
                className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold cursor-help ${
                  ms.bosDirection === "UP"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-red-500/40 bg-red-500/10 text-red-300"
                }`}
              >
                {bosLabel}
              </span>
              <span className="text-[9px] text-muted-foreground/60">كسر هيكلي مؤكد</span>
            </div>
          )}
          {chochLabel && (
            <div className="flex flex-col gap-0.5">
              <span
                title={CHOCH_EXPLANATION}
                className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold cursor-help ${
                  ms.chochDirection === "UP"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-orange-500/40 bg-orange-500/10 text-orange-300"
                }`}
              >
                {chochLabel}
              </span>
              <span className="text-[9px] text-muted-foreground/60">تغير سلوك السعر</span>
            </div>
          )}
          {ms.rangeDetected && (
            <div className="flex flex-col gap-0.5">
              <span className="inline-flex items-center rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                نطاق {ms.rangeHigh?.toFixed(5)} — {ms.rangeLow?.toFixed(5)}
              </span>
              <span className="text-[9px] text-muted-foreground/60">الدخول من المنتصف أضعف</span>
            </div>
          )}
        </div>
      )}

      {/* Structure points — مع اسم كامل وtooltip */}
      {ms.structurePoints.length > 0 && (() => {
        const recent = ms.structurePoints.slice(-6);
        return (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] text-muted-foreground/70 w-full">آخر نقاط الهيكل:</span>
            {recent.map((p, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <span
                  title={STRUCTURE_POINT_EXPLANATIONS[p.type]}
                  className={`rounded border px-2 py-0.5 text-[10px] font-mono font-bold cursor-help ${
                    p.type === "HH" ? "border-emerald-500/30 text-emerald-400" :
                    p.type === "HL" ? "border-emerald-500/20 text-emerald-300/70" :
                    p.type === "LH" ? "border-red-500/20 text-red-300/70" :
                                      "border-red-500/30 text-red-400"
                  }`}
                >
                  {p.type}
                </span>
                <span className="text-[8px] text-muted-foreground/50 text-center leading-tight max-w-[52px]">
                  {STRUCTURE_POINT_LABEL[p.type] ?? p.type}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Reasons */}
      {ms.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {ms.reasons.slice(0, 5).map((r, i) => (
            <li key={i} className="text-[11px] text-foreground/70">• {r}</li>
          ))}
        </ul>
      )}

      {/* Warnings */}
      {ms.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {ms.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300/80">⚠ {w}</li>
          ))}
        </ul>
      )}

      {/* B3.1: ملاحظة عامة */}
      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-1.5 italic">
        {GENERAL_DISCLAIMER}
      </p>
    </div>
  );
}

// ── CandlestickSection — B2 ───────────────────────────────────────────────────
// يعرض تحليل الشموع والسيولة — قراءة فقط — لا تنفيذ تداول
function CandlestickSection({ cs }: { cs: CandlestickAnalysis }) {
  const biasColor = (b: string) => {
    if (b === "BUY")  return "text-emerald-300";
    if (b === "SELL") return "text-red-300";
    return "text-muted-foreground";
  };
  const qualityColor = (q: string) => {
    if (q === "STRONG")     return "text-emerald-400";
    if (q === "NORMAL")     return "text-foreground";
    if (q === "WEAK")       return "text-amber-400";
    if (q === "SUSPICIOUS") return "text-orange-400";
    return "text-muted-foreground";
  };
  const patternLabel: Record<string, string> = {
    BULLISH_ENGULFING:    "Bullish Engulfing ↑",
    BEARISH_ENGULFING:    "Bearish Engulfing ↓",
    PIN_BAR_BULLISH:      "Pin Bar صاعد ↑",
    PIN_BAR_BEARISH:      "Pin Bar هابط ↓",
    DOJI:                 "Doji ↔",
    STRONG_BULLISH_CLOSE: "إغلاق صاعد قوي ↑",
    STRONG_BEARISH_CLOSE: "إغلاق هابط قوي ↓",
    INSIDE_BAR:           "Inside Bar ↔",
    LIQUIDITY_SWEEP_HIGH: "Sweep High ↓",
    LIQUIDITY_SWEEP_LOW:  "Sweep Low ↑",
    FAKE_BREAKOUT_UP:     "Fakeout Up ↓",
    FAKE_BREAKOUT_DOWN:   "Fakeout Down ↑",
  };
  const patternDir: Record<string, string> = {
    BUY: "text-emerald-300", SELL: "text-red-300", NEUTRAL: "text-sky-300",
  };

  // Top significant pattern (strongest, last candles)
  const topPattern = cs.patterns
    .filter((p) => p.direction !== "NEUTRAL")
    .sort((a, b) => b.strength - a.strength)[0];

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-violet-200/90">تحليل الشموع والسيولة — B2</p>
        <span className="text-[10px] text-muted-foreground/60 font-mono">
          ثقة: {cs.confidence}% | أنماط: {cs.patterns.length}
        </span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">الانحياز</span>
          <span className={`text-sm font-bold ${biasColor(cs.bias)}`}>{cs.bias}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">جودة الشمعة</span>
          <span className={`text-sm font-semibold ${qualityColor(cs.quality)}`}>{cs.quality}</span>
        </div>
        <div className="flex flex-col gap-0.5" title="سحب السيولة — السعر يكسر مستوى مؤقتاً ثم يعود. قد يكون كسراً وهمياً.">
          <span className="text-[10px] text-muted-foreground cursor-help">سحب السيولة</span>
          <span className={`text-sm font-semibold ${cs.liquiditySweepDetected ? "text-orange-400" : "text-muted-foreground/50"}`}>
            {cs.liquiditySweepDetected ? "مكتشف ⚠" : "لا"}
          </span>
          {cs.liquiditySweepDetected && (
            <span className="text-[9px] text-orange-400/60">كسر مؤقت ثم عودة</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5" title="الكسر الوهمي — السعر يخترق مستوى ثم يفشل في الثبات فوقه/تحته.">
          <span className="text-[10px] text-muted-foreground cursor-help">الكسر الوهمي</span>
          <span className={`text-sm font-semibold ${cs.fakeoutDetected ? "text-red-400" : "text-muted-foreground/50"}`}>
            {cs.fakeoutDetected ? "مكتشف ⚠" : "لا"}
          </span>
          {cs.fakeoutDetected && (
            <span className="text-[9px] text-red-400/60">اختراق بلا ثبات</span>
          )}
        </div>
      </div>

      {/* Wick rejection */}
      {cs.wickRejection.detected && (
        <div className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-[11px] ${
          cs.wickRejection.direction === "BUY"
            ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300"
            : "border-red-500/30 bg-red-500/8 text-red-300"
        }`}>
          <span className="font-semibold">رفض الذيل:</span>
          <span>{cs.wickRejection.reason}</span>
        </div>
      )}

      {/* Top pattern with Arabic explanation */}
      {topPattern && (
        <div className="rounded border border-border bg-muted/10 px-2.5 py-2 space-y-0.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">أهم نمط:</span>
            <span className={`font-semibold ${patternDir[topPattern.direction] ?? ""}`}>
              {patternLabel[topPattern.type] ?? topPattern.type}
            </span>
            <span className="text-muted-foreground/60 font-mono">قوة: {topPattern.strength}</span>
          </div>
          {CANDLE_PATTERN_EXPLANATIONS[topPattern.type] && (
            <p className="text-[9px] text-muted-foreground/60 italic leading-tight">
              {CANDLE_PATTERN_EXPLANATIONS[topPattern.type]}
            </p>
          )}
        </div>
      )}

      {/* All patterns (compact with tooltips) */}
      {cs.patterns.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground/70 w-full">الأنماط المكتشفة:</span>
          {cs.patterns.slice(-8).map((p, i) => (
            <span
              key={i}
              title={CANDLE_PATTERN_EXPLANATIONS[p.type] ?? p.type}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium cursor-help ${patternDir[p.direction] ?? ""} border-current/20`}
            >
              {patternLabel[p.type] ?? p.type}
            </span>
          ))}
        </div>
      )}

      {/* Latest candle metrics */}
      {cs.latestCandleQuality && (
        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/70 font-mono">
          <span>جسم: {(cs.latestCandleQuality.bodyToRangeRatio * 100).toFixed(0)}%</span>
          <span>ذيل ↑: {cs.latestCandleQuality.upperWick.toFixed(5)}</span>
          <span>ذيل ↓: {cs.latestCandleQuality.lowerWick.toFixed(5)}</span>
        </div>
      )}

      {/* Reasons */}
      {cs.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {cs.reasons.slice(0, 5).map((r, i) => (
            <li key={i} className="text-[11px] text-foreground/70">• {r}</li>
          ))}
        </ul>
      )}

      {/* Warnings */}
      {cs.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {cs.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300/80">{w}</li>
          ))}
        </ul>
      )}

      {/* B3.1: ملاحظة عامة */}
      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-1.5 italic">
        {GENERAL_DISCLAIMER}
      </p>
    </div>
  );
}

// ── ZonesSection — B3 ────────────────────────────────────────────────────────
function ZonesSection({ za }: { za: ZonesAnalysis }) {
  const pdColor = (pd: string) => {
    if (pd === "PREMIUM")  return "text-red-300";
    if (pd === "DISCOUNT") return "text-emerald-300";
    if (pd === "MID")      return "text-amber-400";
    return "text-muted-foreground";
  };
  const biasColor = (b: string) => {
    if (b === "BUY")  return "text-emerald-300";
    if (b === "SELL") return "text-red-300";
    return "text-muted-foreground";
  };
  const zoneTypeLabel: Record<string, string> = {
    SUPPLY:                "عرض (Supply)",
    DEMAND:                "طلب (Demand)",
    BULLISH_ORDER_BLOCK:   "OB صاعد",
    BEARISH_ORDER_BLOCK:   "OB هابط",
    BULLISH_FVG:           "FVG صاعد",
    BEARISH_FVG:           "FVG هابط",
    SUPPORT:               "دعم",
    RESISTANCE:            "مقاومة",
  };
  const zoneDir: Record<string, string> = {
    BUY: "text-emerald-300", SELL: "text-red-300", NEUTRAL: "text-sky-300",
  };

  return (
    <div className="rounded-lg border border-teal-500/20 bg-teal-500/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-teal-200/90">مناطق العرض والطلب والفجوات — B3</p>
        <span className="text-[10px] text-muted-foreground/60 font-mono">
          ثقة: {za.confidence}% | توافق: {za.confluenceScore}%
        </span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div
          className="flex flex-col gap-0.5 cursor-help"
          title={PREMIUM_DISCOUNT_EXPLANATIONS[za.inPremiumDiscount] ?? ""}
        >
          <span className="text-[10px] text-muted-foreground">الموضع في النطاق</span>
          <span className={`text-sm font-bold ${pdColor(za.inPremiumDiscount)}`}>
            {za.inPremiumDiscount === "PREMIUM"  ? "Premium ↑"  :
             za.inPremiumDiscount === "DISCOUNT" ? "Discount ↓" :
             za.inPremiumDiscount === "MID"      ? "Mid ↔"      : "غير محدد"}
          </span>
          <span className="text-[9px] text-muted-foreground/55 leading-tight">
            {za.inPremiumDiscount === "PREMIUM"  ? "أفضل للبيع" :
             za.inPremiumDiscount === "DISCOUNT" ? "أفضل للشراء" :
             za.inPremiumDiscount === "MID"      ? "دخول ضعيف" : ""}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">انحياز المناطق</span>
          <span className={`text-sm font-semibold ${biasColor(za.bias)}`}>{za.bias}</span>
        </div>
        <div
          className="flex flex-col gap-0.5 cursor-help"
          title="الفجوة السعرية / Imbalance — منطقة اندفاع سريع لم يحصل فيها تداول متوازن. قد يعود السعر لملئها."
        >
          <span className="text-[10px] text-muted-foreground">FVG نشطة</span>
          <span className="text-sm font-semibold text-foreground">{za.fvgZones.length}</span>
          <span className="text-[9px] text-muted-foreground/55">فجوات Imbalance</span>
        </div>
        <div
          className="flex flex-col gap-0.5 cursor-help"
          title="Order Block — آخر شمعة عكسية قبل اندفاع قوي. منطقة اهتمام مؤسسي محتملة."
        >
          <span className="text-[10px] text-muted-foreground">Order Blocks</span>
          <span className="text-sm font-semibold text-foreground">{za.orderBlocks.length}</span>
          <span className="text-[9px] text-muted-foreground/55">مناطق مؤسسية</span>
        </div>
      </div>

      {/* Nearest zones */}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {za.nearestDemand && (
          <div className="flex items-center justify-between rounded border border-emerald-500/25 px-2.5 py-1.5 text-[11px]">
            <span className="text-emerald-300/80">أقرب طلب:</span>
            <span className="font-mono text-foreground">{za.nearestDemand.midpoint.toFixed(5)}</span>
            <span className="text-muted-foreground/60">{za.nearestDemand.distanceFromCurrent.toFixed(2)}%</span>
          </div>
        )}
        {za.nearestSupply && (
          <div className="flex items-center justify-between rounded border border-red-500/25 px-2.5 py-1.5 text-[11px]">
            <span className="text-red-300/80">أقرب عرض:</span>
            <span className="font-mono text-foreground">{za.nearestSupply.midpoint.toFixed(5)}</span>
            <span className="text-muted-foreground/60">{za.nearestSupply.distanceFromCurrent.toFixed(2)}%</span>
          </div>
        )}
      </div>

      {/* Active zones (compact with tooltips) */}
      {za.activeZones.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground/70 w-full">أقرب المناطق النشطة:</span>
          {za.activeZones.slice(0, 6).map((z) => (
            <span
              key={z.id}
              title={ZONE_TYPE_EXPLANATIONS[z.type] ?? z.type}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium cursor-help ${zoneDir[z.direction] ?? ""} border-current/20`}
            >
              {zoneTypeLabel[z.type] ?? z.type} {z.distanceFromCurrent.toFixed(1)}%
            </span>
          ))}
        </div>
      )}

      {/* Reasons */}
      {za.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {za.reasons.slice(0, 5).map((r, i) => (
            <li key={i} className="text-[11px] text-foreground/70">• {r}</li>
          ))}
        </ul>
      )}

      {/* Warnings */}
      {za.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {za.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300/80">{w}</li>
          ))}
        </ul>
      )}

      {/* B3.1: ملاحظة عامة */}
      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-1.5 italic">
        {GENERAL_DISCLAIMER}
      </p>
    </div>
  );
}

// ── FibonacciSection — B4 ─────────────────────────────────────────────────────
function FibonacciSection({ fa }: { fa: FibonacciAnalysis }) {
  const biasColor = (b: string) =>
    b === "BUY" ? "text-emerald-300" : b === "SELL" ? "text-red-300" : "text-muted-foreground";
  const swingDirColor = (d: string) =>
    d === "BULLISH" ? "text-emerald-300" : d === "BEARISH" ? "text-red-300" : "text-sky-300";
  const levelColor = (l: FibonacciLevel) =>
    l.nearCurrent ? (l.level === 0.5 || l.level === 0.618 ? "text-amber-300" : "text-foreground") :
    "text-muted-foreground/60";

  const topExtension = fa.extensionLevels.slice(0, 3);

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-amber-200/90">توافق Fibonacci — B4</p>
        <span className="text-[10px] text-muted-foreground/60 font-mono">
          توافق: {fa.confluenceScore}% | ثقة: {fa.confidence}%
        </span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">انحياز Fibonacci</span>
          <span className={`text-sm font-bold ${biasColor(fa.bias)}`}>{fa.bias}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">اتجاه Swing</span>
          <span className={`text-sm font-semibold ${swingDirColor(fa.swing.direction)}`}>
            {fa.swing.direction === "BULLISH" ? "صاعد ↑" : fa.swing.direction === "BEARISH" ? "هابط ↓" : "غير محدد"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Swing Low</span>
          <span className="text-sm font-mono text-foreground">{fa.swing.swingLow.toFixed(5)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Swing High</span>
          <span className="text-sm font-mono text-foreground">{fa.swing.swingHigh.toFixed(5)}</span>
        </div>
      </div>

      {/* Golden Zone */}
      <div className={`flex items-center justify-between rounded border px-3 py-2 text-[11px] ${
        fa.inGoldenZone
          ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
          : "border-border bg-muted/5 text-muted-foreground"
      }`}>
        <span className="font-semibold">
          Golden Zone (50%–61.8%){fa.inGoldenZone ? " ✓" : ""}
        </span>
        <span className="font-mono">
          {fa.goldenZone.low.toFixed(5)} — {fa.goldenZone.high.toFixed(5)}
        </span>
        {!fa.inGoldenZone && fa.goldenZone.distanceFromCurrentPct > 0 && (
          <span className="text-[10px]">{fa.goldenZone.distanceFromCurrentPct.toFixed(2)}% بعيد</span>
        )}
      </div>

      {/* Swing UNKNOWN notice */}
      {fa.swing.direction === "UNKNOWN" && (
        <div className="rounded border border-amber-500/30 bg-amber-500/8 px-2.5 py-1.5 text-[11px] text-amber-300/90">
          ⚠ Swing غير مؤكد — Fibonacci للمراقبة فقط، لا يكفي للدخول وحده
        </div>
      )}

      {/* Retracement levels — rank-based markers (only closest 1-2 get labels) */}
      {(() => {
        const closestLabel  = fa.nearestRetracementLevels[0]?.label;
        const secondPct     = fa.nearestRetracementLevels[1]?.distanceFromCurrentPct ?? Infinity;
        const secondLabel   = secondPct < 0.5 ? fa.nearestRetracementLevels[1]?.label : null;
        const anyNear       = fa.nearestRetracementLevels.some((l) => l.nearCurrent);

        return (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] text-muted-foreground/70 w-full">
              مستويات التصحيح:
              {!anyNear && <span className="text-muted-foreground/45 ms-1">(لا يوجد مستوى قريب جداً)</span>}
            </span>
            {fa.retracementLevels.map((l) => {
              const isClosest = l.label === closestLabel;
              const isSecond  = l.label === secondLabel;
              return (
                <div
                  key={l.label}
                  title={`Fib ${l.label} — ${l.price.toFixed(5)} | بُعد: ${l.distanceFromCurrentPct.toFixed(2)}%`}
                  className={`flex flex-col items-center rounded border px-2 py-0.5 cursor-help ${
                    l.level === GOLDEN_LOW || l.level === GOLDEN_HIGH
                      ? "border-amber-500/40 bg-amber-500/8"
                      : "border-border bg-muted/5"
                  }`}
                >
                  <span className={`text-[10px] font-bold font-mono ${levelColor(l)}`}>{l.label}</span>
                  <span className="text-[9px] text-muted-foreground/60 font-mono">{l.price.toFixed(5)}</span>
                  {isClosest && <span className="text-[8px] text-amber-400 font-semibold">الأقرب</span>}
                  {!isClosest && isSecond && <span className="text-[8px] text-amber-300/60">قريب</span>}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Extension targets */}
      {topExtension.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] text-muted-foreground/70 w-full">أهداف الامتداد:</span>
          {topExtension.map((l) => (
            <span key={l.label} className="rounded border border-sky-500/20 px-2 py-0.5 text-[10px] font-mono text-sky-300/70">
              {l.label}: {l.price.toFixed(5)}
            </span>
          ))}
        </div>
      )}

      {/* Confluence flags */}
      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
          fa.confluenceWithZones ? "border-emerald-500/30 text-emerald-300" : "border-border text-muted-foreground/50"
        }`}>
          {fa.confluenceWithZones ? "✓ توافق مع Zones B3" : "— لا توافق مع Zones"}
        </span>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
          fa.confluenceWithMarketStructure ? "border-emerald-500/30 text-emerald-300" : "border-border text-muted-foreground/50"
        }`}>
          {fa.confluenceWithMarketStructure ? "✓ هيكل السوق يدعم" : "— هيكل غير مؤكد"}
        </span>
      </div>

      {/* Reasons */}
      {fa.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {fa.reasons.slice(0, 5).map((r, i) => (
            <li key={i} className="text-[11px] text-foreground/70">• {r}</li>
          ))}
        </ul>
      )}

      {/* Warnings */}
      {fa.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {fa.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300/80">⚠ {w}</li>
          ))}
        </ul>
      )}

      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-1.5 italic">
        Fibonacci لا تعني دخولاً مباشراً — هي مستويات اهتمام تحتاج توافقاً مع المناطق والهيكل.
      </p>
    </div>
  );
}

// Constants needed inside FibonacciSection
const GOLDEN_LOW  = 0.5;
const GOLDEN_HIGH = 0.618;

// ── MTFSection — B5 ──────────────────────────────────────────────────────────
function MTFSection({ mtf }: { mtf: MultiTimeframeConsensus }) {
  const verdictColor = (v: string) =>
    v === "PASS" ? "text-emerald-300" : v === "WARN" ? "text-amber-300" : "text-red-300";
  const biasIcon = (b: TFBias) =>
    b === "bullish" ? "↑" : b === "bearish" ? "↓" : b === "neutral" ? "↔" : "—";
  const biasColor = (b: TFBias) =>
    b === "bullish" ? "text-emerald-300" : b === "bearish" ? "text-red-300" :
    b === "neutral" ? "text-sky-300" : "text-muted-foreground/50";

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${
      mtf.verdict === "BLOCK" ? "border-red-500/30 bg-red-500/[0.04]" :
      mtf.verdict === "WARN"  ? "border-amber-500/25 bg-amber-500/[0.04]" :
                                "border-indigo-500/25 bg-indigo-500/[0.04]"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-indigo-200/90">توافق الفريمات — B5</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/60 font-mono">
            توافق: {mtf.alignmentScore}%
          </span>
          <span className={`text-[11px] font-bold ${verdictColor(mtf.verdict)}`}>
            {mtf.verdict}
          </span>
        </div>
      </div>

      {/* Timeframe bias grid */}
      <div className="grid grid-cols-4 gap-1.5">
        {mtf.timeframeSummaries.map((s) => (
          <div
            key={s.timeframe}
            className={`flex flex-col items-center rounded border py-1.5 px-1 text-center ${
              s.isEntry ? "border-indigo-500/40 bg-indigo-500/10" : "border-border bg-muted/5"
            }`}
          >
            <span className="text-[10px] text-muted-foreground font-mono">{s.timeframe}</span>
            <span className={`text-base font-bold ${biasColor(s.trendBias)}`}>
              {biasIcon(s.trendBias)}
            </span>
            <span className={`text-[9px] ${biasColor(s.trendBias)}`}>
              {s.trendBias === "bullish" ? "صاعد" :
               s.trendBias === "bearish" ? "هابط" :
               s.trendBias === "neutral" ? "محايد" : "—"}
            </span>
            {s.isEntry && <span className="text-[8px] text-indigo-400/70 mt-0.5">دخول</span>}
          </div>
        ))}
      </div>

      {/* Key info row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">الفريم المتحكم</span>
          <span className="text-sm font-semibold font-mono text-foreground">
            {mtf.dominantTimeframe ?? "غير محدد"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">انحياز السياق (H4/H1)</span>
          <span className={`text-sm font-semibold ${biasColor(mtf.higherTimeframeBias as TFBias)}`}>
            {mtf.higherTimeframeBias === "bullish" ? "↑ صاعد" :
             mtf.higherTimeframeBias === "bearish" ? "↓ هابط" :
             mtf.higherTimeframeBias === "mixed"   ? "⚡ متعارض" :
             mtf.higherTimeframeBias === "neutral" ? "↔ محايد" : "غير متاح"}
          </span>
        </div>
      </div>

      {/* Blockers */}
      {mtf.blockers.length > 0 && (
        <ul className="space-y-0.5">
          {mtf.blockers.map((b, i) => (
            <li key={i} className="text-[11px] text-red-300/90 font-medium">✗ {b}</li>
          ))}
        </ul>
      )}

      {/* Warnings */}
      {mtf.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {mtf.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300/80">⚠ {w}</li>
          ))}
        </ul>
      )}

      {/* Reasons (PASS only) */}
      {mtf.verdict !== "BLOCK" && mtf.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {mtf.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="text-[11px] text-foreground/70">• {r}</li>
          ))}
        </ul>
      )}

      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-1.5 italic">
        B5: H4 يمثل السياق الكبير — H1 يمثل الهيكل — M30 تأكيد — M15 توقيت الدخول.
      </p>
    </div>
  );
}

// ── NewsSentinelSection — B6.2 ───────────────────────────────────────────────
function NewsSentinelSection({ nc }: { nc: NewsCommitteeResult }) {
  const verdictColor =
    nc.verdict === "BLOCK" ? "text-red-300"     :
    nc.verdict === "WARN"  ? "text-amber-300"   :
    nc.verdict === "WATCH" ? "text-sky-300"     : "text-emerald-300";
  const matchTypeLabel: Record<string, string> = {
    DIRECT:        "مباشر",
    USER_OVERRIDE: "مستخدم",
    MACRO_USD:     "ماكرو USD",
    MACRO_RISK:    "ماكرو خطر",
    FOREX_GENERAL: "Forex عام",
  };
  const impactColor = (i: string) =>
    i === "HIGH" || i === "BLOCK" ? "text-red-400" :
    i === "MEDIUM" ? "text-amber-400" : "text-muted-foreground";

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${
      nc.verdict === "BLOCK" ? "border-red-500/30 bg-red-500/[0.04]" :
      nc.verdict === "WARN"  ? "border-amber-500/25 bg-amber-500/[0.04]" :
      nc.verdict === "WATCH" ? "border-sky-500/20 bg-sky-500/[0.04]" :
                               "border-emerald-500/20 bg-emerald-500/[0.04]"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground/90">لجنة الأخبار والحماية — B6.2</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/60 font-mono">
            مطابق: {nc.matchedNewsCount} | عالي: {nc.highImpactCount}
          </span>
          <span className={`text-[11px] font-bold ${verdictColor}`}>{nc.verdict}</span>
        </div>
      </div>

      {/* Blockers */}
      {nc.blockers.length > 0 && (
        <div className="space-y-1">
          {nc.blockers.map((b, i) => (
            <p key={i} className="text-[11px] text-red-300/90 font-medium leading-snug">✗ {b}</p>
          ))}
        </div>
      )}

      {/* Warnings */}
      {nc.warnings.length > 0 && (
        <div className="space-y-1">
          {nc.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-300/80 leading-snug">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* PASS reasons */}
      {nc.verdict === "PASS" && nc.reasons.length > 0 && (
        <p className="text-[11px] text-emerald-300/80">{nc.reasons[0]}</p>
      )}

      {/* Matched events */}
      {nc.matchedEvents.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground/60">الأخبار المرتبطة بالرمز:</p>
          {nc.matchedEvents.map((e, i) => (
            <div key={i} className="rounded border border-border bg-muted/5 px-2.5 py-1.5 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-foreground/80 leading-tight flex-1 truncate">{e.headline}</p>
                <span className={`text-[9px] font-semibold shrink-0 ${impactColor(e.finalImpact)}`}>
                  {e.finalImpact}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[9px]">
                <span className="text-muted-foreground/60 font-mono">{e.ageMinutes} دق</span>
                <span className="text-sky-400/70">{matchTypeLabel[e.matchType] ?? e.matchType}</span>
                <span className={
                  e.itemVerdict === "BLOCK" ? "text-red-400" :
                  e.itemVerdict === "WARN"  ? "text-amber-400" : "text-sky-400"
                }>{e.itemVerdict}</span>
                {e.finalDecision !== "PASS" && (
                  <span className="text-muted-foreground/50">{e.finalDecision}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-1.5 italic">
        B6.2 — الأخبار المرتبطة بالرمز خلال 24 ساعة — لا تؤدي تلقائياً إلى order_send.
      </p>
    </div>
  );
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

// ── A26.2/A26.3/A26.4: نوع نتيجة الأمر من /api/mt5-demo/order-send ──────────
type DemoOrderResult = {
  ok:                          boolean;
  accepted:                    boolean;
  ticket?:                     number;
  retcode?:                    number;
  retcodeText?:                string;
  message?:                    string;
  fillingModeUsed?:            string;
  fillingModesTried?:          string[];
  symbolFillingMode?:          number;
  // A26.4/A26.5 — margin precheck fields
  marginRequired?:             number | null;
  freeMarginBefore?:           number;
  marginOk?:                   boolean | null;
  marginShortfall?:            number;
  suggestedMaxLot?:            number | null;
  suggestedLotReason?:         string | null;
  execLotRequested?:           number;
  balance?:                    number;
  equity?:                     number;
  marginUsed?:                 number;
  leverage?:                   number;
  marginPrecheckUnavailable?:  boolean | null;
  requestSummary?:             { symbol: string; orderType: string; lot: number; price: number; sl: number; tp: number };
  accountLogin?:               number;
  server?:                     string;
  demoOnly:                    boolean;
  error?:                      string;
};

// ── buildPriceActionExecutionGuard — B2.1 ────────────────────────────────────
// حارس Price Action — يمنع التنفيذ إذا التحليل غير مؤهل
// لا order_send — لا تنفيذ تداول — حارس واجهة فقط
function buildPriceActionExecutionGuard(
  result:         AnalysisResult,
  summary:        DecisionSummary,
  preview:        TradeOrderPreview,
  lastOrderResult: DemoOrderResult | null,
): PriceActionExecutionGuard {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const reasons:  string[] = [];

  const { grade, probability, committees, finalDecision } = summary;
  const ms  = result.marketStructure;
  const cs  = result.candlestickAnalysis;
  const ind = result.indicators;
  const msa = result.marketStateAnalysis;

  // ── ي) حالة السوق وجودة البيانات — B3.2 ─────────────────────────────────
  if (msa) {
    if (msa.decision === "BLOCK_ALL" || msa.decision === "BLOCK_EXECUTION") {
      if (!msa.marketOpen) {
        blockers.push("ممنوع التنفيذ: السوق مغلق أو tick غير صالح");
      }
      if (!msa.dataFresh) {
        blockers.push("ممنوع التنفيذ: بيانات قديمة — أعد مزامنة الشموع");
      }
      if (msa.fakeCandleRisk === "HIGH") {
        blockers.push("ممنوع التنفيذ: خطر شموع مشبوهة مرتفع");
      }
      if (msa.spreadStatus === "EXTREME") {
        blockers.push(`ممنوع التنفيذ: سبريد مفرط (${msa.spreadPoints} نقطة)`);
      }
      // Add any engine-level blockers
      for (const b of msa.blockers.slice(0, 2)) {
        if (!blockers.some((existing) => existing.includes(b.substring(0, 15)))) {
          blockers.push(b);
        }
      }
    } else {
      if (msa.fakeCandleRisk === "MEDIUM") {
        warnings.push("شموع مشبوهة محتملة — تحقق من جودة البيانات");
      }
      if (!msa.latestCandleClosed && msa.usingClosedCandleOnly) {
        warnings.push("تم تجاهل الشمعة الحالية — التحليل يستخدم آخر شمعة مغلقة");
      }
      if (msa.spreadStatus === "HIGH") {
        warnings.push(`سبريد مرتفع (${msa.spreadPoints} نقطة) — راجع جودة الدخول`);
      }
      if (msa.decision === "ALLOW_ANALYSIS" && msa.marketOpen && msa.dataFresh) {
        reasons.push("حالة السوق وجودة البيانات سليمة ✓");
      }
    }
  } else {
    warnings.push("حالة السوق غير محسوبة — تحقق من مزامنة الشموع");
  }

  // ── أ) الدرجة ─────────────────────────────────────────────────────────────
  if (grade === "D" || grade === "C") {
    blockers.push(`ممنوع التنفيذ: الدرجة ${grade} أقل من الحد الأدنى B`);
  } else {
    reasons.push(`الدرجة ${grade} مقبولة للتنفيذ ✓`);
  }

  // ── ب) الاحتمالية ─────────────────────────────────────────────────────────
  if (probability < 60) {
    blockers.push(`ممنوع التنفيذ: احتمال القرار ${probability}% أقل من 60%`);
  } else if (probability < 68) {
    warnings.push(`احتمال القرار ${probability}% بين 60% و68% — تحقق من الإشارات`);
  } else {
    reasons.push(`احتمال القرار ${probability}% ✓`);
  }

  // ── ج) عدد التحذيرات ──────────────────────────────────────────────────────
  const warnCount  = committees.filter((c) => c.verdict === "WARN").length;
  const blockCount = committees.filter((c) => c.verdict === "BLOCK").length;
  if (warnCount >= 3) {
    blockers.push(`ممنوع التنفيذ: ${warnCount} لجان بتحذير WARN — إشارات متضاربة كثيرة`);
  } else if (warnCount === 2) {
    warnings.push(`${warnCount} لجان بتحذير WARN — مراجعة الإشارات موصى بها`);
  }
  if (blockCount > 0) {
    warnings.push(`${blockCount} لجنة أصدرت BLOCK — الحارس الأول يجب أن يمنعه`);
  }

  // ── د) هيكل السوق ────────────────────────────────────────────────────────
  const isMarketOrder =
    preview.orderType === "BUY_MARKET_PREVIEW" ||
    preview.orderType === "SELL_MARKET_PREVIEW";

  if (ms) {
    const msBiasBuy  = ms.bias === "BUY"  && finalDecision === "BUY";
    const msBiasSell = ms.bias === "SELL" && finalDecision === "SELL";
    const msBiasConflict =
      (ms.bias === "SELL" && finalDecision === "BUY") ||
      (ms.bias === "BUY"  && finalDecision === "SELL");

    if (msBiasConflict) {
      blockers.push(`ممنوع التنفيذ: هيكل السوق (${ms.bias}) يعاكس القرار (${finalDecision})`);
    } else if (msBiasBuy || msBiasSell) {
      reasons.push(`هيكل السوق يدعم القرار (${ms.trendState}/${ms.bias}) ✓`);
    }

    if ((ms.trendState === "RANGE" || ms.trendState === "TRANSITION") && isMarketOrder) {
      blockers.push(
        ms.trendState === "RANGE"
          ? "ممنوع التنفيذ: هيكل السوق RANGE مع أمر Market — خطر الدخول في نطاق"
          : "ممنوع التنفيذ: هيكل السوق في مرحلة تحوّل — ترقب اتجاه الكسر أولاً",
      );
    } else if (ms.trendState === "RANGE" && !isMarketOrder) {
      warnings.push("السوق في نطاق — الأوامر Pending أكثر ملاءمة من Market في هذه الحالة");
    }
  } else {
    warnings.push("هيكل السوق غير متوفر — سيتم تجاوز فحص Market Structure");
  }

  // ── هـ) الشموع والسيولة ───────────────────────────────────────────────────
  if (cs) {
    const csBiasConflict =
      (cs.bias === "SELL" && result.direction === "bullish") ||
      (cs.bias === "BUY"  && result.direction === "bearish");

    if (csBiasConflict && cs.confidence >= 40) {
      blockers.push(
        `ممنوع التنفيذ: الشموع تعاكس قرار الـ${result.direction === "bullish" ? "شراء" : "بيع"} (bias: ${cs.bias})`,
      );
    } else if (csBiasConflict) {
      warnings.push(`انحياز الشموع (${cs.bias}) عكس القرار — ثقة منخفضة ${cs.confidence}%`);
    }

    if (cs.quality === "SUSPICIOUS") {
      blockers.push("ممنوع التنفيذ: جودة الشمعة مريبة — حركة غير اعتيادية");
    } else if (cs.quality === "WEAK") {
      // BLOCK only if there's also a strong opposing pattern
      const opposingDir = result.direction === "bullish" ? "SELL" : "BUY";
      const strongOpposing = cs.patterns.filter(
        (p) => p.direction === opposingDir && p.strength >= 75,
      );
      if (strongOpposing.length > 0) {
        blockers.push(
          `ممنوع التنفيذ: شمعة ضعيفة مع ${strongOpposing.length} نمط انعكاسي قوي (قوة ≥75)`,
        );
      } else {
        warnings.push("جودة الشمعة ضعيفة — الإشارة غير مؤكدة");
      }
    }

    // Strong opposing pin bar or engulfing
    const opposingDir2 = result.direction === "bullish" ? "SELL" : "BUY";
    const strongReversal = cs.patterns.filter(
      (p) =>
        p.direction === opposingDir2 &&
        p.strength >= 80 &&
        (p.type === "PIN_BAR_BULLISH"    ||
         p.type === "PIN_BAR_BEARISH"    ||
         p.type === "BULLISH_ENGULFING"  ||
         p.type === "BEARISH_ENGULFING"  ||
         p.type === "LIQUIDITY_SWEEP_HIGH" ||
         p.type === "LIQUIDITY_SWEEP_LOW"),
    );
    if (strongReversal.length > 0 && !blockers.some((b) => b.includes("شمعة"))) {
      blockers.push(
        `ممنوع التنفيذ: نمط انعكاسي قوي ضد القرار (${strongReversal[0]!.type}, قوة ${strongReversal[0]!.strength})`,
      );
    }

    // Doji / Inside Bar only warning
    const hasNeutralOnly =
      cs.patterns.every((p) => p.type === "DOJI" || p.type === "INSIDE_BAR" || p.direction === "NEUTRAL");
    if (hasNeutralOnly && cs.patterns.length > 0 && !blockers.length) {
      warnings.push("Doji أو Inside Bar — تردد في السوق، لا إشارة اتجاهية واضحة");
    }

    if (cs.fakeoutDetected) {
      const fakeAgainstDecision =
        (cs.patterns.some((p) => p.type === "FAKE_BREAKOUT_UP") && finalDecision === "BUY") ||
        (cs.patterns.some((p) => p.type === "FAKE_BREAKOUT_DOWN") && finalDecision === "SELL");
      if (fakeAgainstDecision) {
        blockers.push("ممنوع التنفيذ: كسر وهمي ضد اتجاه القرار — خطر انعكاس");
      } else {
        warnings.push("كسر وهمي مكتشف — تحقق من اتجاه الإغلاق");
      }
    }
  } else {
    warnings.push("تحليل الشموع غير متوفر — سيتم تجاوز فحص Candlestick");
  }

  // ── و) الزخم ──────────────────────────────────────────────────────────────
  if (ind) {
    const isWeakMomentum = ind.momentumBias !== "strong";
    const tf = result.selectedTimeframe ?? "";
    const isShortTF  = ["M1", "M5", "M15"].includes(tf);
    const isMediumTF = ["H1", "H4"].includes(tf);

    if (isWeakMomentum && isMarketOrder && isShortTF) {
      blockers.push(
        `ممنوع التنفيذ: الزخم ضعيف على ${tf} مع أمر Market — خطر الدخول بدون قوة`,
      );
    } else if (isWeakMomentum && isMediumTF) {
      warnings.push(`الزخم ضعيف على ${tf} — الحركة قد تكون بطيئة`);
    } else if (!isWeakMomentum) {
      reasons.push("الزخم قوي ✓");
    }
  }

  // ── ز) SL مقابل ATR ───────────────────────────────────────────────────────
  if (result.entry !== undefined && result.stopLoss !== undefined && ind?.atr14) {
    const slDist = Math.abs(result.entry - result.stopLoss);
    const atr    = ind.atr14;
    const isXAU  = result.symbol.includes("XAU") || result.symbol.includes("GOLD");

    // XAU stricter thresholds: 0.7 BLOCK, 1.0 WARN
    const blockRatio = isXAU ? 0.7 : 0.5;
    const warnRatio  = isXAU ? 1.0 : 0.8;

    if (slDist < blockRatio * atr) {
      blockers.push(
        `ممنوع التنفيذ: وقف الخسارة ضيق مقارنة بالـ ATR — SL: ${slDist.toFixed(5)} | ATR: ${atr.toFixed(5)} | نسبة: ${(slDist / atr).toFixed(2)}×${isXAU ? " (XAU: الحد 0.7×)" : ""}`,
      );
    } else if (slDist < warnRatio * atr) {
      warnings.push(
        `وقف الخسارة قريب من ATR — SL/ATR: ${(slDist / atr).toFixed(2)}× (الحد الموصى به ${warnRatio}×)`,
      );
    } else {
      reasons.push(`SL/ATR: ${(slDist / atr).toFixed(2)}× — مقبول ✓`);
    }
  }

  // ── ط) مناطق العرض والطلب — B3 ──────────────────────────────────────────────
  const za = result.zonesAnalysis;
  if (za && za.confidence > 0) {
    const INSIDE_PCT = 0.15;

    // BLOCK: BUY inside strong Supply
    if (finalDecision === "BUY") {
      const insideSupply = za.activeZones.find(
        (z) => z.direction === "SELL" && z.distanceFromCurrent <= INSIDE_PCT && z.strength >= 65,
      );
      if (insideSupply) {
        blockers.push(`ممنوع التنفيذ: الشراء داخل منطقة ${insideSupply.type} قوية (strength: ${insideSupply.strength})`);
      }
    }

    // BLOCK: SELL inside strong Demand
    if (finalDecision === "SELL") {
      const insideDemand = za.activeZones.find(
        (z) => z.direction === "BUY" && z.distanceFromCurrent <= INSIDE_PCT && z.strength >= 65,
      );
      if (insideDemand) {
        blockers.push(`ممنوع التنفيذ: البيع داخل منطقة ${insideDemand.type} قوية (strength: ${insideDemand.strength})`);
      }
    }

    // BLOCK: Market order in MID of Range
    if (za.inPremiumDiscount === "MID" && isMarketOrder) {
      blockers.push("ممنوع التنفيذ: أمر Market في منتصف النطاق — لا أفضلية واضحة");
    }

    // WARN: no supporting zone for the direction
    const hasSupporting = za.activeZones.some((z) => {
      const aligned =
        (finalDecision === "BUY"  && z.direction === "BUY")  ||
        (finalDecision === "SELL" && z.direction === "SELL");
      return aligned && !z.mitigated;
    });
    if (!hasSupporting) {
      warnings.push("لا توجد منطقة مؤسسية تدعم الاتجاه الحالي — توافق المناطق ضعيف");
    } else {
      reasons.push(`مناطق مؤسسية تدعم القرار (${za.activeZones.filter(z => (finalDecision === "BUY" ? z.direction === "BUY" : z.direction === "SELL")).length} منطقة) ✓`);
    }

    // WARN: Premium/Discount misalignment
    if (finalDecision === "BUY" && za.inPremiumDiscount === "PREMIUM") {
      warnings.push("الشراء في منطقة Premium — سعر مرتفع نسبياً");
    }
    if (finalDecision === "SELL" && za.inPremiumDiscount === "DISCOUNT") {
      warnings.push("البيع في منطقة Discount — سعر منخفض نسبياً");
    }
  } else {
    warnings.push("مناطق العرض والطلب غير متوفرة — سيتم تجاوز فحص B3");
  }

  // ── ك) Fibonacci — B4 ────────────────────────────────────────────────────
  const fa = result.fibonacciAnalysis;
  if (fa && fa.confidence > 0) {
    const fibConflict =
      (finalDecision === "BUY"  && fa.bias === "SELL") ||
      (finalDecision === "SELL" && fa.bias === "BUY");

    const fibSupports =
      (finalDecision === "BUY"  && (fa.bias === "BUY"  || fa.inGoldenZone && fa.goldenZone.direction === "BUY"))  ||
      (finalDecision === "SELL" && (fa.bias === "SELL" || fa.inGoldenZone && fa.goldenZone.direction === "SELL"));

    // BLOCK: Fibonacci + Zone strongly against decision
    if (fibConflict && fa.confluenceWithZones && fa.inGoldenZone) {
      blockers.push("ممنوع التنفيذ: Fibonacci + Zone B3 يعارضان القرار بوضوح (Golden Zone عكسية)");
    } else if (fibConflict) {
      warnings.push(`Fibonacci (${fa.bias}) يعارض القرار (${finalDecision}) — مراجعة موصى بها`);
    }

    // WARN: swing UNKNOWN
    if (fa.swing.direction === "UNKNOWN") {
      warnings.push("Fibonacci للمراقبة فقط — اتجاه Swing غير مؤكد، لا يُعتمد عليه للدخول");
    }

    // WARN: Range + Mid + no Fib support
    if (result.marketStructure?.trendState === "RANGE" && !fa.confluenceWithZones && !fa.inGoldenZone) {
      warnings.push("سوق نطاق — Fibonacci لا يدعم الدخول بدون Zone داعمة");
    }

    // Positive note if Fibonacci supports
    if (fibSupports && fa.inGoldenZone) {
      reasons.push("Fibonacci Golden Zone يدعم القرار ✓");
    }
  }

  // ── ل) توافق الفريمات — B5 ────────────────────────────────────────────────
  const mtf = result.multiTimeframeConsensus;
  if (mtf) {
    if (mtf.verdict === "BLOCK") {
      for (const b of mtf.blockers.slice(0, 2)) {
        blockers.push(`ممنوع التنفيذ (توافق الفريمات): ${b}`);
      }
    } else if (mtf.verdict === "WARN") {
      for (const w of mtf.warnings.slice(0, 2)) {
        warnings.push(w);
      }
    } else {
      reasons.push(`توافق الفريمات ${mtf.alignmentScore}% يدعم القرار ✓`);
    }
  } else {
    warnings.push("توافق الفريمات غير محسوب — تحقق من مزامنة H4/H1/M30/M15");
  }

  // ── م) الأخبار والحماية — B6.2 ────────────────────────────────────────────
  const nc = result.newsProtectionCommittee;
  if (nc) {
    if (nc.verdict === "BLOCK") {
      for (const b of nc.blockers.slice(0, 2)) {
        blockers.push(`ممنوع التنفيذ (لجنة الأخبار): ${b}`);
      }
    } else if (nc.verdict === "WARN") {
      for (const w of nc.warnings.slice(0, 2)) {
        warnings.push(`تحذير أخبار: ${w}`);
      }
    } else if (nc.verdict === "WATCH" && nc.matchedNewsCount > 0) {
      warnings.push(`أخبار مرتبطة بالرمز تحت المراقبة (${nc.matchedNewsCount})`);
    } else if (nc.verdict === "PASS") {
      reasons.push("لا أخبار مؤثرة مرتبطة بالرمز حالياً ✓");
    }
  }

  // ── ح) هامش من آخر response ───────────────────────────────────────────────
  if (
    lastOrderResult?.marginRequired != null &&
    lastOrderResult?.freeMarginBefore != null &&
    lastOrderResult.freeMarginBefore > 0
  ) {
    const marginRatio = lastOrderResult.marginRequired / lastOrderResult.freeMarginBefore;
    if (marginRatio > 0.30) {
      blockers.push(
        `ممنوع التنفيذ: استخدام الهامش مرتفع ${(marginRatio * 100).toFixed(0)}% من الهامش المتاح (الحد 30%)`,
      );
    } else if (marginRatio > 0.20) {
      warnings.push(
        `استخدام الهامش ${(marginRatio * 100).toFixed(0)}% — مراقبة موصى بها`,
      );
    } else {
      reasons.push(`الهامش ${(marginRatio * 100).toFixed(0)}% من المتاح ✓`);
    }
  } else {
    warnings.push("الهامش غير متاح في هذه المرحلة — سيتم فحصه في backend عند الإرسال");
  }

  // ── النتيجة النهائية ──────────────────────────────────────────────────────
  const allowed = blockers.length === 0;
  const score   = Math.max(0, Math.min(100,
    100 - blockers.length * 25 - warnings.length * 8,
  ));
  const status: PriceActionExecutionGuard["status"] =
    blockers.length > 0 ? "BLOCK" : warnings.length > 0 ? "WARN" : "PASS";

  return { allowed, status, score, reasons, blockers, warnings };
}

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

  // A27: سجل محاولات التنفيذ — non-blocking — لا يمنع عرض النتيجة
  const { isAuthenticated } = useConvexAuth();
  const recordAttempt = useMutation(api.demoExecutionJournal.recordDemoExecutionAttempt);
  const recentAttempts = useQuery(
    api.demoExecutionJournal.listMyDemoExecutionAttempts,
    isAuthenticated ? { limit: 5 } : "skip",
  );
  const [journalStatus, setJournalStatus] = useState<string | null>(null);

  const summary = buildDecisionSummary(result);
  const preview = buildTradeOrderPreview(result, summary);

  // A26.5: manual lot override — يُهيَّأ من estimatedLot ويتيح التعديل اليدوي
  const [manualLot, setManualLot] = useState<number>(
    preview.estimatedLot ?? 0.01,
  );
  const eligibility = buildExecutionEligibility(
    preview,
    settings,
    { spreadPoints: result.currentSpreadPoints },
  );

  // B2.1: حارس Price Action — يُعاد حسابه عند تغيّر orderResult (للهامش)
  const priceActionGuard = buildPriceActionExecutionGuard(
    result, summary, preview, orderResult,
  );

  // A26.1: زر المراجعة يُفعَّل فقط عند اكتمال جميع الشروط + DEMO_ARMED + حارس B2.1
  const canOpenReview =
    preview.allowed &&
    eligibility.eligible &&
    priceActionGuard.allowed &&
    settings.executionMode === "DEMO_ARMED" &&
    !settings.killSwitchEnabled &&
    settings.isConfirmedDemo;

  // A26.2/A26.5.1: يمكن الإرسال فقط بعد checkbox + جميع الشروط + manualLot صالح
  const manualLotInvalid = !(manualLot > 0);
  const canSend = canOpenReview && userConfirmed && !ordering && !manualLotInvalid;

  // A26.2: إرسال أمر Demo إلى MT5 — Demo فقط — بعد تأكيد يدوي
  async function handleSendToMT5Demo() {
    if (!canSend || !priceActionGuard.allowed) return; // belt-and-suspenders B2.1
    setOrdering(true);
    setOrderResult(null);
    setOrderError(null);
    setJournalStatus(null);

    let attemptStatus: string = "ERROR";
    let attemptData: DemoOrderResult | null = null;
    let attemptErrorMsg: string | null = null;

    try {
      const execReq = buildExecutionRequestPreview(result, preview, eligibility);
      // A26.5.1: دائماً أرسل manualLot — لا يُمرَّر userId
      const body = {
        ...execReq,
        manualConfirmation: true as const,
        manualLot: manualLot > 0 ? manualLot : execReq.estimatedLot,
      };
      const res = await fetch("/api/mt5-demo/order-send", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        cache:   "no-store",
      });
      const data = (await res.json()) as DemoOrderResult;
      attemptData = data;
      if (data.ok || data.accepted) {
        attemptStatus = "DONE";
        setOrderResult(data);
        setUserConfirmed(false); // إعادة تعيين التأكيد بعد الإرسال
      } else if (data.retcodeText === "NO_MONEY_PRECHECK") {
        attemptStatus = "PRECHECK_FAILED";
        // عرض تفاصيل الهامش — لم يصل الطلب إلى order_send
        setOrderResult(data);
      } else {
        attemptStatus = "REJECTED";
        setOrderError(data.error ?? "فشل إرسال الأمر إلى MT5");
        attemptErrorMsg = data.error ?? null;
      }
    } catch (e) {
      attemptStatus = "ERROR";
      attemptErrorMsg = e instanceof Error ? e.message : "خطأ غير معروف في الإرسال";
      setOrderError(attemptErrorMsg);
    } finally {
      setOrdering(false);
    }

    // A27: تسجيل المحاولة في Convex — non-blocking — لا يمنع عرض النتيجة
    if (isAuthenticated) {
      void recordAttempt({
        platform:        "MT5",
        accountMode:     "DEMO_ONLY",
        decisionId:      undefined,
        symbol:          result.symbol,
        orderType:       preview.orderType,
        direction:       result.direction ?? undefined,
        requestedLot:    manualLot > 0 ? manualLot : preview.estimatedLot,
        status:          attemptStatus,
        ok:              attemptData?.ok ?? false,
        accepted:        attemptData?.accepted,
        ticket:          attemptData?.ticket,
        retcode:         attemptData?.retcode,
        retcodeText:     attemptData?.retcodeText,
        errorMessage:    attemptErrorMsg ?? undefined,
        marginRequired:  attemptData?.marginRequired ?? undefined,
        marginFree:      attemptData?.freeMarginBefore,
        marginFreeAfter: undefined,
        fillingMode:     attemptData?.fillingModeUsed,
        fillingRetries:  attemptData?.fillingModesTried != null
                           ? attemptData.fillingModesTried.length - 1
                           : undefined,
      }).then(() => setJournalStatus("✓ سُجِّلت المحاولة في السجل"))
        .catch(() => setJournalStatus("⚠ لم يُسجَّل في Convex"));
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">

      {/* B2.2: Header — يعكس حالة الحارس بوضوح */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-sm font-bold ${priceActionGuard.status === "BLOCK" ? "text-red-300" : "text-foreground"}`}>
          مراجعة أمر التداول — Demo Preview
          {priceActionGuard.status === "BLOCK" && <span className="ms-1">— محظور ✗</span>}
        </p>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          priceActionGuard.status === "BLOCK"
            ? "border-red-500/30 bg-red-500/10 text-red-300"
            : priceActionGuard.status === "WARN"
              ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
        }`}>
          {priceActionGuard.status === "BLOCK"
            ? "ممنوع التنفيذ ✗"
            : priceActionGuard.status === "WARN"
              ? "تحذيرات تنفيذ ⚠"
              : "جاهز للمراجعة ✓"}
        </span>
      </div>

      {/* Allowed → تفاصيل الأمر */}
      {preview.allowed ? (
        <>
          {/* B2.2: banner — حالة شروط التنفيذ */}
          <div className={`rounded-md border px-3 py-2 text-xs ${
            priceActionGuard.status === "BLOCK"
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : priceActionGuard.status === "WARN"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}>
            {priceActionGuard.status === "BLOCK"
              ? "✗ ممنوع التنفيذ — حارس جودة التنفيذ رفض الصفقة"
              : priceActionGuard.status === "WARN"
                ? "⚠ الشروط الأساسية متحققة لكن توجد تحذيرات — راجع حارس الجودة أدناه"
                : "✓ شروط التنفيذ والتحليل متوافقة — يمكن فتح المراجعة التجريبية"}
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

          {/* ── B2.1: حارس جودة التنفيذ ──────────────────────────────────────── */}
          <div className={`rounded-md border px-3 py-2.5 text-xs space-y-1.5 ${
            priceActionGuard.status === "BLOCK"
              ? "border-red-500/40 bg-red-500/8"
              : priceActionGuard.status === "WARN"
                ? "border-amber-500/30 bg-amber-500/8"
                : "border-emerald-500/30 bg-emerald-500/8"
          }`}>
            <div className="flex items-center justify-between">
              <span className={`font-bold text-sm ${
                priceActionGuard.status === "BLOCK" ? "text-red-300" :
                priceActionGuard.status === "WARN"  ? "text-amber-300" : "text-emerald-300"
              }`}>
                حارس جودة التنفيذ — {priceActionGuard.status}
              </span>
              <span className="font-mono text-muted-foreground/60 text-[10px]">
                نقاط: {priceActionGuard.score}
              </span>
            </div>
            {priceActionGuard.blockers.length > 0 && (
              <ul className="space-y-0.5">
                {priceActionGuard.blockers.map((b, i) => (
                  <li key={i} className="text-red-300/90 font-medium">✗ {b}</li>
                ))}
              </ul>
            )}
            {priceActionGuard.warnings.length > 0 && (
              <ul className="space-y-0.5">
                {priceActionGuard.warnings.map((w, i) => (
                  <li key={i} className="text-amber-300/80">⚠ {w}</li>
                ))}
              </ul>
            )}
            {priceActionGuard.reasons.length > 0 && priceActionGuard.status !== "BLOCK" && (
              <ul className="space-y-0.5">
                {priceActionGuard.reasons.slice(0, 3).map((r, i) => (
                  <li key={i} className="text-emerald-300/70">✓ {r}</li>
                ))}
              </ul>
            )}
          </div>

          {/* A26.1: أزرار التنفيذ */}
          <div className="flex flex-wrap items-center gap-3">
            {/* زر مراجعة طلب التنفيذ — enabled فقط عند DEMO_ARMED + جميع الشروط + حارس B2.1 */}
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
                      { label: "اللوت المحسوب", val: execReq.estimatedLot?.toFixed(2) ?? "—", cls: "font-mono" },
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

                  {/* A26.5.1: اللوت اليدوي مع badge "معدّل يدوياً" */}
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/5 px-4 py-2 text-xs">
                    <span className="text-muted-foreground">اللوت للتنفيذ</span>
                    <span className="flex items-center gap-1.5 font-mono font-bold text-foreground">
                      {manualLot > 0 ? manualLot.toFixed(2) : "—"}
                      {manualLot > 0 && manualLot !== (execReq.estimatedLot ?? 0) && (
                        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[10px] font-medium text-amber-300">
                          معدّل يدوياً
                        </span>
                      )}
                    </span>
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

                  {/* A26.5.1: تعديل اللوت قبل الإرسال */}
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-amber-200/90">تعديل اللوت قبل الإرسال</p>
                      <button
                        type="button"
                        onClick={() => setManualLot(preview.estimatedLot ?? 0.01)}
                        className="text-[10px] text-amber-300/70 hover:text-amber-300 underline underline-offset-2"
                      >
                        إعادة للمحسوب ({(preview.estimatedLot ?? 0.01).toFixed(2)})
                      </button>
                    </div>
                    <input
                      type="number"
                      value={manualLot}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) setManualLot(v);
                      }}
                      min={0.01}
                      step={0.01}
                      className={`w-full rounded border px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 ${
                        manualLotInvalid
                          ? "border-red-500/50 bg-red-500/10 focus:ring-red-500/40"
                          : "border-border bg-muted/10 focus:ring-amber-500/40"
                      }`}
                    />
                    {manualLotInvalid && (
                      <p className="text-xs text-red-400">⚠ اللوت اليدوي غير صالح — يجب أن يكون أكبر من 0</p>
                    )}
                    {!manualLotInvalid && manualLot !== (preview.estimatedLot ?? 0.01) && (
                      <p className="text-[10px] text-amber-300/70">
                        ⚠ اللوت معدّل يدوياً — لا يغيّر قرار اللجان، للتنفيذ فقط.
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/50">
                      هذا التعديل للتنفيذ فقط ولا يغيّر نتيجة التحليل أو قرار اللجان.
                    </p>
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

                  {/* B2.1: حارس التنفيذ داخل الـ modal — belt-and-suspenders */}
                  {!priceActionGuard.allowed && (
                    <div className="rounded-md border border-red-500/50 bg-red-500/10 px-4 py-3 space-y-1">
                      <p className="text-xs font-bold text-red-300">⛔ حارس جودة التنفيذ — BLOCK</p>
                      {priceActionGuard.blockers.map((b, i) => (
                        <p key={i} className="text-xs text-red-300/80">✗ {b}</p>
                      ))}
                      <p className="text-[10px] text-muted-foreground/60 pt-1">
                        لإلغاء الحظر: وسّع وقف الخسارة، أو انتظر إشارة تقنية أقوى، أو راجع درجة القرار.
                      </p>
                    </div>
                  )}

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

                  {/* A26.5.1: تنبيه اللوت غير صالح قرب زر الإرسال */}
                  {manualLotInvalid && (
                    <p className="text-xs text-red-400">⚠ اللوت اليدوي غير صالح — عدّله في قسم "تعديل اللوت" أعلاه</p>
                  )}

                  {/* A26.4/A26.5: رفض precheck الهامش */}
                  {orderResult && orderResult.retcodeText === "NO_MONEY_PRECHECK" && (
                    <div className="rounded-md border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-xs text-orange-200 space-y-2">
                      <p className="font-semibold text-sm text-orange-300">✗ الهامش غير كافٍ — لم يُرسل الأمر</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <p>الهامش المطلوب: <span className="font-mono font-bold">{orderResult.marginRequired?.toFixed(2) ?? "—"}</span></p>
                        <p>الهامش المتاح:  <span className="font-mono font-bold text-emerald-300">{orderResult.freeMarginBefore?.toFixed(2) ?? "—"}</span></p>
                        <p>النقص:          <span className="font-mono text-red-300">{orderResult.marginShortfall?.toFixed(2) ?? "—"}</span></p>
                        <p>اللوت المرسل:  <span className="font-mono">{orderResult.execLotRequested?.toFixed(2) ?? "—"}</span></p>
                        {orderResult.balance != null && (
                          <p>الرصيد: <span className="font-mono">{orderResult.balance.toFixed(2)}</span></p>
                        )}
                        {orderResult.equity != null && (
                          <p>حقوق الملكية: <span className="font-mono">{orderResult.equity.toFixed(2)}</span></p>
                        )}
                      </div>
                      {orderResult.suggestedMaxLot != null ? (
                        <>
                          <p className="text-amber-300">
                            اللوت المقترح: <span className="font-mono font-bold">{orderResult.suggestedMaxLot}</span>
                            {orderResult.suggestedLotReason && (
                              <span className="text-orange-200/60 ms-1">({orderResult.suggestedLotReason})</span>
                            )}
                          </p>
                          {/* A26.5.1: زر استخدام اللوت المقترح مباشرةً في قسم الخطأ */}
                          <button
                            type="button"
                            onClick={() => {
                              setManualLot(orderResult.suggestedMaxLot!);
                              setOrderResult(null);
                              setOrderError(null);
                              setUserConfirmed(false);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors"
                          >
                            ← استخدام اللوت المقترح: {orderResult.suggestedMaxLot}
                          </button>
                        </>
                      ) : orderResult.suggestedLotReason && (
                        <p className="text-orange-200/70">{orderResult.suggestedLotReason}</p>
                      )}
                      <p className="text-orange-200/60 text-[10px]">
                        اضغط "استخدام اللوت المقترح" أعلاه ثم أعد الختم وأرسل مجدداً.
                      </p>
                    </div>
                  )}

                  {/* A26.2/A26.3/A26.4: نتيجة الإرسال — نجاح */}
                  {orderResult && orderResult.retcodeText !== "NO_MONEY_PRECHECK" && (
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
                      {orderResult.marginRequired != null && (
                        <p className="text-emerald-300/60">
                          هامش مستخدم: {orderResult.marginRequired?.toFixed(2)} — متاح قبل: {orderResult.freeMarginBefore?.toFixed(2)}
                        </p>
                      )}
                      {orderResult.marginPrecheckUnavailable && (
                        <p className="text-amber-400/60">⚠ فحص الهامش المسبق غير متاح</p>
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

      {/* A27: حالة تسجيل المحاولة في Convex */}
      {journalStatus && (
        <p className="text-[10px] text-muted-foreground/70">{journalStatus}</p>
      )}

      {/* A27: آخر محاولات تنفيذ Demo */}
      {recentAttempts && recentAttempts.length > 0 && (
        <div className="rounded-md border border-border bg-muted/5 p-3 space-y-2">
          <p className="text-xs font-semibold text-foreground/80">آخر محاولات تنفيذ Demo</p>
          <div className="space-y-1.5">
            {recentAttempts.map((a) => (
              <div
                key={a._id}
                className="flex items-center justify-between gap-2 rounded border border-border px-2.5 py-1.5 text-[11px]"
              >
                <span className="font-mono text-muted-foreground">
                  {new Date(a.createdAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="font-mono text-foreground">{a.symbol}</span>
                <span className={
                  a.status === "DONE"             ? "text-emerald-400" :
                  a.status === "PRECHECK_FAILED"  ? "text-orange-400"  :
                  a.status === "REJECTED"         ? "text-red-400"     :
                                                    "text-zinc-400"
                }>
                  {a.status === "DONE"            ? "✓ نجاح"           :
                   a.status === "PRECHECK_FAILED" ? "✗ هامش"           :
                   a.status === "REJECTED"        ? "✗ مرفوض"          :
                                                    "✗ خطأ"}
                </span>
                {a.ticket != null && (
                  <span className="font-mono text-emerald-300/70">#{a.ticket}</span>
                )}
                {a.retcodeText && a.status !== "DONE" && (
                  <span className="text-muted-foreground/60 truncate max-w-[100px]">{a.retcodeText}</span>
                )}
              </div>
            ))}
          </div>
        </div>
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

                {/* B2.2: حالة التحليل (منفصلة عن حالة التنفيذ) */}
                <div className="flex flex-wrap gap-4">
                  <Stat label="الزوج" value={result.symbol} />
                  {/* حالة التحليل — تأخذ في الحسبان guard + summary معاً */}
                  {(() => {
                    const s  = buildDecisionSummary(result);
                    const p  = buildTradeOrderPreview(result, s);
                    const g  = buildPriceActionExecutionGuard(result, s, p, null);
                    const ds = deriveAnalysisDisplayStatus(result, s, g);
                    const toneClass =
                      ds.tone === "success" ? "text-emerald-400" :
                      ds.tone === "warning" ? "text-amber-400"   :
                      ds.tone === "danger"  ? "text-red-400"     :
                                              "text-sky-400";
                    return (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">حالة التحليل</span>
                        <span className={`text-sm font-semibold ${toneClass}`}>{ds.label}</span>
                        <span className="text-[10px] text-muted-foreground/65 leading-tight max-w-[280px]">{ds.description}</span>
                      </div>
                    );
                  })()}
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

                {/* ── B3.2: حالة السوق وجودة البيانات ─────────────────────── */}
                {result.marketStateAnalysis && (
                  <MarketStateSection msa={result.marketStateAnalysis} />
                )}

                {/* ── B1: هيكل السوق ───────────────────────────────────────── */}
                {result.marketStructure && (
                  <MarketStructureSection ms={result.marketStructure} />
                )}

                {/* ── B2: تحليل الشموع والسيولة ────────────────────────────── */}
                {result.candlestickAnalysis && (
                  <CandlestickSection cs={result.candlestickAnalysis} />
                )}

                {/* ── B3: مناطق العرض والطلب والفجوات ─────────────────────── */}
                {result.zonesAnalysis && (
                  <ZonesSection za={result.zonesAnalysis} />
                )}

                {/* ── B4: توافق Fibonacci ───────────────────────────────────── */}
                {result.fibonacciAnalysis && (
                  <FibonacciSection fa={result.fibonacciAnalysis} />
                )}

                {/* ── B5: توافق الفريمات ────────────────────────────────────── */}
                {result.multiTimeframeConsensus && (
                  <MTFSection mtf={result.multiTimeframeConsensus} />
                )}

                {/* ── B6.2: لجنة الأخبار والحماية ─────────────────────────── */}
                {result.newsProtectionCommittee && (
                  <NewsSentinelSection nc={result.newsProtectionCommittee} />
                )}

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
