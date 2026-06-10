/**
 * candlestick-analysis.ts — B2
 * Pure candlestick, wick rejection, fakeout and liquidity sweep engine.
 * No trading execution — no order_send — read-only analysis.
 * Works server-side and client-side (no Next.js / Convex imports).
 */

import type { OHLCCandle, MarketStructureAnalysis } from "./market-structure";

// --- Types --------------------------------------------------------------------

export type CandlePatternType =
  | "BULLISH_ENGULFING"
  | "BEARISH_ENGULFING"
  | "PIN_BAR_BULLISH"
  | "PIN_BAR_BEARISH"
  | "DOJI"
  | "STRONG_BULLISH_CLOSE"
  | "STRONG_BEARISH_CLOSE"
  | "INSIDE_BAR"
  | "LIQUIDITY_SWEEP_HIGH"
  | "LIQUIDITY_SWEEP_LOW"
  | "FAKE_BREAKOUT_UP"
  | "FAKE_BREAKOUT_DOWN";

export type CandlePattern = {
  type:        CandlePatternType;
  direction:   "BUY" | "SELL" | "NEUTRAL";
  strength:    number;       // 0–100
  candleIndex: number;       // index in the original candles array
  time:        number;
  price:       number;       // reference price (close of the candle)
  reason:      string;
};

export type LatestCandleQuality = {
  bodySize:         number;
  upperWick:        number;
  lowerWick:        number;
  candleRange:      number;
  bodyToRangeRatio: number;
  wickToBodyRatio:  number;
  isBullish:        boolean;
};

export type WickRejection = {
  detected:  boolean;
  direction: "BUY" | "SELL" | null;
  ratio:     number;          // wick-to-body ratio that triggered
  reason:    string;
};

export type CandlestickAnalysis = {
  bias:                   "BUY" | "SELL" | "NEUTRAL";
  quality:                "STRONG" | "NORMAL" | "WEAK" | "SUSPICIOUS";
  patterns:               CandlePattern[];
  latestCandleQuality:    LatestCandleQuality | null;
  wickRejection:          WickRejection;
  fakeoutDetected:        boolean;
  liquiditySweepDetected: boolean;
  confidence:             number;     // 0–100
  reasons:                string[];
  warnings:               string[];
};

// --- Internal candle metrics --------------------------------------------------

type CandleMetrics = {
  isBullish:        boolean;
  bodyTop:          number;
  bodyBot:          number;
  bodySize:         number;
  upperWick:        number;
  lowerWick:        number;
  candleRange:      number;
  midpoint:         number;
  bodyToRangeRatio: number;
  wickToBodyRatio:  number;
};

function getCandleMetrics(c: OHLCCandle): CandleMetrics {
  const isBullish   = c.close >= c.open;
  const bodyTop     = Math.max(c.open, c.close);
  const bodyBot     = Math.min(c.open, c.close);
  const bodySize    = bodyTop - bodyBot;
  const upperWick   = c.high - bodyTop;
  const lowerWick   = bodyBot - c.low;
  const candleRange = c.high - c.low;
  const midpoint    = c.low + candleRange / 2;
  const bodyToRangeRatio = candleRange > 0 ? bodySize / candleRange : 0;
  const wickToBodyRatio  = bodySize > 0 ? (upperWick + lowerWick) / bodySize : 99;
  return { isBullish, bodyTop, bodyBot, bodySize, upperWick, lowerWick, candleRange, midpoint, bodyToRangeRatio, wickToBodyRatio };
}

// --- ATR14 --------------------------------------------------------------------

function computeATR14(candles: OHLCCandle[]): number {
  if (candles.length < 2) return 0;
  const period = Math.min(14, candles.length - 1);
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur  = candles[i]!;
    sum += Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low  - prev.close),
    );
  }
  return sum / period;
}

// --- Single-candle pattern detection -----------------------------------------

function detectSingleCandlePatterns(
  c: OHLCCandle,
  idx: number,
  m: CandleMetrics,
  atr: number,
): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  if (m.candleRange < atr * 0.1) return patterns; // ignore micro candles

  // -- Pin Bar Bullish ---------------------------------------------------------
  // Long lower wick (≥2.5× body), small upper wick (<1× body), close above midpoint
  if (
    m.lowerWick >= 2.5 * Math.max(m.bodySize, atr * 0.005) &&
    m.upperWick < m.bodySize * 1.2 &&
    c.close >= m.midpoint
  ) {
    const strength = Math.min(92, 65 + Math.round((m.lowerWick / m.candleRange) * 40));
    patterns.push({
      type: "PIN_BAR_BULLISH", direction: "BUY", strength,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `Pin Bar صاعد — ذيل سفلي ${(m.lowerWick / m.candleRange * 100).toFixed(0)}% من المدى`,
    });
  }

  // -- Pin Bar Bearish ---------------------------------------------------------
  if (
    m.upperWick >= 2.5 * Math.max(m.bodySize, atr * 0.005) &&
    m.lowerWick < m.bodySize * 1.2 &&
    c.close <= m.midpoint
  ) {
    const strength = Math.min(92, 65 + Math.round((m.upperWick / m.candleRange) * 40));
    patterns.push({
      type: "PIN_BAR_BEARISH", direction: "SELL", strength,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `Pin Bar هابط — ذيل علوي ${(m.upperWick / m.candleRange * 100).toFixed(0)}% من المدى`,
    });
  }

  // -- Doji --------------------------------------------------------------------
  if (m.bodyToRangeRatio < 0.08 && m.candleRange >= atr * 0.3) {
    patterns.push({
      type: "DOJI", direction: "NEUTRAL", strength: 35,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `Doji — جسم ${(m.bodyToRangeRatio * 100).toFixed(1)}% من المدى — تردد في السوق`,
    });
  }

  // -- Strong Bullish Close ----------------------------------------------------
  if (
    m.isBullish &&
    m.bodyToRangeRatio >= 0.60 &&
    c.close >= c.high - m.candleRange * 0.25 &&
    m.candleRange >= atr * 0.5
  ) {
    const strength = Math.min(88, 55 + Math.round(m.bodyToRangeRatio * 40));
    patterns.push({
      type: "STRONG_BULLISH_CLOSE", direction: "BUY", strength,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `إغلاق صاعد قوي — جسم ${(m.bodyToRangeRatio * 100).toFixed(0)}% من المدى`,
    });
  }

  // -- Strong Bearish Close ----------------------------------------------------
  if (
    !m.isBullish &&
    m.bodyToRangeRatio >= 0.60 &&
    c.close <= c.low + m.candleRange * 0.25 &&
    m.candleRange >= atr * 0.5
  ) {
    const strength = Math.min(88, 55 + Math.round(m.bodyToRangeRatio * 40));
    patterns.push({
      type: "STRONG_BEARISH_CLOSE", direction: "SELL", strength,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `إغلاق هابط قوي — جسم ${(m.bodyToRangeRatio * 100).toFixed(0)}% من المدى`,
    });
  }

  return patterns;
}

// --- Two-candle pattern detection --------------------------------------------

function detectTwoCandlePatterns(
  prev: OHLCCandle,
  curr: OHLCCandle,
  currIdx: number,
  prevM: CandleMetrics,
  currM: CandleMetrics,
  atr: number,
): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  if (currM.candleRange < atr * 0.1 || prevM.candleRange < atr * 0.1) return patterns;

  const prevBodyTop = prevM.bodyTop;
  const prevBodyBot = prevM.bodyBot;

  // -- Bullish Engulfing -------------------------------------------------------
  // Previous bearish, current bullish, current body fully engulfs previous body
  if (
    !prevM.isBullish &&
    currM.isBullish &&
    curr.open <= prevBodyBot &&
    curr.close >= prevBodyTop &&
    currM.bodySize > prevM.bodySize * 1.0
  ) {
    const ratio = prevM.bodySize > 0 ? currM.bodySize / prevM.bodySize : 1;
    const strength = Math.min(90, 72 + Math.round(ratio * 5));
    patterns.push({
      type: "BULLISH_ENGULFING", direction: "BUY", strength,
      candleIndex: currIdx, time: curr.time, price: curr.close,
      reason: `Bullish Engulfing — الجسم يبتلع السابق بنسبة ${ratio.toFixed(2)}×`,
    });
  }

  // -- Bearish Engulfing -------------------------------------------------------
  if (
    prevM.isBullish &&
    !currM.isBullish &&
    curr.open >= prevBodyTop &&
    curr.close <= prevBodyBot &&
    currM.bodySize > prevM.bodySize * 1.0
  ) {
    const ratio = prevM.bodySize > 0 ? currM.bodySize / prevM.bodySize : 1;
    const strength = Math.min(90, 72 + Math.round(ratio * 5));
    patterns.push({
      type: "BEARISH_ENGULFING", direction: "SELL", strength,
      candleIndex: currIdx, time: curr.time, price: curr.close,
      reason: `Bearish Engulfing — الجسم يبتلع السابق بنسبة ${ratio.toFixed(2)}×`,
    });
  }

  // -- Inside Bar --------------------------------------------------------------
  if (curr.high < prev.high && curr.low > prev.low) {
    patterns.push({
      type: "INSIDE_BAR", direction: "NEUTRAL", strength: 42,
      candleIndex: currIdx, time: curr.time, price: curr.close,
      reason: `Inside Bar — ضغط السعر داخل الشمعة السابقة — ترقب الكسر`,
    });
  }

  return patterns;
}

// --- Liquidity sweep + fake breakout -----------------------------------------

function detectSweepAndFakeout(
  c: OHLCCandle,
  idx: number,
  ms: MarketStructureAnalysis | undefined,
): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  if (!ms) return patterns;

  const { lastSwingHigh, lastSwingLow, rangeDetected, rangeHigh, rangeLow } = ms;

  // -- Liquidity Sweep High ----------------------------------------------------
  if (lastSwingHigh && c.high > lastSwingHigh.price && c.close < lastSwingHigh.price) {
    patterns.push({
      type: "LIQUIDITY_SWEEP_HIGH", direction: "SELL", strength: 85,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `Liquidity Sweep High — اخترق ${lastSwingHigh.price.toFixed(5)} ثم أُغلق تحته`,
    });
  }

  // -- Liquidity Sweep Low -----------------------------------------------------
  if (lastSwingLow && c.low < lastSwingLow.price && c.close > lastSwingLow.price) {
    patterns.push({
      type: "LIQUIDITY_SWEEP_LOW", direction: "BUY", strength: 85,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `Liquidity Sweep Low — اخترق ${lastSwingLow.price.toFixed(5)} ثم أُغلق فوقه`,
    });
  }

  // -- Fake Breakout Up (range boundary or swing) -----------------------------
  const breakRef = rangeDetected && rangeHigh != null
    ? rangeHigh
    : lastSwingHigh?.price;

  if (
    breakRef !== undefined &&
    c.high > breakRef &&
    c.close < breakRef &&
    // don't double-count as liquidity sweep
    !patterns.some((p) => p.type === "LIQUIDITY_SWEEP_HIGH")
  ) {
    patterns.push({
      type: "FAKE_BREAKOUT_UP", direction: "SELL", strength: 80,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `Fake Breakout Up — اخترق ${breakRef.toFixed(5)} ثم رجع — كسر وهمي صاعد`,
    });
  }

  // -- Fake Breakout Down ------------------------------------------------------
  const breakRefLow = rangeDetected && rangeLow != null
    ? rangeLow
    : lastSwingLow?.price;

  if (
    breakRefLow !== undefined &&
    c.low < breakRefLow &&
    c.close > breakRefLow &&
    !patterns.some((p) => p.type === "LIQUIDITY_SWEEP_LOW")
  ) {
    patterns.push({
      type: "FAKE_BREAKOUT_DOWN", direction: "BUY", strength: 80,
      candleIndex: idx, time: c.time, price: c.close,
      reason: `Fake Breakout Down — اخترق ${breakRefLow.toFixed(5)} ثم رجع — كسر وهمي هابط`,
    });
  }

  return patterns;
}

// --- Bias derivation ----------------------------------------------------------

function deriveBias(
  patterns: CandlePattern[],
  n: number,
): { bias: CandlestickAnalysis["bias"]; reasons: string[] } {
  // Recency weight: patterns on the last candle get 1.0, earlier get 0.6
  let buyScore  = 0;
  let sellScore = 0;
  const reasons: string[] = [];

  for (const p of patterns) {
    const recency = p.candleIndex >= n - 1 ? 1.0 : 0.6;
    const w = p.strength * recency;
    if (p.direction === "BUY")  buyScore  += w;
    if (p.direction === "SELL") sellScore += w;
  }

  const delta = Math.abs(buyScore - sellScore);
  const threshold = 30;

  if (delta < threshold) return { bias: "NEUTRAL", reasons: ["إشارات متقاربة — انحياز محايد"] };
  if (buyScore > sellScore) {
    reasons.push(`إشارات شرائية راجحة (${buyScore.toFixed(0)} vs ${sellScore.toFixed(0)})`);
    return { bias: "BUY", reasons };
  }
  reasons.push(`إشارات بيعية راجحة (${sellScore.toFixed(0)} vs ${buyScore.toFixed(0)})`);
  return { bias: "SELL", reasons };
}

// --- Quality of the latest candle ---------------------------------------------

function assessQuality(
  m: CandleMetrics,
  fakeout: boolean,
  sweep: boolean,
): CandlestickAnalysis["quality"] {
  if (fakeout || sweep) return "SUSPICIOUS";
  if (m.bodyToRangeRatio >= 0.60) return "STRONG";
  if (m.bodyToRangeRatio >= 0.30) return "NORMAL";
  return "WEAK";
}

// --- Wick rejection -----------------------------------------------------------

function assessWickRejection(m: CandleMetrics): WickRejection {
  const MIN_RATIO = 2.0; // wick must be at least 2x the body

  if (m.bodySize === 0) {
    return { detected: false, direction: null, ratio: 0, reason: "جسم صفري" };
  }

  const lowerRatio = m.lowerWick / m.bodySize;
  const upperRatio = m.upperWick / m.bodySize;

  if (lowerRatio >= MIN_RATIO && lowerRatio > upperRatio) {
    return {
      detected: true,
      direction: "BUY",
      ratio: lowerRatio,
      reason: `رفض سفلي — الذيل السفلي ${lowerRatio.toFixed(1)}× الجسم`,
    };
  }
  if (upperRatio >= MIN_RATIO && upperRatio > lowerRatio) {
    return {
      detected: true,
      direction: "SELL",
      ratio: upperRatio,
      reason: `رفض علوي — الذيل العلوي ${upperRatio.toFixed(1)}× الجسم`,
    };
  }
  return { detected: false, direction: null, ratio: 0, reason: "لا رفض واضح" };
}

// --- Confidence ---------------------------------------------------------------

function computeConfidence(
  patterns: CandlePattern[],
  fakeout: boolean,
  sweep: boolean,
): number {
  let score = 30;
  const strongPatterns = patterns.filter((p) => p.strength >= 75);
  score += Math.min(30, strongPatterns.length * 12);
  score += Math.min(15, (patterns.length - strongPatterns.length) * 5);
  if (fakeout || sweep) score += 15;
  // Conflicting signals reduce confidence
  const hasBuy  = patterns.some((p) => p.direction === "BUY");
  const hasSell = patterns.some((p) => p.direction === "SELL");
  if (hasBuy && hasSell) score -= 12;
  return Math.max(10, Math.min(90, score));
}

// --- Main entry point ---------------------------------------------------------

export function analyzeCandlestick(
  candles: OHLCCandle[],
  ms?: MarketStructureAnalysis,
): CandlestickAnalysis {
  const warnings: string[] = [];

  if (candles.length < 2) {
    return {
      bias: "NEUTRAL", quality: "WEAK", patterns: [],
      latestCandleQuality: null,
      wickRejection: { detected: false, direction: null, ratio: 0, reason: "بيانات غير كافية" },
      fakeoutDetected: false, liquiditySweepDetected: false,
      confidence: 0,
      reasons: ["شموع غير كافية لتحليل Candlestick"],
      warnings: ["يجب توفر ≥ 2 شمعة"],
    };
  }

  const atr       = computeATR14(candles);
  const n         = candles.length;
  const scanStart = Math.max(1, n - 6); // scan last 5 candles (need prev for pairs)
  const allPatterns: CandlePattern[] = [];

  for (let i = scanStart; i < n; i++) {
    const c    = candles[i]!;
    const prev = candles[i - 1]!;
    const m    = getCandleMetrics(c);
    const mPrev = getCandleMetrics(prev);

    // Single-candle patterns
    allPatterns.push(...detectSingleCandlePatterns(c, i, m, atr));

    // Two-candle patterns
    allPatterns.push(...detectTwoCandlePatterns(prev, c, i, mPrev, m, atr));

    // Sweep + fakeout only on last 3 candles
    if (i >= n - 3) {
      allPatterns.push(...detectSweepAndFakeout(c, i, ms));
    }
  }

  // -- Latest candle metrics -------------------------------------------------
  const lastC = candles[n - 1]!;
  const lastM = getCandleMetrics(lastC);

  const latestCandleQuality: LatestCandleQuality = {
    bodySize:         lastM.bodySize,
    upperWick:        lastM.upperWick,
    lowerWick:        lastM.lowerWick,
    candleRange:      lastM.candleRange,
    bodyToRangeRatio: lastM.bodyToRangeRatio,
    wickToBodyRatio:  lastM.wickToBodyRatio,
    isBullish:        lastM.isBullish,
  };

  // -- Sweep / fakeout flags -------------------------------------------------
  const fakeoutDetected =
    allPatterns.some((p) => p.type === "FAKE_BREAKOUT_UP" || p.type === "FAKE_BREAKOUT_DOWN");
  const liquiditySweepDetected =
    allPatterns.some((p) => p.type === "LIQUIDITY_SWEEP_HIGH" || p.type === "LIQUIDITY_SWEEP_LOW");

  // -- Wick rejection --------------------------------------------------------
  const wickRejection = assessWickRejection(lastM);

  // -- Quality ---------------------------------------------------------------
  const quality = assessQuality(lastM, fakeoutDetected, liquiditySweepDetected);

  // -- Bias ------------------------------------------------------------------
  const { bias, reasons: biasReasons } = deriveBias(allPatterns, n);

  // -- Reasons ---------------------------------------------------------------
  const reasons: string[] = [...biasReasons];
  const significant = allPatterns
    .filter((p) => p.strength >= 65)
    .slice(-4);
  for (const p of significant) {
    reasons.push(p.reason);
  }
  if (wickRejection.detected) reasons.push(wickRejection.reason);
  if (allPatterns.length === 0) reasons.push("لا أنماط شموع واضحة في آخر 5 شموع");

  // -- Warnings --------------------------------------------------------------
  if (fakeoutDetected)        warnings.push("⚠ كسر وهمي محتمل — السعر اخترق مستوى ثم تراجع");
  if (liquiditySweepDetected) warnings.push("⚠ سحب سيولة محتمل — تحقق من اتجاه الإغلاق");
  if (quality === "SUSPICIOUS") warnings.push("⚠ شمعة مريبة — حركة غير اعتيادية");
  if (quality === "WEAK" && allPatterns.filter(p => p.direction !== "NEUTRAL").length === 0) {
    warnings.push("شمعة ضعيفة — لا إشارة اتجاهية واضحة");
  }

  // -- Confidence ------------------------------------------------------------
  const confidence = computeConfidence(allPatterns, fakeoutDetected, liquiditySweepDetected);

  return {
    bias,
    quality,
    patterns: allPatterns.slice(-12),   // cap for JSON size
    latestCandleQuality,
    wickRejection,
    fakeoutDetected,
    liquiditySweepDetected,
    confidence,
    reasons:  reasons.slice(0, 8),
    warnings: warnings.slice(0, 5),
  };
}
