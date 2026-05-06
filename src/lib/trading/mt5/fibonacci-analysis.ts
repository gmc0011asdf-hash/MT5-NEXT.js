/**
 * fibonacci-analysis.ts — B4
 * Pure Fibonacci retracement / extension confluence engine.
 * No trading execution — no order_send — read-only analysis.
 */

import type { OHLCCandle, MarketStructureAnalysis } from "./market-structure";
import type { ZonesAnalysis } from "./zones-analysis";

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRACEMENT_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;
const EXTENSION_RATIOS   = [1.272, 1.618, 2.0]                as const;

const GOLDEN_LOW  = 0.5;    // 50%
const GOLDEN_HIGH = 0.618;  // 61.8%

// ─── Types ────────────────────────────────────────────────────────────────────

export type FibonacciLevel = {
  level:                 number;   // ratio e.g. 0.618
  price:                 number;
  type:                  "RETRACEMENT" | "EXTENSION";
  label:                 string;   // e.g. "61.8%"
  distanceFromCurrentPct: number;
  nearCurrent:           boolean;
  reason:                string;
};

export type FibonacciSwing = {
  direction:  "BULLISH" | "BEARISH" | "UNKNOWN";
  swingLow:   number;
  swingHigh:  number;
  startTime:  number;
  endTime:    number;
  range:      number;
  valid:      boolean;
  reason:     string;
};

export type GoldenZone = {
  low:                    number;
  high:                   number;
  active:                 boolean;
  direction:              "BUY" | "SELL" | "NEUTRAL";
  distanceFromCurrentPct: number;
};

export type FibonacciAnalysis = {
  bias:                        "BUY" | "SELL" | "NEUTRAL";
  swing:                       FibonacciSwing;
  currentPrice:                number;
  retracementLevels:           FibonacciLevel[];
  extensionLevels:             FibonacciLevel[];
  nearestLevel:                FibonacciLevel | null;
  goldenZone:                  GoldenZone;
  inGoldenZone:                boolean;
  confluenceWithZones:         boolean;
  confluenceWithMarketStructure: boolean;
  confluenceScore:             number;
  confidence:                  number;
  reasons:                     string[];
  warnings:                    string[];
};

// ─── ATR ──────────────────────────────────────────────────────────────────────

function atr14(candles: OHLCCandle[]): number {
  if (candles.length < 2) return 0;
  const period = Math.min(14, candles.length - 1);
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur  = candles[i]!;
    sum += Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
  }
  return sum / period;
}

// ─── Proximity check ──────────────────────────────────────────────────────────

function isNearCurrent(
  levelPrice: number,
  currentPrice: number,
  atr: number,
  symbol: string,
): { near: boolean; distancePct: number } {
  if (currentPrice <= 0) return { near: false, distancePct: 0 };
  const distanceAbs = Math.abs(currentPrice - levelPrice);
  const distancePct = distanceAbs / currentPrice * 100;

  const isXAU      = symbol.includes("XAU") || symbol.includes("GOLD");
  const pctLimit   = isXAU ? 0.25 : 0.15;
  const atrLimit   = atr > 0 ? atr * 0.3 : Infinity;

  return { near: distancePct <= pctLimit || distanceAbs <= atrLimit, distancePct };
}

// ─── Swing selection ──────────────────────────────────────────────────────────

function selectSwing(
  candles: OHLCCandle[],
  ms: MarketStructureAnalysis | undefined,
  atr: number,
): FibonacciSwing {
  const firstTime = candles.at(0)?.time ?? 0;
  const lastTime  = candles.at(-1)?.time ?? 0;

  // ── From market structure (preferred) ────────────────────────────────────
  if (ms?.lastSwingHigh && ms.lastSwingLow) {
    const sh = ms.lastSwingHigh;
    const sl = ms.lastSwingLow;

    // Determine direction from market structure
    let swingDir: FibonacciSwing["direction"] = "UNKNOWN";
    if (ms.trendState === "BULLISH" || ms.bias === "BUY") swingDir = "BULLISH";
    else if (ms.trendState === "BEARISH" || ms.bias === "SELL") swingDir = "BEARISH";

    const swingLow  = sl.price;
    const swingHigh = sh.price;
    const range     = swingHigh - swingLow;
    const valid     = range > atr * 0.5 && range > 0;

    if (valid) {
      return {
        direction: swingDir,
        swingLow,
        swingHigh,
        startTime: swingDir === "BULLISH" ? sl.time : sh.time,
        endTime:   swingDir === "BULLISH" ? sh.time : sl.time,
        range,
        valid: true,
        reason: `Swing من Market Structure — ${swingDir} (SL: ${swingLow.toFixed(5)}, SH: ${swingHigh.toFixed(5)})`,
      };
    }
  }

  // ── Range mode fallback ───────────────────────────────────────────────────
  if (ms?.rangeDetected && ms.rangeHigh != null && ms.rangeLow != null) {
    const range = ms.rangeHigh - ms.rangeLow;
    return {
      direction: "UNKNOWN",
      swingLow:  ms.rangeLow,
      swingHigh: ms.rangeHigh,
      startTime: firstTime,
      endTime:   lastTime,
      range,
      valid: range > 0,
      reason: `Swing من النطاق السعري (${ms.rangeLow.toFixed(5)} — ${ms.rangeHigh.toFixed(5)})`,
    };
  }

  // ── Candle-based fallback (last 50 candles) ───────────────────────────────
  const recent    = candles.slice(-50);
  const swingHigh = Math.max(...recent.map((c) => c.high));
  const swingLow  = Math.min(...recent.map((c) => c.low));
  const range     = swingHigh - swingLow;

  return {
    direction: "UNKNOWN",
    swingLow,
    swingHigh,
    startTime: firstTime,
    endTime:   lastTime,
    range,
    valid: range > atr * 0.5,
    reason: "Swing احتياطي من آخر 50 شمعة — ثقة أقل",
  };
}

// ─── Retracement levels ───────────────────────────────────────────────────────

function computeRetracementLevels(
  swing:        FibonacciSwing,
  currentPrice: number,
  atr:          number,
  symbol:       string,
): FibonacciLevel[] {
  const { swingLow, swingHigh, range, direction } = swing;
  if (!swing.valid || range <= 0) return [];

  return RETRACEMENT_RATIOS.map((ratio) => {
    // BULLISH retracement: price corrects DOWN from swingHigh
    // BEARISH retracement: price bounces UP from swingLow
    const price =
      direction === "BULLISH" || direction === "UNKNOWN"
        ? swingHigh - ratio * range   // measured from high downward
        : swingLow  + ratio * range;  // measured from low upward

    const label = `${(ratio * 100).toFixed(1)}%`;
    const { near, distancePct } = isNearCurrent(price, currentPrice, atr, symbol);
    const isGolden = ratio === GOLDEN_LOW || ratio === GOLDEN_HIGH;

    return {
      level: ratio,
      price,
      type:  "RETRACEMENT" as const,
      label,
      distanceFromCurrentPct: distancePct,
      nearCurrent: near,
      reason: `Fib ${label} — تصحيح${isGolden ? " (Golden Zone)" : ""}`,
    };
  });
}

// ─── Extension levels ─────────────────────────────────────────────────────────

function computeExtensionLevels(
  swing:        FibonacciSwing,
  currentPrice: number,
  atr:          number,
  symbol:       string,
): FibonacciLevel[] {
  const { swingLow, swingHigh, range, direction } = swing;
  if (!swing.valid || range <= 0) return [];

  return EXTENSION_RATIOS.map((ratio) => {
    // Extensions project beyond the end of the swing
    const price =
      direction === "BULLISH" || direction === "UNKNOWN"
        ? swingLow  + ratio * range   // bullish target above swingHigh
        : swingHigh - ratio * range;  // bearish target below swingLow

    const label = `${(ratio * 100).toFixed(1)}%`;
    const { near, distancePct } = isNearCurrent(price, currentPrice, atr, symbol);

    return {
      level: ratio,
      price,
      type:  "EXTENSION" as const,
      label,
      distanceFromCurrentPct: distancePct,
      nearCurrent: near,
      reason: `Fib Extension ${label} — هدف محتمل`,
    };
  });
}

// ─── Golden zone ──────────────────────────────────────────────────────────────

function computeGoldenZone(
  swing:        FibonacciSwing,
  currentPrice: number,
): GoldenZone {
  const { swingLow, swingHigh, range, direction } = swing;
  if (!swing.valid || range <= 0) {
    return { low: 0, high: 0, active: false, direction: "NEUTRAL", distanceFromCurrentPct: 0 };
  }

  let gzLow:  number;
  let gzHigh: number;
  let gzDir:  GoldenZone["direction"];

  if (direction === "BULLISH") {
    // Retracement from high → buy zone between 61.8% and 50% corrections
    gzLow  = swingHigh - GOLDEN_HIGH * range;  // deeper correction
    gzHigh = swingHigh - GOLDEN_LOW  * range;  // shallower correction
    gzDir  = "BUY";
  } else {
    // Retracement from low → sell zone between 50% and 61.8% bounces
    gzLow  = swingLow + GOLDEN_LOW  * range;
    gzHigh = swingLow + GOLDEN_HIGH * range;
    gzDir  = direction === "BEARISH" ? "SELL" : "NEUTRAL";
  }

  const inZone = currentPrice >= gzLow && currentPrice <= gzHigh;
  const distFromLow  = Math.abs(currentPrice - gzLow)  / currentPrice * 100;
  const distFromHigh = Math.abs(currentPrice - gzHigh) / currentPrice * 100;
  const distancePct  = inZone ? 0 : Math.min(distFromLow, distFromHigh);

  return { low: gzLow, high: gzHigh, active: inZone, direction: gzDir, distanceFromCurrentPct: distancePct };
}

// ─── Zone confluence check ────────────────────────────────────────────────────

const CONFLUENCE_PCT = 0.5; // zone must be within 0.5% of a Fib level

function checkZoneConfluence(
  levels:    FibonacciLevel[],
  za:        ZonesAnalysis,
  direction: "bullish" | "bearish" | undefined,
): boolean {
  const nearLevels = levels.filter((l) => l.nearCurrent);
  if (nearLevels.length === 0) return false;

  return za.activeZones.some((zone) => {
    const aligned =
      (direction === "bullish" && zone.direction === "BUY")  ||
      (direction === "bearish" && zone.direction === "SELL") ||
      direction === undefined;
    if (!aligned) return false;
    return nearLevels.some(
      (l) => Math.abs(zone.midpoint - l.price) / l.price * 100 <= CONFLUENCE_PCT,
    );
  });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function analyzeFibonacci(
  candles:   OHLCCandle[],
  ms?:       MarketStructureAnalysis,
  za?:       ZonesAnalysis,
  opts?: { direction?: "bullish" | "bearish"; symbolName?: string },
): FibonacciAnalysis {
  const reasons:  string[] = [];
  const warnings: string[] = [];
  const symbol   = opts?.symbolName ?? "";
  const inputDir = opts?.direction ?? (ms?.bias === "BUY" ? "bullish" : ms?.bias === "SELL" ? "bearish" : undefined);

  const currentPrice = candles.at(-1)?.close ?? 0;

  // ── Min candles check ──────────────────────────────────────────────────────
  if (candles.length < 5 || currentPrice <= 0) {
    const empty: FibonacciAnalysis = {
      bias: "NEUTRAL",
      swing: { direction: "UNKNOWN", swingLow: 0, swingHigh: 0, startTime: 0, endTime: 0, range: 0, valid: false, reason: "شموع غير كافية" },
      currentPrice,
      retracementLevels: [], extensionLevels: [],
      nearestLevel: null,
      goldenZone: { low: 0, high: 0, active: false, direction: "NEUTRAL", distanceFromCurrentPct: 0 },
      inGoldenZone: false,
      confluenceWithZones: false, confluenceWithMarketStructure: false,
      confluenceScore: 0, confidence: 0,
      reasons: ["شموع غير كافية لحساب Fibonacci"],
      warnings: [],
    };
    return empty;
  }

  const atr  = atr14(candles);
  const swing = selectSwing(candles, ms, atr);

  if (!swing.valid) {
    warnings.push("Swing السعري صغير جداً — Fibonacci قد لا يكون دقيقاً");
  }
  reasons.push(swing.reason);

  // ── Levels ────────────────────────────────────────────────────────────────
  const retracementLevels = computeRetracementLevels(swing, currentPrice, atr, symbol);
  const extensionLevels   = computeExtensionLevels(swing, currentPrice, atr, symbol);

  // ── Nearest level ─────────────────────────────────────────────────────────
  const allLevels = [...retracementLevels, ...extensionLevels];
  const nearestLevel = allLevels
    .filter((l) => l.type === "RETRACEMENT") // nearest retracement is most actionable
    .sort((a, b) => a.distanceFromCurrentPct - b.distanceFromCurrentPct)[0] ?? null;

  // ── Golden zone ───────────────────────────────────────────────────────────
  const goldenZone = computeGoldenZone(swing, currentPrice);
  const inGoldenZone = goldenZone.active;

  if (inGoldenZone) {
    reasons.push(`السعر داخل Golden Zone (${goldenZone.low.toFixed(5)} — ${goldenZone.high.toFixed(5)}) ✓`);
  } else if (goldenZone.distanceFromCurrentPct < 0.5) {
    reasons.push(`السعر قريب من Golden Zone (${goldenZone.distanceFromCurrentPct.toFixed(2)}%)`);
  }

  // ── Confluences ───────────────────────────────────────────────────────────
  const confluenceWithZones = za
    ? checkZoneConfluence(retracementLevels, za, inputDir)
    : false;

  const confluenceWithMarketStructure = ms
    ? (ms.bias === "BUY"  && inputDir === "bullish") ||
      (ms.bias === "SELL" && inputDir === "bearish") ||
      ms.trendState === (inputDir === "bullish" ? "BULLISH" : "BEARISH")
    : false;

  if (confluenceWithZones)         reasons.push("توافق مع منطقة B3 قريبة ✓");
  if (confluenceWithMarketStructure) reasons.push(`هيكل السوق (${ms?.trendState}) يدعم الاتجاه ✓`);

  // ── Nearest level summary ────────────────────────────────────────────────
  if (nearestLevel) {
    const prefix = nearestLevel.nearCurrent ? "السعر عند" : "أقرب مستوى";
    reasons.push(`${prefix} Fib ${nearestLevel.label} (${nearestLevel.price.toFixed(5)}) — بُعد: ${nearestLevel.distanceFromCurrentPct.toFixed(2)}%`);
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (!inGoldenZone && !retracementLevels.some((l) => l.nearCurrent)) {
    warnings.push("السعر ليس عند مستوى Fibonacci واضح — لا توافق قوي");
  }
  if (swing.direction === "UNKNOWN") {
    warnings.push("اتجاه Swing غير محدد — استخدام احتياطي من آخر 50 شمعة");
  }
  if (ms?.trendState === "RANGE" && !confluenceWithZones) {
    warnings.push("السوق في نطاق — Fibonacci وحده لا يكفي بدون Zone داعمة");
  }

  // ── Confluence score ──────────────────────────────────────────────────────
  let confluenceScore = 25;
  if (inGoldenZone)                       confluenceScore += 25;
  else if (goldenZone.distanceFromCurrentPct < 0.3) confluenceScore += 12;
  if (confluenceWithZones)                confluenceScore += 20;
  if (confluenceWithMarketStructure)      confluenceScore += 15;
  if (nearestLevel?.nearCurrent)          confluenceScore += 10;
  if (swing.valid && swing.direction !== "UNKNOWN") confluenceScore += 5;
  confluenceScore = Math.max(5, Math.min(90, confluenceScore));

  // ── Bias ─────────────────────────────────────────────────────────────────
  let bias: FibonacciAnalysis["bias"] = "NEUTRAL";
  if (inGoldenZone) {
    bias = goldenZone.direction === "BUY"  ? "BUY"  :
           goldenZone.direction === "SELL" ? "SELL" : "NEUTRAL";
  } else if (inputDir === "bullish" && confluenceWithMarketStructure) {
    bias = "BUY";
  } else if (inputDir === "bearish" && confluenceWithMarketStructure) {
    bias = "SELL";
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  const confidence = Math.min(85, Math.max(15,
    30 +
    (swing.valid && swing.direction !== "UNKNOWN" ? 20 : 5) +
    (inGoldenZone ? 15 : 0) +
    (confluenceWithZones ? 15 : 0) +
    (confluenceWithMarketStructure ? 10 : 0),
  ));

  return {
    bias,
    swing,
    currentPrice,
    retracementLevels,
    extensionLevels,
    nearestLevel,
    goldenZone,
    inGoldenZone,
    confluenceWithZones,
    confluenceWithMarketStructure,
    confluenceScore,
    confidence,
    reasons:  reasons.slice(0, 8),
    warnings: warnings.slice(0, 5),
  };
}
