/**
 * Stage 5A: Read-only Lab Analysis Preview
 *
 * قراءة فقط — لا يتم تنفيذ أي صفقة.
 * This route computes a trade setup PREVIEW from live MT5 candles (via the
 * local Python bridge) and MT5 symbol properties.  It never calls order_send,
 * order_close, or any trading function.  The response always carries readOnly: true.
 *
 * Flow:
 *   1. Validate request body.
 *   2. Fetch symbol properties from MT5 local service (for lot calculation).
 *   3. Fetch latest candles from the local MT5 bridge & compute indicators.
 *   4. If timeframeMode = "auto", score candidate timeframes and pick the best.
 *   5. Compute entry / SL / TP from latest close + stopPoints / targetPoints.
 *   6. Calculate estimated lot using tick_value / tick_size formula.
 *   7. Return preview — no DB writes, no MT5 mutations.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  analyzeMarketStructure,
  type MarketStructureAnalysis,
} from "@/lib/trading/mt5/market-structure";
import {
  analyzeCandlestick,
  type CandlestickAnalysis,
} from "@/lib/trading/mt5/candlestick-analysis";
import {
  analyzeZones,
  type ZonesAnalysis,
} from "@/lib/trading/mt5/zones-analysis";
import {
  analyzeMarketState,
  type MarketStateAnalysis,
} from "@/lib/trading/mt5/market-state-analysis";
import {
  analyzeFibonacci,
  type FibonacciAnalysis,
} from "@/lib/trading/mt5/fibonacci-analysis";
import {
  analyzeMultiTimeframeConsensus,
  type MultiTimeframeConsensus,
} from "@/lib/trading/mt5/multi-timeframe-consensus";
import {
  type NewsCommitteeResult,
} from "@/lib/trading/mt5/news-protection-committee";

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
  lotSource?: "atr" | "stopPoints";
  dataQuality: { symbolPropsAvailable: boolean; indicatorsAvailable: boolean };
  freshness: { candleAgeMs?: number; stale: boolean };
  indicators?: IndicatorResult;
  marketStateAnalysis?:      MarketStateAnalysis;        // B3.2 (first — guards data quality)
  marketStructure?:          MarketStructureAnalysis;   // B1
  fibonacciAnalysis?:        FibonacciAnalysis;          // B4
  multiTimeframeConsensus?:  MultiTimeframeConsensus;   // B5
  newsProtectionCommittee?:  NewsCommitteeResult;        // B6.2
  candlestickAnalysis?: CandlestickAnalysis;        // B2
  zonesAnalysis?:       ZonesAnalysis;              // B3
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
    if (spreadPoints > 50) score -= 15;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Local-mode helpers — used when no Clerk auth token is available
// ---------------------------------------------------------------------------

async function fetchCandlesFromPython(
  symbol: string,
  timeframe: string,
  count: number,
): Promise<Array<{ time: number; open: number; high: number; low: number; close: number }>> {
  const url = new URL(`${MT5_SERVICE_BASE}/readonly/candles`);
  url.searchParams.set("symbol",    symbol);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("count",     String(count));
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url.toString(), { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(tid);
    if (!r.ok) return [];
    const d = (await r.json()) as { candles?: unknown[] };
    if (!Array.isArray(d.candles)) return [];
    return d.candles.filter(
      (c): c is { time: number; open: number; high: number; low: number; close: number } =>
        typeof c === "object" && c !== null &&
        typeof (c as Record<string, unknown>).time  === "number" &&
        typeof (c as Record<string, unknown>).close === "number",
    );
  } catch {
    clearTimeout(tid);
    return [];
  }
}

function computeMinimalIndicators(
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>,
  timeframe?: string,
): IndicatorResult {
  if (candles.length < 5) return { status: "insufficient_data" };
  // Exclude the current open candle — only completed candles are used for SMA/lastClose/lastCandle.
  // ATR and recentHigh/Low still use the full array for broader context.
  const closedForCalc = candles.slice(0, -1);
  if (closedForCalc.length < 4) return { status: "insufficient_data" };

  const closes = closedForCalc.map((c) => c.close);

  // ATR14 — True Range average (uses all candles for a wider window)
  const trWindow = candles.slice(Math.max(0, candles.length - 15));
  let trSum = 0; let trCount = 0;
  for (let i = 1; i < trWindow.length; i++) {
    const tr = Math.max(
      trWindow[i].high - trWindow[i].low,
      Math.abs(trWindow[i].high - trWindow[i - 1].close),
      Math.abs(trWindow[i].low  - trWindow[i - 1].close),
    );
    trSum += tr; trCount++;
  }
  const atr14 = trCount > 0 ? trSum / trCount : undefined;

  const recent20  = candles.slice(-20);
  const recentHigh = Math.max(...recent20.map((c) => c.high));
  const recentLow  = Math.min(...recent20.map((c) => c.low));
  const lastClose  = closes[closes.length - 1]!;
  const lastCandle = closedForCalc[closedForCalc.length - 1]!;

  const sma20Closes = closes.slice(-20);
  const sma20 = sma20Closes.reduce((a, b) => a + b, 0) / sma20Closes.length;
  const trendBias =
    lastClose > sma20 * 1.001 ? "bullish" :
    lastClose < sma20 * 0.999 ? "bearish" : "neutral";

  return {
    status:          "ok",
    candleCount:     candles.length,
    timeframe,
    atr14,
    recentHigh,
    recentLow,
    lastClose,
    trendBias,
    momentumBias:    "NEUTRAL",
    latestCandleTime: lastCandle.time,
    candleAgeMs:     Date.now() - lastCandle.time,
  };
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
  // -- parse & validate body -------------------------------------------------
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

  // -- local mode: candles & indicators come from the local MT5 bridge -------
  const localMode = true;

  // -- fetch symbol properties (best-effort, non-blocking) ------------------
  const [symbolProps] = await Promise.all([fetchSymbolProps(symbol)]);
  const symbolPropsAvailable = symbolProps !== null;

  // -- determine timeframes to evaluate -------------------------------------
  const timeframesToEval =
    timeframeMode === "manual" && manualTimeframe ? [manualTimeframe] : candidateTimeframes;

  // -- fetch indicators for each candidate timeframe ------------------------
  const indicatorResults: Record<string, IndicatorResult> = {};
  await Promise.all(
    timeframesToEval.map(async (tf) => {
      const candles = await fetchCandlesFromPython(symbol, tf, candleCount);
      indicatorResults[tf] = computeMinimalIndicators(candles, tf);
    }),
  );

  // -- select timeframe ------------------------------------------------------
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

  // -- B3.2/B1/B2/B3: fetch raw candles → state guard → closed candles → analysis --
  let marketStateAnalysis: MarketStateAnalysis | undefined;
  let marketStructure:     MarketStructureAnalysis | undefined;
  let candlestickAnalysis:      CandlestickAnalysis      | undefined;
  let zonesAnalysis:            ZonesAnalysis            | undefined;
  let fibonacciAnalysis:        FibonacciAnalysis        | undefined;
  let multiTimeframeConsensus:  MultiTimeframeConsensus  | undefined;
  let newsProtectionCommittee:  NewsCommitteeResult      | undefined;
  if (selectedTimeframe) {
    let rawCandles: { time: number; open: number; high: number; low: number; close: number }[] = [];
    try {
      rawCandles = await fetchCandlesFromPython(symbol, selectedTimeframe, candleCount);
    } catch {
      // non-blocking — if fetch fails, all analysis is skipped
    }

    if (rawCandles.length >= 3) {
      // -- B3.2: Market state — runs FIRST, provides closedCandles ----------
      let closedCandles: typeof rawCandles = rawCandles;
      try {
        const msa = analyzeMarketState(rawCandles, selectedTimeframe, {
          spreadPoints: symbolProps?.spread,
          symbolName:   symbol,
          currentTime:  Date.now(),
        });
        // Separate closedCandles (internal) from the response-safe object
        const { closedCandles: cc, ...msaForResult } = msa;
        marketStateAnalysis = msaForResult;
        closedCandles = cc.length > 0 ? cc : rawCandles;
      } catch {
        // non-blocking — use rawCandles as fallback
      }

      // -- B1: Market Structure (uses closedCandles) -------------------------
      try {
        marketStructure = analyzeMarketStructure(closedCandles);
      } catch {
        // non-blocking
      }

      // -- B2: Candlestick (uses closedCandles) ------------------------------
      if (closedCandles.length >= 2) {
        try {
          candlestickAnalysis = analyzeCandlestick(closedCandles, marketStructure);
        } catch {
          // non-blocking
        }
      }

      // -- B3: Zones (uses closedCandles) ------------------------------------
      if (closedCandles.length >= 5) {
        try {
          zonesAnalysis = analyzeZones(closedCandles, marketStructure);
        } catch {
          // non-blocking
        }
      }

      // -- B4: Fibonacci (uses closedCandles + B1/B3 data) -------------------
      if (closedCandles.length >= 5) {
        try {
          fibonacciAnalysis = analyzeFibonacci(closedCandles, marketStructure, zonesAnalysis, {
            symbolName: symbol,
          });
        } catch {
          // non-blocking
        }
      }
    }
  }

  // -- B5: Multi-Timeframe Consensus ----------------------------------------
  // Fetch any MTF timeframes not already in indicatorResults, then run consensus.
  try {
    const MTF_TFS = ["M15", "M30", "H1", "H4", "D1"] as const;
    const mtfIndicators: Record<string, { status: string; trendBias?: string; candleCount?: number }> = {
      ...indicatorResults,
    };
    const missing = MTF_TFS.filter((tf) => !mtfIndicators[tf] || mtfIndicators[tf]!.status !== "ok");
    if (missing.length > 0) {
      await Promise.all(
        missing.map(async (tf) => {
          const candles = await fetchCandlesFromPython(symbol, tf, 200);
          const ind = computeMinimalIndicators(candles, tf);
          if (ind.status === "ok") mtfIndicators[tf] = ind;
        }),
      );
    }
    multiTimeframeConsensus = analyzeMultiTimeframeConsensus(
      mtfIndicators,
      selectedTimeframe ?? manualTimeframe ?? "M15",
    );
  } catch {
    // non-blocking
  }

  // -- B6.2: News Protection Committee — لا مصدر أخبار محلي بعد، تُترك undefined
  // (الحقل اختياري في AnalysisResult — لا يؤثر على بقية التحليل)

  // -- build reasons and warnings --------------------------------------------
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
      reasons: [
        localMode
          ? "لا توجد شموع في Python bridge — تأكد من تشغيل خدمة MT5 المحلية وفتح MT5"
          : "لا توجد شموع كافية في قاعدة البيانات — زامن الشموع أولاً عبر /api/mt5-readonly/candles",
      ],
      warnings,
      ...(localMode ? { localMode: true } : {}),
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

  // -- freshness check -------------------------------------------------------
  const staleThreshold = STALE_THRESHOLD_MS[selectedTimeframe] ?? 60 * 60 * 1000;
  const candleAgeMs = ind.candleAgeMs ?? Infinity;
  const isStale = candleAgeMs > staleThreshold;
  if (isStale) {
    warnings.push(`بيانات الشموع قديمة للإطار ${selectedTimeframe} — آخر شمعة منذ ${Math.round(candleAgeMs / 60000)} دقيقة`);
  }

  // -- determine direction ---------------------------------------------------
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

  // -- stops_level check -----------------------------------------------------
  if (symbolProps && symbolProps.stops_level > 0) {
    const minStopPoints = symbolProps.stops_level;
    if (stopPoints < minStopPoints) {
      warnings.push(`stopPoints ${stopPoints} < stops_level ${minStopPoints} — وقف الخسارة قريب جداً من السعر الحالي`);
    }
  }

  // -- entry / SL / TP -------------------------------------------------------
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

  // -- lot calculation (prefer ATR-based to match plans engine) ------------
  let estimatedLot: number | undefined;
  let lotValidation: LotValidation | undefined;
  let lotSource: "atr" | "stopPoints" = "stopPoints";
  if (symbolProps) {
    const atrVal = typeof ind.atr14 === "number" && ind.atr14 > 0 ? ind.atr14 : 0;
    // Use 1.5×ATR (Balanced plan reference) when available — matches plans engine formula
    const atrStopPts = atrVal > 0 && symbolProps.point > 0
      ? Math.round((1.5 * atrVal) / symbolProps.point)
      : 0;
    const effectiveStopPoints = atrStopPts > 0 ? atrStopPts : stopPoints;
    if (atrStopPts > 0) lotSource = "atr";

    const lotResult = computeLot(effectiveStopPoints, riskUsd, symbolProps);
    estimatedLot = lotResult.estimatedLot > 0 ? lotResult.estimatedLot : undefined;
    lotValidation = lotResult.lotValidation;
    warnings.push(...lotResult.warnings);

    // Warn when user stopPoints differs >2× from ATR-based reference
    if (atrStopPts > 0 && stopPoints > 0) {
      const ratio = Math.max(atrStopPts, stopPoints) / Math.min(atrStopPts, stopPoints);
      if (ratio > 2) {
        warnings.push(
          `لوت محسوب من ATR (${atrStopPts} نقطة) — الوقف المدخل (${stopPoints} نقطة) يختلف ×${ratio.toFixed(1)} — استخدام ATR`,
        );
      }
    }
  } else {
    warnings.push("خصائص الزوج غير متوفرة — لا يمكن حساب اللوت");
  }

  // -- spread warning --------------------------------------------------------
  if (symbolProps && symbolProps.spread > 0 && symbolProps.spread > stopPoints * 0.2) {
    warnings.push(`السبريد ${symbolProps.spread} نقطة كبير نسبياً مقارنة بالوقف — انتبه للتكلفة`);
  }

  // -- momentum warning ------------------------------------------------------
  if (ind.momentumBias !== "strong") {
    warnings.push("الزخم ضعيف — الفرصة ممكنة لكن الحركة قد تكون بطيئة");
  }

  // -- RSI extremes ----------------------------------------------------------
  if (ind.rsi14 !== undefined) {
    if (direction === "bullish" && ind.rsi14 > 75) {
      warnings.push(`RSI14 = ${ind.rsi14.toFixed(1)} — منطقة تشبع شرائي، تحقق من التأكيد`);
    } else if (direction === "bearish" && ind.rsi14 < 25) {
      warnings.push(`RSI14 = ${ind.rsi14.toFixed(1)} — منطقة تشبع بيعي، تحقق من التأكيد`);
    }
  }

  reasons.push(
    direction === "bullish"
      ? (localMode ? `ترند صاعد (SMA20) — اتجاه الدخول: شراء`            : `ترند صاعد (EMA20 > EMA50 > EMA200) — اتجاه الدخول: شراء`)
      : (localMode ? `ترند هابط (SMA20) — اتجاه الدخول: بيع`             : `ترند هابط (EMA20 < EMA50 < EMA200) — اتجاه الدخول: بيع`),
  );
  if (ind.momentumBias === "strong") {
    reasons.push("الزخم قوي (RSI + MACD متوافقان)");
  }

  // -- build final result ----------------------------------------------------
  const digits = symbolProps?.digits ?? 5;
  const round = (n: number) => parseFloat(n.toFixed(digits));

  // risk % of equity — only if riskPercentInput is given (equity is not queried here)
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
    lotSource,
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
    marketStateAnalysis,  // B3.2 — undefined if fetch/compute failed
    fibonacciAnalysis,           // B4 — undefined if fetch/compute failed
    multiTimeframeConsensus,     // B5 — undefined if fetch/compute failed
    newsProtectionCommittee,     // B6.2 — undefined if no news or compute failed
    marketStructure,      // B1 — undefined if fetch/compute failed
    candlestickAnalysis,  // B2 — undefined if fetch/compute failed
    zonesAnalysis,        // B3 — undefined if fetch/compute failed
    reasons,
    warnings,
    ...(localMode ? { localMode: true } : {}),
  };

  return NextResponse.json(result);
}
