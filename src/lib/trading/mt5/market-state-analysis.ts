/**
 * market-state-analysis.ts — B3.2
 * Market state, session and candle integrity engine.
 * No trading execution — no order_send — read-only analysis.
 */

import type { OHLCCandle } from "./market-structure";

// --- Timeframe period map (minutes) -------------------------------------------

export const TIMEFRAME_MINUTES: Record<string, number> = {
  M1:   1, M5:   5, M15: 15, M30:  30,
  H1:  60, H4:  240, D1: 1440,
};

// --- Types --------------------------------------------------------------------

export type SpreadStatus = "NORMAL" | "HIGH" | "EXTREME" | "UNKNOWN";

export type MarketSessionStatus = "OPEN" | "CLOSED" | "LOW_LIQUIDITY" | "UNKNOWN";

export type MarketStateDecision =
  | "ALLOW_ANALYSIS"
  | "ANALYSIS_ONLY"
  | "BLOCK_EXECUTION"
  | "BLOCK_ALL";

export type FakeCandleRisk = "LOW" | "MEDIUM" | "HIGH";

export type SuspiciousCandle = {
  index:    number;
  time:     number;
  reason:   string;
  severity: "WARN" | "BLOCK";
  metrics: {
    range:       number;
    body:        number;
    upperWick:   number;
    lowerWick:   number;
    tickVolume?: number;
  };
};

// MarketStateAnalysis — response-safe (no raw candles array)
export type MarketStateAnalysis = {
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

// Full type (internal use — includes closedCandles for B1/B2/B3)
export type MarketStateAnalysisFull = MarketStateAnalysis & {
  closedCandles: OHLCCandle[];
};

// --- Helpers ------------------------------------------------------------------

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

// --- Closed candle filter -----------------------------------------------------

function getClosedCandles(
  candles:   OHLCCandle[],
  timeframe: string,
  now:       number,
): { closedCandles: OHLCCandle[]; latestCandleClosed: boolean } {
  if (candles.length === 0) return { closedCandles: [], latestCandleClosed: false };

  const periodMs  = (TIMEFRAME_MINUTES[timeframe] ?? 15) * 60 * 1000;
  const TOLERANCE = 5 * 60 * 1000; // 5 min clock-skew tolerance

  const last = candles[candles.length - 1]!;
  // Candle is forming if elapsed since open < period (minus tolerance)
  const isForming = now - last.time < periodMs - TOLERANCE;

  if (isForming) {
    return { closedCandles: candles.slice(0, -1), latestCandleClosed: false };
  }
  return { closedCandles: candles, latestCandleClosed: true };
}

// --- Suspicious candle detection ---------------------------------------------

function detectSuspiciousCandles(
  candles: OHLCCandle[],
  atr:     number,
  now:     number,
): SuspiciousCandle[] {
  const suspicious: SuspiciousCandle[] = [];
  const toScan = candles.slice(-20);

  for (let si = 0; si < toScan.length; si++) {
    const c = toScan[si]!;
    const globalIdx = candles.length - toScan.length + si;

    const range    = c.high - c.low;
    const body     = Math.abs(c.close - c.open);
    const upper    = c.high - Math.max(c.open, c.close);
    const lower    = Math.min(c.open, c.close) - c.low;
    const maxWick  = Math.max(upper, lower);

    const issues: { reason: string; severity: "WARN" | "BLOCK" }[] = [];

    // Invalid OHLC
    if (!isFinite(c.open) || !isFinite(c.high) || !isFinite(c.low) || !isFinite(c.close)) {
      issues.push({ reason: "قيم OHLC غير صالحة (NaN/Inf)", severity: "BLOCK" });
    } else if (c.high < c.low) {
      issues.push({ reason: "high < low — شمعة معكوسة", severity: "BLOCK" });
    }

    // Zero range
    if (range === 0 && si < toScan.length - 1) {
      issues.push({ reason: "مدى الشمعة صفر (no price movement)", severity: "WARN" });
    }

    // Extremely large candle
    if (atr > 0 && range > atr * 4) {
      issues.push({ reason: `مدى كبير جداً (${(range / atr).toFixed(1)}× ATR)`, severity: "WARN" });
    }

    // Extreme wick (>80% of range) with tiny body (<5% of range) → suspicious liquidity event
    if (range > 0 && maxWick / range > 0.8 && body / range < 0.05) {
      issues.push({ reason: "ذيل مفرط + جسم صغير جداً", severity: "WARN" });
    }

    // Gap from previous close
    if (si > 0 && atr > 0) {
      const prev = toScan[si - 1]!;
      const gap  = Math.abs(c.open - prev.close);
      if (gap > atr * 2) {
        issues.push({ reason: `فجوة كبيرة من الإغلاق السابق (${(gap / atr).toFixed(1)}× ATR)`, severity: "WARN" });
      }
    }

    // Time in the future (> 1 min ahead of now)
    if (c.time > now + 60_000) {
      issues.push({ reason: "وقت الشمعة في المستقبل", severity: "BLOCK" });
    }

    // Repeated OHLC (cloned candle)
    if (si > 0) {
      const prev = toScan[si - 1]!;
      if (c.open === prev.open && c.high === prev.high && c.low === prev.low && c.close === prev.close) {
        issues.push({ reason: "شمعة مكررة — نفس OHLC", severity: "WARN" });
      }
    }

    if (issues.length > 0) {
      const severity = issues.some((s) => s.severity === "BLOCK") ? "BLOCK" : "WARN";
      suspicious.push({
        index:    globalIdx,
        time:     c.time,
        reason:   issues.map((s) => s.reason).join(" | "),
        severity,
        metrics:  { range, body, upperWick: upper, lowerWick: lower },
      });
    }
  }

  return suspicious;
}

// --- Spread classification ----------------------------------------------------

function classifySpread(spread: number | null, symbol: string): SpreadStatus {
  if (spread == null || spread <= 0) return "UNKNOWN";
  const isXAU = symbol.includes("XAU") || symbol.includes("GOLD");
  if (isXAU) {
    if (spread <= 30) return "NORMAL";
    if (spread <= 80) return "HIGH";
    return "EXTREME";
  }
  if (spread <= 20) return "NORMAL";
  if (spread <= 50) return "HIGH";
  return "EXTREME";
}

// --- Session status (without tick) -------------------------------------------

function classifySession(candleAgeMs: number, timeframe: string): MarketSessionStatus {
  const period  = (TIMEFRAME_MINUTES[timeframe] ?? 15) * 60 * 1000;
  if (candleAgeMs < 0) return "UNKNOWN";           // clock skew — can't determine
  if (candleAgeMs < period * 2)  return "OPEN";
  if (candleAgeMs < period * 5)  return "LOW_LIQUIDITY";
  return "CLOSED";
}

// --- Main entry point ---------------------------------------------------------

export function analyzeMarketState(
  candles:   OHLCCandle[],
  timeframe: string,
  opts?: { spreadPoints?: number; symbolName?: string; currentTime?: number },
): MarketStateAnalysisFull {
  const reasons:  string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const now      = opts?.currentTime ?? Date.now();
  const symbol   = opts?.symbolName  ?? "";

  // -- 1. Not enough data -----------------------------------------------------
  if (candles.length < 3) {
    return {
      marketOpen: false, symbolTradable: false, dataFresh: false,
      usingClosedCandleOnly: false, latestCandleClosed: false,
      latestCandleTime: null, latestClosedCandleTime: null,
      tickFresh: false, tickAgeMs: null, candleAgeMs: null,
      spreadPoints: opts?.spreadPoints ?? null, spreadStatus: "UNKNOWN",
      brokerClockSkewDetected: false, brokerClockSkewMs: 0,
      suspiciousCandlesCount: 0, suspiciousCandles: [],
      fakeCandleRisk: "HIGH",
      marketSessionStatus: "UNKNOWN",
      decision: "BLOCK_ALL",
      confidence: 0,
      reasons: ["شموع غير كافية للتحليل"],
      warnings: [],
      blockers: ["بيانات غير كافية — تحقق من مزامنة الشموع"],
      closedCandles: [],
    };
  }

  // -- 2. Separate forming vs closed candles ----------------------------------
  const { closedCandles, latestCandleClosed } = getClosedCandles(candles, timeframe, now);
  const usingClosedCandleOnly = !latestCandleClosed && closedCandles.length > 0;

  if (!latestCandleClosed) {
    warnings.push("تم تجاهل الشمعة الحالية لأنها لم تغلق بعد — التحليل يستخدم آخر شمعة مغلقة");
  }

  const effectiveCandles = closedCandles.length > 0 ? closedCandles : candles;
  const atr = atr14(effectiveCandles);

  // -- 3. Candle age ---------------------------------------------------------
  const lastClosed      = effectiveCandles.at(-1);
  const latestCandleTime       = candles.at(-1)?.time ?? null;
  const latestClosedCandleTime = lastClosed?.time ?? null;
  const candleAgeMs = latestClosedCandleTime != null ? now - latestClosedCandleTime : null;

  // -- 4. Broker clock skew --------------------------------------------------
  const SKEW_THRESHOLD   = 5 * 60 * 1000;
  const brokerClockSkewDetected = candleAgeMs != null && candleAgeMs < -SKEW_THRESHOLD;
  const brokerClockSkewMs       = brokerClockSkewDetected && candleAgeMs != null
    ? Math.abs(candleAgeMs) : 0;
  if (brokerClockSkewDetected) {
    warnings.push(`توقيت الوسيط متقدم بـ ${Math.round(brokerClockSkewMs / 60000)} دقيقة — clock skew`);
  }

  // -- 5. Data freshness -----------------------------------------------------
  const periodMs   = (TIMEFRAME_MINUTES[timeframe] ?? 15) * 60 * 1000;
  const freshLimit = periodMs * 2;
  const dataFresh  =
    candleAgeMs != null &&
    candleAgeMs >= 0 &&
    candleAgeMs <= freshLimit;

  if (!dataFresh && candleAgeMs != null && candleAgeMs > 0) {
    const ageMins = Math.round(candleAgeMs / 60000);
    warnings.push(`بيانات قديمة — آخر شمعة مغلقة منذ ${ageMins} دقيقة`);
    if (candleAgeMs > periodMs * 5) {
      blockers.push("بيانات قديمة جداً — يمنع التنفيذ");
    }
  }

  // -- 6. Market session (without tick) --------------------------------------
  const marketSessionStatus = candleAgeMs != null
    ? classifySession(candleAgeMs, timeframe)
    : "UNKNOWN";

  const marketOpen = marketSessionStatus === "OPEN" || marketSessionStatus === "LOW_LIQUIDITY";

  if (marketSessionStatus === "CLOSED") {
    blockers.push("السوق مغلق أو tick غير صالح — يمنع التنفيذ");
  } else if (marketSessionStatus === "UNKNOWN") {
    warnings.push("لا توجد tick حديثة لتأكيد حالة السوق");
  } else if (marketSessionStatus === "LOW_LIQUIDITY") {
    warnings.push("سيولة منخفضة — ابتعد عن أوامر Market في هذا الوقت");
  }

  // -- 7. Spread -------------------------------------------------------------
  const spreadPoints = opts?.spreadPoints ?? null;
  const spreadStatus = classifySpread(spreadPoints, symbol);

  if (spreadStatus === "EXTREME") {
    blockers.push(`سبريد مفرط (${spreadPoints} نقطة) — يمنع التنفيذ`);
  } else if (spreadStatus === "HIGH") {
    warnings.push(`سبريد مرتفع (${spreadPoints} نقطة) — راجع جودة الدخول`);
  } else if (spreadStatus === "NORMAL") {
    reasons.push(`السبريد طبيعي (${spreadPoints} نقطة) ✓`);
  }

  // -- 8. Suspicious candles -------------------------------------------------
  const suspiciousCandles = detectSuspiciousCandles(effectiveCandles, atr, now);
  const suspiciousCandlesCount = suspiciousCandles.length;

  // Fake candle risk
  const recentSuspicious = suspiciousCandles.filter(
    (s) => s.index >= effectiveCandles.length - 3,
  );
  const blockSeverityRecent = recentSuspicious.some((s) => s.severity === "BLOCK");
  let fakeCandleRisk: FakeCandleRisk =
    blockSeverityRecent || suspiciousCandlesCount >= 3 ? "HIGH" :
    suspiciousCandlesCount >= 1                        ? "MEDIUM" :
                                                         "LOW";

  if (fakeCandleRisk === "HIGH") {
    blockers.push(`خطر شموع مشبوهة مرتفع (${suspiciousCandlesCount} شمعة) — يمنع التنفيذ`);
  } else if (fakeCandleRisk === "MEDIUM") {
    warnings.push(`شموع مشبوهة محتملة (${suspiciousCandlesCount}) — تحقق من جودة البيانات`);
  }

  // -- 9. Decision -----------------------------------------------------------
  let decision: MarketStateDecision;

  if (effectiveCandles.length < 3 || suspiciousCandles.filter((s) => s.severity === "BLOCK" && s.index >= effectiveCandles.length - 1).length > 0) {
    decision = "BLOCK_ALL";
  } else if (
    marketSessionStatus === "CLOSED" ||
    !dataFresh ||
    fakeCandleRisk === "HIGH" ||
    spreadStatus === "EXTREME"
  ) {
    decision = "BLOCK_EXECUTION";
  } else if (
    marketSessionStatus === "UNKNOWN" ||
    fakeCandleRisk === "MEDIUM" ||
    marketSessionStatus === "LOW_LIQUIDITY"
    // usingClosedCandleOnly alone does NOT block — using closed candles is correct behaviour
  ) {
    decision = "ANALYSIS_ONLY";
  } else {
    decision = "ALLOW_ANALYSIS";
  }

  // -- 10. Reasons -----------------------------------------------------------
  if (dataFresh && candleAgeMs != null) {
    const ageMins = Math.round(candleAgeMs / 60000);
    reasons.push(`بيانات حديثة — آخر شمعة مغلقة منذ ${ageMins} دقيقة ✓`);
  }
  reasons.push(
    `الشموع المغلقة: ${effectiveCandles.length} | ATR: ${atr.toFixed(5)}`
  );
  if (usingClosedCandleOnly) {
    reasons.push("التحليل B1/B2/B3 يستخدم الشموع المغلقة فقط ✓");
  }

  // -- 11. Confidence --------------------------------------------------------
  const confidence = Math.max(10, Math.min(90,
    40 +
    (dataFresh         ? 20 : -15) +
    (fakeCandleRisk === "LOW"  ? 15 : fakeCandleRisk === "MEDIUM" ? 0 : -15) +
    (spreadStatus === "NORMAL" ? 10 : spreadStatus === "HIGH" ? -5 : spreadStatus === "EXTREME" ? -20 : 0) +
    (marketOpen        ? 5  : -10),
  ));

  return {
    marketOpen,
    symbolTradable:          marketOpen && spreadStatus !== "EXTREME",
    dataFresh,
    usingClosedCandleOnly,
    latestCandleClosed,
    latestCandleTime,
    latestClosedCandleTime,
    tickFresh:               false,     // no tick in server-side route
    tickAgeMs:               null,
    candleAgeMs,
    spreadPoints,
    spreadStatus,
    brokerClockSkewDetected,
    brokerClockSkewMs,
    suspiciousCandlesCount,
    suspiciousCandles:       suspiciousCandles.slice(0, 10),
    fakeCandleRisk,
    marketSessionStatus,
    decision,
    confidence,
    reasons:  reasons.slice(0, 8),
    warnings: warnings.slice(0, 6),
    blockers: blockers.slice(0, 5),
    closedCandles:           effectiveCandles,
  };
}
