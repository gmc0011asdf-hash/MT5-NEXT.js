/**
 * Stage 5A: Read-only Lab Analysis Preview
 *
 * قراءة فقط — لا يتم تنفيذ أي صفقة.
 * This route computes a trade setup PREVIEW from persisted Convex candles and
 * MT5 symbol properties.  It never calls order_send, order_close, or any trading
 * function.  The response always carries  readOnly: true.
 *
 * Flow:
 *   1. Validate request body.
 *   2. Fetch symbol properties from MT5 local service (for lot calculation).
 *   3. Query Convex for latest candles & compute indicators (via HTTP client).
 *   4. If timeframeMode = "auto", score candidate timeframes and pick the best.
 *   5. Compute entry / SL / TP from latest close + stopPoints / targetPoints.
 *   6. Calculate estimated lot using tick_value / tick_size formula.
 *   7. Return preview — no DB writes, no MT5 mutations.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import {
  analyzeMarketStructure,
  type MarketStructureAnalysis,
} from "@/lib/trading/mt5/market-structure";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

const STALE_THRESHOLD_MS: Record<string, number> = {
  M1:  3  * 60 * 1000,
  M5:  10 * 60 * 1000,
  M15: 30 * 60 * 1000,
  M30: 60 * 60 * 1000,
  H1:  2  * 60 * 60 * 1000,
  H4:  8  * 60 * 60 * 1000,
  D1:  36 * 60 * 60 * 1000,
};

const VALID_TIMEFRAMES = new Set(["M1", "M5", "M15", "M30", "H1", "H4", "D1"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SymbolProps = {
  point: number;
  digits: number;
  spread: number;
  trade_tick_value: number;
  trade_tick_size: number;
  volume_min: number;
  volume_max: number;
  volume_step: number;
  stops_level: number;
  contract_size: number | null;
};

type IndicatorResult = {
  status: string;
  symbol?: string;
  timeframe?: string;
  candleCount?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi14?: number;
  atr14?: number;
  macd?: number;
  macdSignal?: number;
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

type LotValidation = {
  ok: boolean;
  clipped: boolean;
  warnings: string[];
  raw: number;
  normalized: number;
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
  indicators?: IndicatorResult;
  marketStructure?: MarketStructureAnalysis;  // B1
  reasons: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

function normalizeLot(raw: number, min: number, max: number, step: number): LotValidation {
  const warnings: string[] = [];
  if (raw <= 0) {
    warnings.push("estimatedLot <= 0 — riskUsd too small or stopPoints too large");
    return { ok: false, clipped: false, warnings, raw, normalized: 0 };
  }
  let normalized = roundToStep(raw, step > 0 ? step : 0.01);
  let clipped = false;
  if (normalized < min) {
    warnings.push(`lot ${normalized.toFixed(4)} < volume_min ${min} — clipped to min`);
    normalized = min;
    clipped = true;
  }
  if (normalized > max && max > 0) {
    warnings.push(`lot ${normalized.toFixed(4)} > volume_max ${max} — clipped to max`);
    normalized = max;
    clipped = true;
  }
  return { ok: true, clipped, warnings, raw, normalized };
}

function computeLot(
  stopPoints: number,
  riskUsd: number,
  props: SymbolProps,
): { estimatedLot: number; lotValidation: LotValidation; warnings: string[] } {
  const warnings: string[] = [];

  if (props.trade_tick_value <= 0 || props.trade_tick_size <= 0) {
    warnings.push("symbol lacks trade_tick_value / trade_tick_size — lot calculation unavailable");
    return {
      estimatedLot: 0,
      lotValidation: { ok: false, clipped: false, warnings, raw: 0, normalized: 0 },
      warnings,
    };
  }
  if (props.point <= 0) {
    warnings.push("symbol point = 0 — lot calculation unavailable");
    return {
      estimatedLot: 0,
      lotValidation: { ok: false, clipped: false, warnings, raw: 0, normalized: 0 },
      warnings,
    };
  }

  // pointValuePerLot = tick_value * (point / tick_size)
  const pointValuePerLot = props.trade_tick_value * (props.point / props.trade_tick_size);
  const riskPerLot = stopPoints * pointValuePerLot;
  if (riskPerLot <= 0) {
    warnings.push("riskPerLot = 0 — cannot compute lot");
    return {
      estimatedLot: 0,
      lotValidation: { ok: false, clipped: false, warnings, raw: 0, normalized: 0 },
      warnings,
    };
  }
  const rawLot = riskUsd / riskPerLot;
  const lotValidation = normalizeLot(
    rawLot,
    props.volume_min > 0 ? props.volume_min : 0.01,
    props.volume_max > 0 ? props.volume_max : 1000,
    props.volume_step > 0 ? props.volume_step : 0.01,
  );
  return { estimatedLot: lotValidation.normalized, lotValidation, warnings };
}

// ---------------------------------------------------------------------------
// Score a timeframe for "auto" mode
// Higher = better candidate.  Returns null if disqualified.
// ---------------------------------------------------------------------------

function scoreTimeframe(ind: IndicatorResult, now: number, spreadPoints: number): number | null {
  if (ind.status !== "ok") return null;
  if (!ind.candleCount || ind.candleCount < 30) return null;

  const tf = ind.timeframe ?? "";
  const threshold = STALE_THRESHOLD_MS[tf];
  if (threshold !== undefined && ind.candleAgeMs !== undefined && ind.candleAgeMs > threshold) {
    return null; // stale
  }

  let score = 0;

  // Trend alignment — most valuable signal
  if (ind.trendBias === "bullish" || ind.trendBias === "bearish") score += 40;
  else return null; // neutral trend → not a candidate in auto mode

  // Momentum confirmation
  if (ind.momentumBias === "strong") score += 30;
  else score += 5; // weak momentum acceptable but lower score

  // RSI not in extreme zone
  if (ind.rsi14 !== undefined) {
    if (ind.rsi14 > 25 && ind.rsi14 < 75) score += 15;
    else score -= 20; // overbought/oversold
  }

  // More candles = more reliable
  if (ind.candleCount && ind.candleCount >= 200) score += 10;
  else if (ind.candleCount && ind.candleCount >= 100) score += 5;

  // Penalise wide spread relative to ATR
  if (ind.atr14 !== undefined && ind.atr14 > 0 && spreadPoints > 0) {
    const spreadAsPrice = spreadPoints * (ind.ema20 ?? 0) * 0; // placeholder — we only have point spread
    void spreadAsPrice;
    if (spreadPoints > 50) score -= 15;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Fetch symbol properties from local MT5 service
// ---------------------------------------------------------------------------

async function fetchSymbolProps(symbol: string): Promise<SymbolProps | null> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(
      `${MT5_SERVICE_BASE}/readonly/symbols?visibleOnly=false&search=${encodeURIComponent(symbol)}`,
      { signal: controller.signal, cache: "no-store" },
    );
    clearTimeout(id);
    if (!res.ok) return null;
    const body = (await res.json()) as { symbols?: unknown[] };
    const list = Array.isArray(body.symbols) ? body.symbols : [];
    const sym = list.find(
      (s): s is Record<string, unknown> =>
        typeof s === "object" && s !== null && (s as Record<string, unknown>)["name"] === symbol,
    );
    if (!sym) return null;
    const n = (k: string, fb = 0): number => {
      const v = sym[k];
      return typeof v === "number" && Number.isFinite(v) ? v : fb;
    };
    return {
      point:            n("point"),
      digits:           n("digits"),
      spread:           n("spread"),
      trade_tick_value: n("trade_tick_value"),
      trade_tick_size:  n("trade_tick_size"),
      volume_min:       n("volume_min", 0.01),
      volume_max:       n("volume_max", 1000),
      volume_step:      n("volume_step", 0.01),
      stops_level:      n("stops_level"),
      contract_size:    sym["contract_size"] != null ? n("contract_size") : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── parse & validate body ─────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!symbol) {
    return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
  }

  const timeframeMode = body.timeframeMode === "auto" ? "auto" : "manual";
  const manualTimeframe =
    typeof body.timeframe === "string" && VALID_TIMEFRAMES.has(body.timeframe.toUpperCase())
      ? body.timeframe.toUpperCase()
      : null;

  const rawCandidates = Array.isArray(body.candidateTimeframes)
    ? (body.candidateTimeframes as unknown[])
        .filter((t): t is string => typeof t === "string" && VALID_TIMEFRAMES.has(t.toUpperCase()))
        .map((t) => t.toUpperCase())
    : ["M15", "H1", "H4"];

  const candidateTimeframes = rawCandidates.length > 0 ? rawCandidates : ["M15", "H1", "H4"];
  const candleCount = typeof body.candleCount === "number" ? Math.min(Math.max(body.candleCount, 50), 350) : 200;
  const stopPoints = typeof body.stopPoints === "number" ? body.stopPoints : 0;
  const riskUsd = typeof body.riskUsd === "number" ? body.riskUsd : 0;
  const rrRatioInput = typeof body.rrRatio === "number" && body.rrRatio > 0 ? body.rrRatio : null;
  const targetPointsInput = typeof body.targetPoints === "number" && body.targetPoints > 0 ? body.targetPoints : null;
  const riskPercentInput = typeof body.riskPercent === "number" && body.riskPercent > 0 ? body.riskPercent : null;

  if (stopPoints <= 0) {
    return NextResponse.json({ ok: false, error: "stopPoints must be > 0" }, { status: 400 });
  }
  if (riskUsd <= 0) {
    return NextResponse.json({ ok: false, error: "riskUsd must be > 0" }, { status: 400 });
  }
  if (timeframeMode === "manual" && !manualTimeframe) {
    return NextResponse.json({ ok: false, error: "timeframe required for manual mode" }, { status: 400 });
  }

  // ── auth for Convex ───────────────────────────────────────────────────────
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json({ ok: false, error: "NEXT_PUBLIC_CONVEX_URL not configured" }, { status: 503 });
  }
  const session = await auth();
  const token = await session.getToken({ template: "convex" });
  if (!token) {
    return NextResponse.json({ ok: false, error: "not authenticated — sign in first" }, { status: 401 });
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  // ── fetch symbol properties (best-effort, non-blocking) ──────────────────
  const [symbolProps] = await Promise.all([fetchSymbolProps(symbol)]);
  const symbolPropsAvailable = symbolProps !== null;

  // ── determine timeframes to evaluate ─────────────────────────────────────
  const timeframesToEval =
    timeframeMode === "manual" && manualTimeframe ? [manualTimeframe] : candidateTimeframes;

  // ── fetch indicators for each candidate timeframe ────────────────────────
  const indicatorResults: Record<string, IndicatorResult> = {};
  await Promise.all(
    timeframesToEval.map(async (tf) => {
      try {
        const res = await client.query(api.technicalIndicators.computeIndicatorsForSymbol, {
          symbol,
          timeframe: tf,
          candleCount,
        });
        indicatorResults[tf] = res as IndicatorResult;
      } catch {
        indicatorResults[tf] = { status: "error" };
      }
    }),
  );

  // ── select timeframe ──────────────────────────────────────────────────────
  const now = Date.now();
  let selectedTimeframe: string | null = null;
  let bestScore = -Infinity;

  if (timeframeMode === "manual" && manualTimeframe) {
    const ind = indicatorResults[manualTimeframe];
    if (ind?.status === "ok") {
      selectedTimeframe = manualTimeframe;
    }
  } else {
    for (const tf of timeframesToEval) {
      const ind = indicatorResults[tf];
      if (!ind) continue;
      const score = scoreTimeframe(ind, now, symbolProps?.spread ?? 0);
      if (score !== null && score > bestScore) {
        bestScore = score;
        selectedTimeframe = tf;
      }
    }
  }

  // ── B1: fetch raw candles and compute market structure ───────────────────
  let marketStructure: MarketStructureAnalysis | undefined;
  if (selectedTimeframe) {
    try {
      const rawCandles = await client.query(api.mt5CandlesQuery.getCandlesForStructure, {
        symbol,
        timeframe: selectedTimeframe,
        limit: candleCount,
      });
      marketStructure = analyzeMarketStructure(rawCandles);
    } catch {
      // non-blocking — market structure enriches analysis but is not required
    }
  }

  // ── build reasons and warnings ────────────────────────────────────────────
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!symbolPropsAvailable) {
    warnings.push("خصائص الزوج غير متوفرة — تحقق من اتصال خدمة MT5 المحلية");
  }

  // Handle case where no timeframe has sufficient data
  const noDataTimeframes = timeframesToEval.filter(
    (tf) => (indicatorResults[tf]?.status ?? "error") !== "ok",
  );
  if (noDataTimeframes.length === timeframesToEval.length) {
    const result: AnalysisResult = {
      ok: true,
      readOnly: true,
      symbol,
      selectedTimeframe: null,
      evaluatedTimeframes: timeframesToEval,
      status: "insufficient_data",
      stopPoints,
      riskUsd,
      dataQuality: { symbolPropsAvailable, indicatorsAvailable: false },
      freshness: { stale: false },
      reasons: ["لا توجد شموع كافية في قاعدة البيانات — زامن الشموع أولاً عبر /api/mt5-readonly/candles"],
      warnings,
    };
    return NextResponse.json(result);
  }

  if (!selectedTimeframe) {
    reasons.push("لم يتم اختيار إطار زمني — لا توجد فرصة واضحة في الإطارات المرشحة");
    if (timeframeMode === "auto") {
      reasons.push("جميع الإطارات المرشحة إما بيانات ناقصة أو ترند محايد أو قديمة");
    } else if (manualTimeframe) {
      const ind = indicatorResults[manualTimeframe];
      if (ind?.status === "insufficient_data") {
        reasons.push(`عدد الشموع غير كافٍ للإطار ${manualTimeframe} — زامن المزيد من الشموع`);
      } else if (ind?.status === "error" || !ind) {
        reasons.push(`تعذّر حساب المؤشرات للإطار ${manualTimeframe}`);
      }
    }
    const result: AnalysisResult = {
      ok: true,
      readOnly: true,
      symbol,
      selectedTimeframe: null,
      evaluatedTimeframes: timeframesToEval,
      status: "wait",
      stopPoints,
      riskUsd,
      dataQuality: { symbolPropsAvailable, indicatorsAvailable: Object.values(indicatorResults).some((r) => r.status === "ok") },
      freshness: { stale: false },
      reasons,
      warnings,
    };
    return NextResponse.json(result);
  }

  const ind = indicatorResults[selectedTimeframe]!;

  // ── freshness check ───────────────────────────────────────────────────────
  const staleThreshold = STALE_THRESHOLD_MS[selectedTimeframe] ?? 60 * 60 * 1000;
  const candleAgeMs = ind.candleAgeMs ?? Infinity;
  const isStale = candleAgeMs > staleThreshold;
  if (isStale) {
    warnings.push(`بيانات الشموع قديمة للإطار ${selectedTimeframe} — آخر شمعة منذ ${Math.round(candleAgeMs / 60000)} دقيقة`);
  }

  // ── determine direction ───────────────────────────────────────────────────
  const direction: "bullish" | "bearish" | null =
    ind.trendBias === "bullish" ? "bullish" :
    ind.trendBias === "bearish" ? "bearish" :
    null;

  if (!direction) {
    reasons.push("ترند محايد — لا اتجاه واضح للدخول");
    const result: AnalysisResult = {
      ok: true,
      readOnly: true,
      symbol,
      selectedTimeframe,
      evaluatedTimeframes: timeframesToEval,
      status: isStale ? "stale_data" : "wait",
      stopPoints,
      riskUsd,
      dataQuality: { symbolPropsAvailable, indicatorsAvailable: true },
      freshness: { candleAgeMs, stale: isStale },
      indicators: ind,
      reasons,
      warnings,
    };
    return NextResponse.json(result);
  }

  // ── stops_level check ─────────────────────────────────────────────────────
  if (symbolProps && symbolProps.stops_level > 0) {
    const minStopPoints = symbolProps.stops_level;
    if (stopPoints < minStopPoints) {
      warnings.push(`stopPoints ${stopPoints} < stops_level ${minStopPoints} — وقف الخسارة قريب جداً من السعر الحالي`);
    }
  }

  // ── entry / SL / TP ───────────────────────────────────────────────────────
  const entry = ind.lastClose;
  if (entry === undefined || entry <= 0) {
    reasons.push("تعذّر تحديد سعر الدخول — لا توجد شمعة أخيرة");
    const result: AnalysisResult = {
      ok: true,
      readOnly: true,
      symbol,
      selectedTimeframe,
      evaluatedTimeframes: timeframesToEval,
      status: "rejected",
      stopPoints,
      riskUsd,
      dataQuality: { symbolPropsAvailable, indicatorsAvailable: true },
      freshness: { candleAgeMs, stale: isStale },
      indicators: ind,
      reasons,
      warnings,
    };
    return NextResponse.json(result);
  }

  const point = symbolProps?.point ?? 0.00001;
  const targetPoints =
    targetPointsInput ??
    (rrRatioInput ? Math.round(stopPoints * rrRatioInput) : stopPoints * 2);
  const rrRatio = rrRatioInput ?? targetPoints / stopPoints;

  let stopLoss: number;
  let takeProfit: number;

  if (direction === "bullish") {
    stopLoss  = entry - stopPoints  * point;
    takeProfit = entry + targetPoints * point;
  } else {
    stopLoss  = entry + stopPoints  * point;
    takeProfit = entry - targetPoints * point;
  }

  // ── lot calculation ───────────────────────────────────────────────────────
  let estimatedLot: number | undefined;
  let lotValidation: LotValidation | undefined;
  if (symbolProps) {
    const lotResult = computeLot(stopPoints, riskUsd, symbolProps);
    estimatedLot = lotResult.estimatedLot > 0 ? lotResult.estimatedLot : undefined;
    lotValidation = lotResult.lotValidation;
    warnings.push(...lotResult.warnings);
  } else {
    warnings.push("خصائص الزوج غير متوفرة — لا يمكن حساب اللوت");
  }

  // ── spread warning ────────────────────────────────────────────────────────
  if (symbolProps && symbolProps.spread > 0 && symbolProps.spread > stopPoints * 0.2) {
    warnings.push(`السبريد ${symbolProps.spread} نقطة كبير نسبياً مقارنة بالوقف — انتبه للتكلفة`);
  }

  // ── momentum warning ──────────────────────────────────────────────────────
  if (ind.momentumBias !== "strong") {
    warnings.push("الزخم ضعيف — الفرصة ممكنة لكن الحركة قد تكون بطيئة");
  }

  // ── RSI extremes ──────────────────────────────────────────────────────────
  if (ind.rsi14 !== undefined) {
    if (direction === "bullish" && ind.rsi14 > 75) {
      warnings.push(`RSI14 = ${ind.rsi14.toFixed(1)} — منطقة تشبع شرائي، تحقق من التأكيد`);
    } else if (direction === "bearish" && ind.rsi14 < 25) {
      warnings.push(`RSI14 = ${ind.rsi14.toFixed(1)} — منطقة تشبع بيعي، تحقق من التأكيد`);
    }
  }

  reasons.push(
    direction === "bullish"
      ? `ترند صاعد (EMA20 > EMA50 > EMA200) — اتجاه الدخول: شراء`
      : `ترند هابط (EMA20 < EMA50 < EMA200) — اتجاه الدخول: بيع`,
  );
  if (ind.momentumBias === "strong") {
    reasons.push("الزخم قوي (RSI + MACD متوافقان)");
  }

  // ── build final result ────────────────────────────────────────────────────
  const digits = symbolProps?.digits ?? 5;
  const round = (n: number) => parseFloat(n.toFixed(digits));

  // risk % of equity — only if riskPercentInput is given (we don't query Convex for equity here)
  const riskPercentOfEquity =
    riskPercentInput !== null ? riskPercentInput : undefined;

  const status: AnalysisResult["status"] =
    isStale ? "stale_data" : "opportunity";

  const result: AnalysisResult = {
    ok: true,
    readOnly: true,
    symbol,
    selectedTimeframe,
    evaluatedTimeframes: timeframesToEval,
    status,
    direction,
    entry: round(entry),
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    stopPoints,
    targetPoints,
    rrRatio: parseFloat(rrRatio.toFixed(2)),
    riskUsd,
    riskPercentOfEquity,
    estimatedLot,
    lotValidation,
    dataQuality: { symbolPropsAvailable, indicatorsAvailable: true },
    freshness: { candleAgeMs, stale: isStale },
    indicators: {
      status: ind.status,
      symbol: ind.symbol,
      timeframe: ind.timeframe,
      candleCount: ind.candleCount,
      ema20: ind.ema20,
      ema50: ind.ema50,
      ema200: ind.ema200,
      rsi14: ind.rsi14,
      atr14: ind.atr14,
      macd: ind.macd,
      macdHistogram: ind.macdHistogram,
      volatility: ind.volatility,
      recentHigh: ind.recentHigh,
      recentLow: ind.recentLow,
      lastClose: ind.lastClose,
      trendBias: ind.trendBias,
      momentumBias: ind.momentumBias,
      latestCandleTime: ind.latestCandleTime,
      candleAgeMs: ind.candleAgeMs,
    },
    marketStructure,  // B1 — undefined if fetch/compute failed
    reasons,
    warnings,
  };

  return NextResponse.json(result);
}
