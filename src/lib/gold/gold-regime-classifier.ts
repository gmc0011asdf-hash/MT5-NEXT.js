/**
 * gold-regime-classifier.ts — Market Regime Classifier v1
 * تصنيف حالة سوق XAUUSD — قراءة فقط — لا تنفيذ تداول — لا توصيات شراء/بيع.
 * Pure TypeScript — no Next.js / Convex imports. Works client-side and server-side.
 */

import type { OHLCCandle } from "@/lib/trading/mt5/market-structure";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketRegime =
  | "Pending"
  | "Trend"
  | "Range"
  | "LowQuality"
  | "DataMissing"
  | "NewsRiskPlaceholder";

export type RegimeConfidence = "Low" | "Medium";

export interface RegimeClassification {
  regime: MarketRegime;
  confidence: RegimeConfidence;
  reason: string;
  newsRisk: boolean;
  candleCount: number;
  /** true only when regime === "LowQuality" and data is so poor it blocks analysis */
  extremelyLowQuality: boolean;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const MIN_CANDLES               = 20;
const TREND_SLOPE_THRESHOLD     = 0.00030; // normalized |slope| / avg_close per candle position
const TREND_HIGH_THRESHOLD      = 0.00060; // above this → Medium confidence
const RANGE_BAND_THRESHOLD      = 0.00350; // (range_high - range_low) / avg_close
const LOW_QUALITY_BODY_RATIO    = 0.150;   // avg body/range < this → LowQuality
const EXTREME_LOW_QUALITY_RATIO = 0.080;   // < this → extremelyLowQuality → BLOCK

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeAvgBodyRatio(candles: OHLCCandle[]): number {
  let total = 0;
  for (const c of candles) {
    const range = c.high - c.low;
    const body  = Math.abs(c.close - c.open);
    total += range > 0 ? body / range : 0;
  }
  return candles.length > 0 ? total / candles.length : 0;
}

/**
 * Ordinary least-squares slope on a sequence of values (index as x-axis).
 * Returns raw slope (units: value per step).
 */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean  = values.reduce((a, b) => a + b, 0) / n;
  const meanI = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanI) * (values[i] - mean);
    den += (i - meanI) * (i - meanI);
  }
  return den !== 0 ? num / den : 0;
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * classifyMarketRegime — v1
 *
 * Rules (ordered by priority):
 * 1. DataMissing  — fewer than MIN_CANDLES available
 * 2. LowQuality   — average body/range ratio below LOW_QUALITY_BODY_RATIO
 * 3. Trend        — normalized OLS slope exceeds TREND_SLOPE_THRESHOLD
 * 4. Range        — price band narrower than RANGE_BAND_THRESHOLD
 * 5. NewsRiskPlaceholder — movement present but pattern unclear; XAUUSD news risk noted
 *
 * All regimes carry newsRisk = true because XAUUSD is sensitive to macro events.
 * The result is INFORMATIONAL — not a buy/sell signal.
 */
export function classifyMarketRegime(candles: OHLCCandle[]): RegimeClassification {
  // ── 1. DataMissing ──────────────────────────────────────────────────────────
  if (candles.length < MIN_CANDLES) {
    return {
      regime:               "DataMissing",
      confidence:           "Low",
      reason:               `بيانات غير كافية — ${candles.length} شمعة متاحة (الحد الأدنى ${MIN_CANDLES})`,
      newsRisk:             true,
      candleCount:          candles.length,
      extremelyLowQuality:  false,
    };
  }

  const n        = candles.length;
  const closes   = candles.map((c) => c.close);
  const avgClose = closes.reduce((a, b) => a + b, 0) / n;
  const bodyRatio = computeAvgBodyRatio(candles);

  // ── 2. LowQuality ───────────────────────────────────────────────────────────
  if (bodyRatio < LOW_QUALITY_BODY_RATIO) {
    const isExtreme = bodyRatio < EXTREME_LOW_QUALITY_RATIO;
    return {
      regime:              "LowQuality",
      confidence:          "Low",
      reason:              `جودة الشموع منخفضة — متوسط نسبة الجسم ${(bodyRatio * 100).toFixed(1)}%` +
                           ` (الحد الأدنى ${(LOW_QUALITY_BODY_RATIO * 100).toFixed(0)}%) — السوق متذبذب أو مغلق`,
      newsRisk:            true,
      candleCount:         n,
      extremelyLowQuality: isExtreme,
    };
  }

  // ── 3. Trend ────────────────────────────────────────────────────────────────
  const slope           = linearSlope(closes);
  const normalizedSlope = avgClose > 0 ? Math.abs(slope / avgClose) : 0;

  if (normalizedSlope > TREND_SLOPE_THRESHOLD) {
    const direction = slope > 0 ? "صاعد" : "هابط";
    return {
      regime:              "Trend",
      confidence:          normalizedSlope > TREND_HIGH_THRESHOLD ? "Medium" : "Low",
      reason:              `اتجاه ${direction} مبدئي — ميل السعر ${(normalizedSlope * 100).toFixed(3)}% لكل شمعة (${n} شمعة)`,
      newsRisk:            true,
      candleCount:         n,
      extremelyLowQuality: false,
    };
  }

  // ── 4. Range ────────────────────────────────────────────────────────────────
  const rangeHigh = candles.reduce((m, c) => Math.max(m, c.high), -Infinity);
  const rangeLow  = candles.reduce((m, c) => Math.min(m, c.low),  +Infinity);
  const bandRatio  = avgClose > 0 ? (rangeHigh - rangeLow) / avgClose : 1;

  if (bandRatio < RANGE_BAND_THRESHOLD) {
    return {
      regime:              "Range",
      confidence:          "Medium",
      reason:              `سعر داخل نطاق ضيق — عرض النطاق ${(bandRatio * 100).toFixed(2)}% من متوسط السعر (${n} شمعة)`,
      newsRisk:            true,
      candleCount:         n,
      extremelyLowQuality: false,
    };
  }

  // ── 5. NewsRiskPlaceholder (fallback) ───────────────────────────────────────
  return {
    regime:              "NewsRiskPlaceholder",
    confidence:          "Low",
    reason:              `حركة سعر غير محددة الاتجاه — مراقبة التقويم الاقتصادي لـ XAUUSD مستحسنة (${n} شمعة)`,
    newsRisk:            true,
    candleCount:         n,
    extremelyLowQuality: false,
  };
}

// ─── Candle parser (raw API response → OHLCCandle[]) ─────────────────────────

export function parseOhlcCandles(raw: unknown[]): OHLCCandle[] {
  const result: OHLCCandle[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r     = item as Record<string, unknown>;
    const time  = typeof r.time  === "number" ? r.time  : 0;
    const open  = typeof r.open  === "number" ? r.open  : 0;
    const high  = typeof r.high  === "number" ? r.high  : 0;
    const low   = typeof r.low   === "number" ? r.low   : 0;
    const close = typeof r.close === "number" ? r.close : 0;
    if (open > 0 && close > 0 && high >= low && high > 0) {
      result.push({ time, open, high, low, close });
    }
  }
  return result;
}
