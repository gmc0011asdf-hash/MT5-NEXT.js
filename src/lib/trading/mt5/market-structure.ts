/**
 * market-structure.ts — B1
 * Pure market structure analysis engine.
 * No trading execution — no order_send — read-only analysis.
 * Works server-side and client-side (no Next.js / Convex imports).
 */

// --- Input type ---------------------------------------------------------------

export type OHLCCandle = {
  time:  number;
  open:  number;
  high:  number;
  low:   number;
  close: number;
};

// --- Output types -------------------------------------------------------------

export type MarketSwing = {
  index:    number;    // position in candles array
  time:     number;
  price:    number;    // high value for HIGH swings, low value for LOW swings
  type:     "HIGH" | "LOW";
  strength: number;    // how far it protrudes above/below neighbors (price units)
};

export type StructurePoint = {
  type:       "HH" | "HL" | "LH" | "LL";
  price:      number;
  time:       number;
  swingIndex: number;  // index in the swings[] array
};

export type MarketStructureAnalysis = {
  trendState:     "BULLISH" | "BEARISH" | "RANGE" | "TRANSITION";
  bias:           "BUY" | "SELL" | "NEUTRAL";
  swings:         MarketSwing[];
  structurePoints: StructurePoint[];
  lastSwingHigh:  MarketSwing | null;
  lastSwingLow:   MarketSwing | null;
  bosDirection:   "UP" | "DOWN" | null;
  chochDirection: "UP" | "DOWN" | null;
  rangeDetected:  boolean;
  rangeHigh:      number | null;
  rangeLow:       number | null;
  confidence:     number;           // 0–100
  reasons:        string[];
  warnings:       string[];
};

// --- ATR14 --------------------------------------------------------------------

function computeATR14(candles: OHLCCandle[]): number {
  if (candles.length < 2) return 0;
  const period = Math.min(14, candles.length - 1);
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur  = candles[i]!;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low  - prev.close),
    );
    sum += tr;
  }
  return sum / period;
}

// --- Swing detection ---------------------------------------------------------

function detectSwings(candles: OHLCCandle[], lookback: number): MarketSwing[] {
  const swings: MarketSwing[] = [];
  const n   = candles.length;
  const atr = computeATR14(candles);
  const minStrength = atr > 0 ? atr * 0.3 : 0;

  for (let i = lookback; i < n - lookback; i++) {
    const c = candles[i]!;

    // -- swing HIGH: c.high strictly greater than all neighbours --------------
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback && isHigh; j++) {
      if (j !== i && candles[j]!.high >= c.high) isHigh = false;
    }
    if (isHigh) {
      // strength = how far c.high exceeds the average of neighbour highs
      let neighborAvg = 0;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i) neighborAvg += candles[j]!.high;
      }
      neighborAvg /= lookback * 2;
      const strength = c.high - neighborAvg;
      if (strength >= minStrength) {
        swings.push({ index: i, time: c.time, price: c.high, type: "HIGH", strength });
      }
    }

    // -- swing LOW: c.low strictly less than all neighbours -------------------
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback && isLow; j++) {
      if (j !== i && candles[j]!.low <= c.low) isLow = false;
    }
    if (isLow) {
      let neighborAvg = 0;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i) neighborAvg += candles[j]!.low;
      }
      neighborAvg /= lookback * 2;
      const strength = neighborAvg - c.low;
      if (strength >= minStrength) {
        swings.push({ index: i, time: c.time, price: c.low, type: "LOW", strength });
      }
    }
  }

  return swings; // already chronological (candles oldest-first)
}

// --- Structure classification (HH / HL / LH / LL) ----------------------------

function classifyStructure(swings: MarketSwing[]): StructurePoint[] {
  const highs = swings.filter((s) => s.type === "HIGH");
  const lows  = swings.filter((s) => s.type === "LOW");
  const points: StructurePoint[] = [];

  for (let i = 1; i < highs.length; i++) {
    const prev = highs[i - 1]!;
    const curr = highs[i]!;
    const type: "HH" | "LH" = curr.price > prev.price ? "HH" : "LH";
    const swingIndex = swings.indexOf(curr);
    points.push({ type, price: curr.price, time: curr.time, swingIndex });
  }

  for (let i = 1; i < lows.length; i++) {
    const prev = lows[i - 1]!;
    const curr = lows[i]!;
    const type: "HL" | "LL" = curr.price > prev.price ? "HL" : "LL";
    const swingIndex = swings.indexOf(curr);
    points.push({ type, price: curr.price, time: curr.time, swingIndex });
  }

  return points.sort((a, b) => a.time - b.time);
}

// --- Trend determination ------------------------------------------------------

function determineTrend(points: StructurePoint[]): {
  trendState: "BULLISH" | "BEARISH" | "RANGE";
  reasons: string[];
} {
  const reasons: string[] = [];

  if (points.length < 2) {
    return { trendState: "RANGE", reasons: ["هيكل السوق غير مكتمل — نقاط غير كافية"] };
  }

  const recentPoints = points.slice(-8);

  const recentHighTypes = recentPoints
    .filter((p) => p.type === "HH" || p.type === "LH")
    .slice(-3)
    .map((p) => p.type);

  const recentLowTypes = recentPoints
    .filter((p) => p.type === "HL" || p.type === "LL")
    .slice(-3)
    .map((p) => p.type);

  const lastTwoHighs = recentHighTypes.slice(-2);
  const lastTwoLows  = recentLowTypes.slice(-2);

  const strongBullish =
    lastTwoHighs.length === 2 &&
    lastTwoHighs.every((t) => t === "HH") &&
    lastTwoLows.length === 2 &&
    lastTwoLows.every((t) => t === "HL");

  const strongBearish =
    lastTwoHighs.length === 2 &&
    lastTwoHighs.every((t) => t === "LH") &&
    lastTwoLows.length === 2 &&
    lastTwoLows.every((t) => t === "LL");

  if (strongBullish) {
    reasons.push("HH + HL مؤكدان — ترند صاعد قوي");
    return { trendState: "BULLISH", reasons };
  }
  if (strongBearish) {
    reasons.push("LH + LL مؤكدان — ترند هابط قوي");
    return { trendState: "BEARISH", reasons };
  }

  const hasHH = recentHighTypes.includes("HH");
  const hasLH = recentHighTypes.includes("LH");
  const hasHL = recentLowTypes.includes("HL");
  const hasLL = recentLowTypes.includes("LL");

  if (hasHH && hasHL && !hasLH && !hasLL) {
    reasons.push("HH + HL ظاهران — ترند صاعد متوسط");
    return { trendState: "BULLISH", reasons };
  }
  if (hasLH && hasLL && !hasHH && !hasHL) {
    reasons.push("LH + LL ظاهران — ترند هابط متوسط");
    return { trendState: "BEARISH", reasons };
  }

  if (hasHH && hasLL) {
    reasons.push("قمم مرتفعة وقيعان منخفضة معاً — سوق متذبذب أو نطاق");
  } else {
    const hStr = recentHighTypes.join(",") || "—";
    const lStr = recentLowTypes.join(",")  || "—";
    reasons.push(`هيكل مختلط — قمم: ${hStr} | قيعان: ${lStr}`);
  }
  return { trendState: "RANGE", reasons };
}

// --- BOS and CHoCH detection --------------------------------------------------

function detectBOSAndCHoCH(
  lastClose: number,
  swings: MarketSwing[],
  trendState: "BULLISH" | "BEARISH" | "RANGE",
): { bosDirection: "UP" | "DOWN" | null; chochDirection: "UP" | "DOWN" | null } {
  const highs = swings.filter((s) => s.type === "HIGH");
  const lows  = swings.filter((s) => s.type === "LOW");

  if (highs.length === 0 || lows.length === 0) {
    return { bosDirection: null, chochDirection: null };
  }

  // Use second-to-last swing to avoid comparing against the freshest (still forming)
  const refHigh = highs.length >= 2 ? highs[highs.length - 2]! : highs[highs.length - 1]!;
  const refLow  = lows.length  >= 2 ? lows[lows.length  - 2]!  : lows[lows.length  - 1]!;

  let bosDirection: "UP" | "DOWN" | null   = null;
  let chochDirection: "UP" | "DOWN" | null = null;

  if (lastClose > refHigh.price) {
    if (trendState === "BULLISH") bosDirection   = "UP";   // continuation
    else                          chochDirection = "UP";   // reversal signal
  }

  if (lastClose < refLow.price) {
    if (trendState === "BEARISH") bosDirection   = "DOWN"; // continuation
    else                          chochDirection = "DOWN"; // reversal signal
  }

  // If both fired (price broke both levels), prioritise BOS for trend direction
  if (bosDirection && chochDirection) {
    if (trendState === "BULLISH") chochDirection = null;
    else if (trendState === "BEARISH") chochDirection = null;
    else bosDirection = null; // RANGE: CHoCH is more actionable
  }

  return { bosDirection, chochDirection };
}

// --- Range detection ----------------------------------------------------------

function detectRange(swings: MarketSwing[]): {
  rangeDetected: boolean;
  rangeHigh: number | null;
  rangeLow: number | null;
} {
  const highs = swings.filter((s) => s.type === "HIGH").slice(-4);
  const lows  = swings.filter((s) => s.type === "LOW").slice(-4);

  if (highs.length < 2 || lows.length < 2) {
    return { rangeDetected: false, rangeHigh: null, rangeLow: null };
  }

  const maxHigh = Math.max(...highs.map((s) => s.price));
  const minHigh = Math.min(...highs.map((s) => s.price));
  const maxLow  = Math.max(...lows.map((s) => s.price));
  const minLow  = Math.min(...lows.map((s) => s.price));

  const midHigh = (maxHigh + minHigh) / 2;
  const midLow  = (maxLow  + minLow)  / 2;

  const highVariation = midHigh > 0 ? (maxHigh - minHigh) / midHigh : 1;
  const lowVariation  = midLow  > 0 ? (maxLow  - minLow)  / midLow  : 1;

  const isRange = highVariation < 0.006 && lowVariation < 0.006;

  return {
    rangeDetected: isRange,
    rangeHigh: isRange ? maxHigh : null,
    rangeLow:  isRange ? minLow  : null,
  };
}

// --- Confidence score ---------------------------------------------------------

function computeConfidence(
  swingsCount: number,
  structureCount: number,
  trendState: string,
  bosDirection: string | null,
  chochDirection: string | null,
): number {
  let score = 35;
  if (swingsCount >= 10) score += 15;
  else if (swingsCount >= 5) score += 8;
  if (trendState === "BULLISH" || trendState === "BEARISH") score += 20;
  else if (trendState === "RANGE") score -= 5;
  if (bosDirection)   score += 10;
  if (chochDirection) score += 8;
  if (structureCount >= 6) score += 12;
  else if (structureCount >= 3) score += 6;
  return Math.max(10, Math.min(95, score));
}

// --- Main entry point ---------------------------------------------------------

export function analyzeMarketStructure(
  candles: OHLCCandle[],
  lookback = 3,
): MarketStructureAnalysis {
  const reasons:  string[] = [];
  const warnings: string[] = [];

  const minCandles = lookback * 4 + 4;
  if (candles.length < minCandles) {
    return {
      trendState: "RANGE", bias: "NEUTRAL",
      swings: [], structurePoints: [],
      lastSwingHigh: null, lastSwingLow: null,
      bosDirection: null, chochDirection: null,
      rangeDetected: false, rangeHigh: null, rangeLow: null,
      confidence: 0,
      reasons: [`شموع غير كافية لتحليل الهيكل (${candles.length}/${minCandles})`],
      warnings: ["زد عدد الشموع المزامنة للحصول على هيكل السوق"],
    };
  }

  // -- 1. Detect swings ------------------------------------------------------
  const swings = detectSwings(candles, lookback);

  if (swings.length < 4) {
    warnings.push(`عدد pivots قليل (${swings.length}) — قد تحتاج مزيداً من الشموع أو حركة سعرية أوسع`);
  }

  // -- 2. Classify structure -------------------------------------------------
  const structurePoints = classifyStructure(swings);

  // -- 3. Last swings --------------------------------------------------------
  const highs       = swings.filter((s) => s.type === "HIGH");
  const lows        = swings.filter((s) => s.type === "LOW");
  const lastSwingHigh: MarketSwing | null = highs.at(-1) ?? null;
  const lastSwingLow:  MarketSwing | null = lows.at(-1)  ?? null;

  // -- 4. Trend --------------------------------------------------------------
  const { trendState: rawTrend, reasons: trendReasons } = determineTrend(structurePoints);
  reasons.push(...trendReasons);

  // -- 5. BOS / CHoCH --------------------------------------------------------
  const lastClose = candles.at(-1)!.close;
  const { bosDirection, chochDirection } = detectBOSAndCHoCH(lastClose, swings, rawTrend);

  if (bosDirection   === "UP")   reasons.push("BOS UP — كسر هيكلي صاعد مؤكد (continuations)");
  if (bosDirection   === "DOWN") reasons.push("BOS DOWN — كسر هيكلي هابط مؤكد (continuation)");
  if (chochDirection === "UP")   reasons.push("CHoCH UP — تحوّل محتمل من هابط إلى صاعد");
  if (chochDirection === "DOWN") reasons.push("CHoCH DOWN — تحوّل محتمل من صاعد إلى هابط");

  // -- 6. Range --------------------------------------------------------------
  const { rangeDetected, rangeHigh, rangeLow } = detectRange(swings);
  if (rangeDetected) {
    warnings.push(`السوق في نطاق — مقاومة: ${rangeHigh?.toFixed(5)} | دعم: ${rangeLow?.toFixed(5)}`);
  }

  // -- 7. Transition ---------------------------------------------------------
  const trendState: MarketStructureAnalysis["trendState"] =
    chochDirection ? "TRANSITION" : rawTrend;

  // -- 8. Bias ---------------------------------------------------------------
  let bias: MarketStructureAnalysis["bias"];
  if      (chochDirection === "UP"   || (rawTrend === "BULLISH" && bosDirection === "UP"))   bias = "BUY";
  else if (chochDirection === "DOWN" || (rawTrend === "BEARISH" && bosDirection === "DOWN")) bias = "SELL";
  else if (rawTrend === "BULLISH") bias = "BUY";
  else if (rawTrend === "BEARISH") bias = "SELL";
  else                             bias = "NEUTRAL";

  // -- 9. Confidence ---------------------------------------------------------
  const confidence = computeConfidence(
    swings.length, structurePoints.length, rawTrend, bosDirection, chochDirection,
  );

  // -- 10. Summary reasons ---------------------------------------------------
  if (lastSwingHigh) reasons.push(`آخر قمة (SH): ${lastSwingHigh.price.toFixed(5)}`);
  if (lastSwingLow)  reasons.push(`آخر قاع (SL): ${lastSwingLow.price.toFixed(5)}`);
  reasons.push(`pivots: ${swings.length} | نقاط هيكل: ${structurePoints.length}`);

  return {
    trendState,
    bias,
    swings:          swings.slice(-20),          // cap for JSON size
    structurePoints: structurePoints.slice(-20),
    lastSwingHigh,
    lastSwingLow,
    bosDirection,
    chochDirection,
    rangeDetected,
    rangeHigh,
    rangeLow,
    confidence,
    reasons:  reasons.slice(0, 10),
    warnings: warnings.slice(0, 5),
  };
}
