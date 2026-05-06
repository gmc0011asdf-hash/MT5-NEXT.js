/**
 * zones-analysis.ts — B3
 * Pure Supply/Demand, Order Block and FVG engine.
 * No trading execution — no order_send — read-only analysis.
 */

import type { OHLCCandle, MarketStructureAnalysis } from "./market-structure";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PriceZoneType =
  | "SUPPLY"
  | "DEMAND"
  | "BULLISH_ORDER_BLOCK"
  | "BEARISH_ORDER_BLOCK"
  | "BULLISH_FVG"
  | "BEARISH_FVG"
  | "SUPPORT"
  | "RESISTANCE";

export type PriceZone = {
  id:                  string;
  type:                PriceZoneType;
  direction:           "BUY" | "SELL" | "NEUTRAL";
  low:                 number;
  high:                number;
  midpoint:            number;
  createdAt:           number;       // Unix ms of the candle
  candleIndex:         number;
  strength:            number;       // 0–100
  touched:             boolean;
  mitigated:           boolean;
  distanceFromCurrent: number;       // % from current price
  reason:              string;
};

export type ZonesAnalysis = {
  bias:              "BUY" | "SELL" | "NEUTRAL";
  currentPrice:      number;
  nearestZone:       PriceZone | null;
  nearestDemand:     PriceZone | null;
  nearestSupply:     PriceZone | null;
  activeZones:       PriceZone[];
  fvgZones:          PriceZone[];
  orderBlocks:       PriceZone[];
  inPremiumDiscount: "PREMIUM" | "DISCOUNT" | "MID" | "UNKNOWN";
  confluenceScore:   number;         // 0–100
  confidence:        number;         // 0–100
  reasons:           string[];
  warnings:          string[];
};

// ─── ATR ──────────────────────────────────────────────────────────────────────

function atr14(candles: OHLCCandle[]): number {
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

// ─── Impulse measurement ──────────────────────────────────────────────────────

function impulseMove(candles: OHLCCandle[], startIdx: number, lookAhead: number): number {
  const end = Math.min(startIdx + lookAhead, candles.length - 1);
  if (end <= startIdx) return 0;
  return candles[end]!.close - candles[startIdx]!.close;
}

// ─── Supply / Demand zone detection ──────────────────────────────────────────

function detectSupplyDemandZones(
  candles: OHLCCandle[],
  atr: number,
): PriceZone[] {
  const zones: PriceZone[] = [];
  const IMPULSE_MIN   = atr * 1.5;
  const LOOK_AHEAD    = 4;
  const MAX_ZONE_SIZE = atr * 3;   // zones taller than 3×ATR are noise

  // Only scan the last 120 candles for relevant zones
  const scanStart = Math.max(1, candles.length - 121);

  for (let i = scanStart; i < candles.length - LOOK_AHEAD; i++) {
    const move = impulseMove(candles, i, LOOK_AHEAD);
    const zoneC = candles[i - 1]!;
    const zoneH = zoneC.high;
    const zoneL = zoneC.low;
    if (zoneH - zoneL > MAX_ZONE_SIZE) continue;

    // ── Bullish impulse → Demand zone ───────────────────────────────────────
    if (move >= IMPULSE_MIN) {
      const impulseRatio = move / atr;
      const strength = Math.min(88, 50 + Math.round(impulseRatio * 8));
      zones.push({
        id:          `demand_${i}`,
        type:        "DEMAND",
        direction:   "BUY",
        low:         zoneL,
        high:        zoneH,
        midpoint:    (zoneL + zoneH) / 2,
        createdAt:   zoneC.time,
        candleIndex: i - 1,
        strength,
        touched:     false,
        mitigated:   false,
        distanceFromCurrent: 0,
        reason: `Demand — اندفاع صاعد ${impulseRatio.toFixed(1)}× ATR`,
      });
    }

    // ── Bearish impulse → Supply zone ────────────────────────────────────────
    if (move <= -IMPULSE_MIN) {
      const impulseRatio = Math.abs(move) / atr;
      const strength = Math.min(88, 50 + Math.round(impulseRatio * 8));
      zones.push({
        id:          `supply_${i}`,
        type:        "SUPPLY",
        direction:   "SELL",
        low:         zoneL,
        high:        zoneH,
        midpoint:    (zoneL + zoneH) / 2,
        createdAt:   zoneC.time,
        candleIndex: i - 1,
        strength,
        touched:     false,
        mitigated:   false,
        distanceFromCurrent: 0,
        reason: `Supply — اندفاع هابط ${impulseRatio.toFixed(1)}× ATR`,
      });
    }
  }

  return zones;
}

// ─── Order Block detection ────────────────────────────────────────────────────

function detectOrderBlocks(
  candles: OHLCCandle[],
  atr: number,
  ms: MarketStructureAnalysis | undefined,
): PriceZone[] {
  const zones: PriceZone[] = [];
  const OB_MOVE_MIN = atr * 2.0;
  const LOOK_AHEAD  = 3;

  const scanStart = Math.max(1, candles.length - 121);
  const bosCHoCHUp   = ms?.bosDirection === "UP"   || ms?.chochDirection === "UP";
  const bosCHoCHDown = ms?.bosDirection === "DOWN"  || ms?.chochDirection === "DOWN";

  for (let i = scanStart; i < candles.length - LOOK_AHEAD; i++) {
    const c    = candles[i]!;
    const move = impulseMove(candles, i, LOOK_AHEAD);
    const isBullishC = c.close >= c.open;

    // ── Bullish OB: last bearish candle before bullish move ──────────────────
    if (!isBullishC && move >= OB_MOVE_MIN) {
      let strength = Math.min(85, 55 + Math.round((move / atr) * 8));
      if (bosCHoCHUp) strength = Math.min(92, strength + 10);
      zones.push({
        id:          `bullish_ob_${i}`,
        type:        "BULLISH_ORDER_BLOCK",
        direction:   "BUY",
        low:         c.low,
        high:        c.high,
        midpoint:    (c.low + c.high) / 2,
        createdAt:   c.time,
        candleIndex: i,
        strength,
        touched:     false,
        mitigated:   false,
        distanceFromCurrent: 0,
        reason: `Bullish OB — شمعة هابطة قبل حركة صاعدة ${(move / atr).toFixed(1)}× ATR${bosCHoCHUp ? " + BOS/CHoCH" : ""}`,
      });
    }

    // ── Bearish OB: last bullish candle before bearish move ──────────────────
    if (isBullishC && move <= -OB_MOVE_MIN) {
      let strength = Math.min(85, 55 + Math.round((Math.abs(move) / atr) * 8));
      if (bosCHoCHDown) strength = Math.min(92, strength + 10);
      zones.push({
        id:          `bearish_ob_${i}`,
        type:        "BEARISH_ORDER_BLOCK",
        direction:   "SELL",
        low:         c.low,
        high:        c.high,
        midpoint:    (c.low + c.high) / 2,
        createdAt:   c.time,
        candleIndex: i,
        strength,
        touched:     false,
        mitigated:   false,
        distanceFromCurrent: 0,
        reason: `Bearish OB — شمعة صاعدة قبل حركة هابطة ${(Math.abs(move) / atr).toFixed(1)}× ATR${bosCHoCHDown ? " + BOS/CHoCH" : ""}`,
      });
    }
  }

  return zones;
}

// ─── FVG / Imbalance detection ────────────────────────────────────────────────

function detectFVGs(candles: OHLCCandle[], atr: number): PriceZone[] {
  const zones: PriceZone[] = [];
  const MIN_GAP = atr * 0.2; // gap must be at least 20% of ATR to matter

  const scanStart = Math.max(1, candles.length - 121);

  for (let i = scanStart; i < candles.length - 1; i++) {
    const prev = candles[i - 1]!;
    const curr = candles[i]!;
    const next = candles[i + 1]!;

    // ── Bullish FVG: gap between prev.high and next.low ──────────────────────
    const bullGap = next.low - prev.high;
    if (bullGap >= MIN_GAP) {
      const midBody = Math.abs(curr.close - curr.open);
      const strength = Math.min(82, 45 + Math.round((bullGap / atr) * 30 + midBody / atr * 5));
      zones.push({
        id:          `bullish_fvg_${i}`,
        type:        "BULLISH_FVG",
        direction:   "BUY",
        low:         prev.high,
        high:        next.low,
        midpoint:    (prev.high + next.low) / 2,
        createdAt:   curr.time,
        candleIndex: i,
        strength,
        touched:     false,
        mitigated:   false,
        distanceFromCurrent: 0,
        reason: `Bullish FVG — فجوة صاعدة ${bullGap.toFixed(5)} (${(bullGap / atr).toFixed(1)}× ATR)`,
      });
    }

    // ── Bearish FVG: gap between next.high and prev.low ──────────────────────
    const bearGap = prev.low - next.high;
    if (bearGap >= MIN_GAP) {
      const midBody = Math.abs(curr.close - curr.open);
      const strength = Math.min(82, 45 + Math.round((bearGap / atr) * 30 + midBody / atr * 5));
      zones.push({
        id:          `bearish_fvg_${i}`,
        type:        "BEARISH_FVG",
        direction:   "SELL",
        low:         next.high,
        high:        prev.low,
        midpoint:    (next.high + prev.low) / 2,
        createdAt:   curr.time,
        candleIndex: i,
        strength,
        touched:     false,
        mitigated:   false,
        distanceFromCurrent: 0,
        reason: `Bearish FVG — فجوة هابطة ${bearGap.toFixed(5)} (${(bearGap / atr).toFixed(1)}× ATR)`,
      });
    }
  }

  return zones;
}

// ─── Support / Resistance from swing points ───────────────────────────────────

function addSupportResistance(ms: MarketStructureAnalysis): PriceZone[] {
  const zones: PriceZone[] = [];
  const ATR_BAND = 0.0005; // tight band around swing level

  if (ms.lastSwingHigh) {
    const p = ms.lastSwingHigh.price;
    zones.push({
      id:          `resistance_sh`,
      type:        "RESISTANCE",
      direction:   "SELL",
      low:         p - ATR_BAND,
      high:        p + ATR_BAND,
      midpoint:    p,
      createdAt:   ms.lastSwingHigh.time,
      candleIndex: ms.lastSwingHigh.index,
      strength:    65,
      touched:     false,
      mitigated:   false,
      distanceFromCurrent: 0,
      reason: `مقاومة — آخر Swing High: ${p.toFixed(5)}`,
    });
  }

  if (ms.lastSwingLow) {
    const p = ms.lastSwingLow.price;
    zones.push({
      id:          `support_sl`,
      type:        "SUPPORT",
      direction:   "BUY",
      low:         p - ATR_BAND,
      high:        p + ATR_BAND,
      midpoint:    p,
      createdAt:   ms.lastSwingLow.time,
      candleIndex: ms.lastSwingLow.index,
      strength:    65,
      touched:     false,
      mitigated:   false,
      distanceFromCurrent: 0,
      reason: `دعم — آخر Swing Low: ${p.toFixed(5)}`,
    });
  }

  return zones;
}

// ─── Touch & Mitigation ───────────────────────────────────────────────────────

function markTouchedAndMitigated(zones: PriceZone[], candles: OHLCCandle[]): void {
  for (const zone of zones) {
    const candlesAfter = candles.slice(zone.candleIndex + 1);
    if (candlesAfter.length === 0) continue;

    // touched: price has entered the zone range
    zone.touched = candlesAfter.some(
      (c) => c.low <= zone.high && c.high >= zone.low,
    );

    // mitigated: fully closed through the zone in the wrong direction
    if (zone.direction === "BUY") {
      zone.mitigated = candlesAfter.some((c) => c.close < zone.low);
    } else if (zone.direction === "SELL") {
      zone.mitigated = candlesAfter.some((c) => c.close > zone.high);
    }

    // FVG partial mitigation (50% fill)
    if (zone.type === "BULLISH_FVG" || zone.type === "BEARISH_FVG") {
      const gapMid = zone.midpoint;
      if (zone.direction === "BUY") {
        const partiallyFilled = candlesAfter.some((c) => c.close < gapMid);
        if (partiallyFilled && !zone.mitigated) {
          zone.strength = Math.max(20, zone.strength - 20);
          zone.touched  = true;
        }
      } else {
        const partiallyFilled = candlesAfter.some((c) => c.close > gapMid);
        if (partiallyFilled && !zone.mitigated) {
          zone.strength = Math.max(20, zone.strength - 20);
          zone.touched  = true;
        }
      }
    }

    // Repeated touches weaken the zone (OB / SD)
    if (zone.touched && !zone.mitigated && zone.type !== "BULLISH_FVG" && zone.type !== "BEARISH_FVG") {
      const touchCount = candlesAfter.filter(
        (c) => c.low <= zone.high && c.high >= zone.low,
      ).length;
      if (touchCount > 2) zone.strength = Math.max(20, zone.strength - touchCount * 8);
    }
  }
}

// ─── Distance from current price ─────────────────────────────────────────────

function computeDistances(zones: PriceZone[], currentPrice: number): void {
  for (const z of zones) {
    z.distanceFromCurrent = currentPrice > 0
      ? Math.abs(currentPrice - z.midpoint) / currentPrice * 100
      : 0;
  }
}

// ─── Premium / Discount ───────────────────────────────────────────────────────

function classifyPremiumDiscount(
  currentPrice: number,
  ms: MarketStructureAnalysis | undefined,
  candles: OHLCCandle[],
): "PREMIUM" | "DISCOUNT" | "MID" | "UNKNOWN" {
  let rangeHigh: number | undefined;
  let rangeLow:  number | undefined;

  if (ms?.rangeDetected && ms.rangeHigh != null && ms.rangeLow != null) {
    rangeHigh = ms.rangeHigh;
    rangeLow  = ms.rangeLow;
  } else if (ms?.lastSwingHigh && ms?.lastSwingLow) {
    rangeHigh = ms.lastSwingHigh.price;
    rangeLow  = ms.lastSwingLow.price;
  } else if (candles.length >= 10) {
    const recent = candles.slice(-50);
    rangeHigh = Math.max(...recent.map((c) => c.high));
    rangeLow  = Math.min(...recent.map((c) => c.low));
  }

  if (!rangeHigh || !rangeLow || rangeHigh <= rangeLow) return "UNKNOWN";

  const range    = rangeHigh - rangeLow;
  const midpoint = rangeLow + range / 2;
  const midBand  = range * 0.15; // ±15% of range = MID zone

  if (currentPrice > midpoint + midBand) return "PREMIUM";
  if (currentPrice < midpoint - midBand) return "DISCOUNT";
  return "MID";
}

// ─── Deduplicate similar zones ────────────────────────────────────────────────

function deduplicateZones(zones: PriceZone[], atr: number): PriceZone[] {
  const MIN_SEPARATION = atr * 0.3;
  const result: PriceZone[] = [];

  for (const z of zones) {
    const tooClose = result.some(
      (r) =>
        r.type === z.type &&
        Math.abs(r.midpoint - z.midpoint) < MIN_SEPARATION,
    );
    if (!tooClose) result.push(z);
  }
  return result;
}

// ─── Confluence score ─────────────────────────────────────────────────────────

function computeConfluenceScore(
  direction: "bullish" | "bearish" | undefined,
  activeZones: PriceZone[],
  inPremiumDiscount: string,
  atr: number,
): number {
  let score = 30;
  const NEAR_THRESHOLD = atr * 2;

  const isBuy  = direction === "bullish";
  const isSell = direction === "bearish";

  // Zones aligned with direction and nearby
  const supporting = activeZones.filter((z) => {
    const aligned = isBuy
      ? z.direction === "BUY"
      : isSell
        ? z.direction === "SELL"
        : false;
    const near = z.distanceFromCurrent * z.midpoint / 100 < NEAR_THRESHOLD;
    return aligned && near && !z.mitigated;
  });

  score += Math.min(35, supporting.length * 12);

  // Premium/Discount alignment
  if (isBuy  && inPremiumDiscount === "DISCOUNT") score += 15;
  if (isSell && inPremiumDiscount === "PREMIUM")  score += 15;
  if (isBuy  && inPremiumDiscount === "PREMIUM")  score -= 15;
  if (isSell && inPremiumDiscount === "DISCOUNT") score -= 15;
  if (inPremiumDiscount === "MID") score -= 8;

  // Strong zones nearby
  const strong = supporting.filter((z) => z.strength >= 70);
  score += Math.min(20, strong.length * 8);

  return Math.max(5, Math.min(95, score));
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function analyzeZones(
  candles:   OHLCCandle[],
  ms?:       MarketStructureAnalysis,
  direction?: "bullish" | "bearish",
): ZonesAnalysis {
  const warnings: string[] = [];
  const reasons:  string[] = [];

  if (candles.length < 5) {
    return {
      bias: "NEUTRAL", currentPrice: 0,
      nearestZone: null, nearestDemand: null, nearestSupply: null,
      activeZones: [], fvgZones: [], orderBlocks: [],
      inPremiumDiscount: "UNKNOWN",
      confluenceScore: 0, confidence: 0,
      reasons: ["شموع غير كافية لتحليل المناطق"],
      warnings: ["يجب توفر ≥ 5 شموع"],
    };
  }

  const atr          = atr14(candles);
  const currentPrice = candles.at(-1)!.close;

  // ── 1. Detect all zones ────────────────────────────────────────────────────
  const sdZones  = detectSupplyDemandZones(candles, atr);
  const obZones  = detectOrderBlocks(candles, atr, ms);
  const fvgRaw   = detectFVGs(candles, atr);
  const srZones  = ms ? addSupportResistance(ms) : [];

  let allZones = [...sdZones, ...obZones, ...fvgRaw, ...srZones];

  // ── 2. Dedup ───────────────────────────────────────────────────────────────
  allZones = deduplicateZones(allZones, atr);

  // ── 3. Touch & mitigation ─────────────────────────────────────────────────
  markTouchedAndMitigated(allZones, candles);

  // ── 4. Distance ───────────────────────────────────────────────────────────
  computeDistances(allZones, currentPrice);

  // ── 5. Filter active (non-mitigated) + sort by proximity ──────────────────
  const activeZones = allZones
    .filter((z) => !z.mitigated)
    .sort((a, b) => a.distanceFromCurrent - b.distanceFromCurrent)
    .slice(0, 12);

  const fvgZones   = activeZones.filter((z) => z.type === "BULLISH_FVG" || z.type === "BEARISH_FVG");
  const orderBlocks = activeZones.filter((z) => z.type === "BULLISH_ORDER_BLOCK" || z.type === "BEARISH_ORDER_BLOCK");

  // ── 6. Nearest zones ──────────────────────────────────────────────────────
  const nearestZone   = activeZones[0] ?? null;
  const nearestDemand = activeZones.find((z) => z.direction === "BUY")  ?? null;
  const nearestSupply = activeZones.find((z) => z.direction === "SELL") ?? null;

  // ── 7. Premium / Discount ─────────────────────────────────────────────────
  const inPremiumDiscount = classifyPremiumDiscount(currentPrice, ms, candles);

  // ── 8. Bias ───────────────────────────────────────────────────────────────
  const NEAR_PCT = 0.5; // 0.5% from current price is "near"
  const nearBuy  = activeZones.filter((z) => z.direction === "BUY"  && z.distanceFromCurrent <= NEAR_PCT).length;
  const nearSell = activeZones.filter((z) => z.direction === "SELL" && z.distanceFromCurrent <= NEAR_PCT).length;
  let bias: ZonesAnalysis["bias"] =
    nearBuy > nearSell ? "BUY" : nearSell > nearBuy ? "SELL" : "NEUTRAL";

  // Premium/Discount overrides bias if strong
  if (inPremiumDiscount === "DISCOUNT" && nearBuy > 0 && bias !== "SELL") bias = "BUY";
  if (inPremiumDiscount === "PREMIUM"  && nearSell > 0 && bias !== "BUY") bias = "SELL";

  // ── 9. Confluence score ───────────────────────────────────────────────────
  const confluenceScore = computeConfluenceScore(direction, activeZones, inPremiumDiscount, atr);

  // ── 10. Reasons ───────────────────────────────────────────────────────────
  if (nearestDemand) {
    reasons.push(`أقرب منطقة طلب: ${nearestDemand.midpoint.toFixed(5)} (${nearestDemand.distanceFromCurrent.toFixed(2)}%)`);
  }
  if (nearestSupply) {
    reasons.push(`أقرب منطقة عرض: ${nearestSupply.midpoint.toFixed(5)} (${nearestSupply.distanceFromCurrent.toFixed(2)}%)`);
  }
  reasons.push(
    `الموضع: ${
      inPremiumDiscount === "PREMIUM" ? "Premium (منطقة بيع)" :
      inPremiumDiscount === "DISCOUNT" ? "Discount (منطقة شراء)" :
      inPremiumDiscount === "MID" ? "منتصف النطاق" : "غير محدد"
    }`,
  );
  if (fvgZones.length > 0) {
    reasons.push(`${fvgZones.length} فجوة FVG نشطة في المنطقة القريبة`);
  }
  if (orderBlocks.length > 0) {
    reasons.push(`${orderBlocks.length} Order Block نشط`);
  }

  // ── 11. Warnings ──────────────────────────────────────────────────────────
  if (inPremiumDiscount === "MID") {
    warnings.push("الدخول من منتصف النطاق ضعيف — لا أفضلية واضحة للشراء أو البيع");
  }
  if (direction === "bullish" && inPremiumDiscount === "PREMIUM") {
    warnings.push("⚠ الشراء في منطقة Premium — سعر مرتفع نسبياً");
  }
  if (direction === "bearish" && inPremiumDiscount === "DISCOUNT") {
    warnings.push("⚠ البيع في منطقة Discount — سعر منخفض نسبياً");
  }
  if (activeZones.length === 0) {
    warnings.push("لا توجد مناطق نشطة في النطاق الحالي — تحليل المناطق غير متاح");
  }

  // Check if current price is inside an opposing strong zone
  const INSIDE_BAND = 0.1; // within 0.1% = inside the zone
  const insideOpposing = activeZones.find((z) => {
    const isOpposing =
      (direction === "bullish" && z.direction === "SELL") ||
      (direction === "bearish" && z.direction === "BUY");
    return isOpposing && z.distanceFromCurrent <= INSIDE_BAND && z.strength >= 65;
  });
  if (insideOpposing) {
    warnings.push(`⚠ السعر داخل منطقة ${insideOpposing.type} معاكسة (strength: ${insideOpposing.strength})`);
  }

  // ── 12. Confidence ────────────────────────────────────────────────────────
  const confidence = Math.min(90, Math.max(15,
    30 +
    (activeZones.length > 0 ? 20 : 0) +
    (nearestZone && nearestZone.distanceFromCurrent < 0.3 ? 15 : 0) +
    (inPremiumDiscount !== "UNKNOWN" ? 15 : 0) +
    (fvgZones.length > 0 ? 10 : 0),
  ));

  return {
    bias,
    currentPrice,
    nearestZone,
    nearestDemand,
    nearestSupply,
    activeZones,
    fvgZones:    fvgZones.slice(0, 6),
    orderBlocks: orderBlocks.slice(0, 6),
    inPremiumDiscount,
    confluenceScore,
    confidence,
    reasons:  reasons.slice(0, 8),
    warnings: warnings.slice(0, 5),
  };
}
