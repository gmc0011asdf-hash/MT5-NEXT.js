// src/lib/gold-pro/trade-setups.ts
// محرك الصفقات المتعددة — Multi-Timeframe Trade Setup Generator
// لا تنفيذ تداول — تحليل معلوماتي فقط — لا order_send

import type { RawCandle, TradeSetup, TradeSetupId } from "./types";
import { lastEMA, lastRSI, calculateATR, calculateMACD, calculateADX } from "./indicators";
import { calculateSLTP, calculatePositionSize } from "./position-sizing";

// --- إعداد المضاعفات لكل إطار زمني ------------------------------------------
const TF_CONFIG: Record<TradeSetupId, {
  sl: number;
  tp1: number;
  tp2: number;
  atrFallback: number;  // ATR افتراضي لـ XAUUSD عند شُح البيانات
  minCandles: number;
}> = {
  H4_SWING:    { sl: 2.0, tp1: 3.0, tp2: 5.0, atrFallback: 18.0, minCandles: 28 },
  H1_INTRADAY: { sl: 1.5, tp1: 2.0, tp2: 3.0, atrFallback: 8.0,  minCandles: 22 },
  M15_SCALP:   { sl: 1.5, tp1: 1.5, tp2: 2.5, atrFallback: 4.0,  minCandles: 22 },
};

interface SetupInput {
  id: TradeSetupId;
  label: string;
  emoji: string;
  candles: RawCandle[];
  currentPrice: number;
  balance: number;
  sessionOk: boolean;
}

// --- بناء إعداد صفقة واحدة ---------------------------------------------------
function buildSetup(input: SetupInput): TradeSetup | null {
  const { id, label, emoji, candles, currentPrice, balance, sessionOk } = input;
  const cfg = TF_CONFIG[id];

  // M15: فقط في جلسات London/NY للسيولة الكافية
  if (id === "M15_SCALP" && !sessionOk) return null;

  if (candles.length < cfg.minCandles) return null;

  // --- حساب المؤشرات -----------------------------------------------
  const e21  = lastEMA(candles, 21);
  const e50  = lastEMA(candles, 50);
  const e200 = lastEMA(candles, 200);
  const rsi  = lastRSI(candles, 14);
  const macd = calculateMACD(candles);
  const adx  = calculateADX(candles);
  const atrCalc = calculateATR(candles, 14);
  const atr  = atrCalc > 0 ? atrCalc : cfg.atrFallback;

  // --- حساب نقاط الثقة — Bullish vs Bearish ------------------------
  let bull = 0;
  let bear = 0;
  const reasons: string[] = [];

  // EMA21 vs EMA50 (وزن 25)
  if (e21 > 0 && e50 > 0) {
    if (e21 > e50) {
      bull += 25;
      reasons.push("EMA21 فوق EMA50 ↑");
    } else {
      bear += 25;
      reasons.push("EMA21 تحت EMA50 ↓");
    }
  }

  // EMA50 vs EMA200 (وزن 20) — فقط عند توفر البيانات
  if (e50 > 0 && e200 > 0) {
    if (e50 > e200) {
      bull += 20;
      reasons.push("EMA50 فوق EMA200 — اتجاه طويل صاعد");
    } else {
      bear += 20;
      reasons.push("EMA50 تحت EMA200 — اتجاه طويل هابط");
    }
  }

  // RSI (وزن 20)
  if (rsi !== 50) { // 50 يعني لا بيانات كافية
    if (rsi > 55 && rsi < 75) {
      bull += 20;
      reasons.push(`RSI ${rsi} — زخم صاعد`);
    } else if (rsi < 45 && rsi > 25) {
      bear += 20;
      reasons.push(`RSI ${rsi} — زخم هابط`);
    } else if (rsi >= 75) {
      bear += 10;
      reasons.push(`RSI ${rsi} — تشبع شراء ⚠`);
    } else if (rsi <= 25) {
      bull += 10;
      reasons.push(`RSI ${rsi} — تشبع بيع ⚠`);
    }
  }

  // MACD Histogram (وزن 20)
  if (macd.histogram !== 0) {
    if (macd.histogram > 0) {
      bull += 20;
      reasons.push(`MACD +${macd.histogram.toFixed(2)} — زخم صاعد`);
    } else {
      bear += 20;
      reasons.push(`MACD ${macd.histogram.toFixed(2)} — زخم هابط`);
    }
  }

  // ADX: مضاعف للاتجاه السائد (وزن 10)
  if (adx.adx >= 20) {
    reasons.push(`ADX ${adx.adx.toFixed(1)} — اتجاه ${adx.strength === "strong" ? "قوي" : "نشط"}`);
    if (bull > bear) bull += 10;
    else if (bear > bull) bear += 10;
  }

  // السعر فوق/تحت EMA50 (وزن 5)
  if (e50 > 0) {
    if (currentPrice > e50) bull += 5;
    else bear += 5;
  }

  // --- قرار الإشارة -------------------------------------------------
  const maxScore = 100;
  let signal: "BUY" | "SELL";
  let confidence: number;

  if (bull >= 40 && bull > bear) {
    signal = "BUY";
    confidence = Math.round(Math.min(100, (bull / maxScore) * 100));
  } else if (bear >= 40 && bear >= bull) {
    signal = "SELL";
    confidence = Math.round(Math.min(100, (bear / maxScore) * 100));
  } else {
    return null; // إشارة غير كافية — WAIT
  }

  // --- حساب SL/TP و Lot Size ---------------------------------------
  const sltp = calculateSLTP(currentPrice, atr, signal, cfg.sl, cfg.tp1, cfg.tp2);
  const sizing = calculatePositionSize(balance, sltp.slDistance);

  return {
    id,
    label,
    emoji,
    signal,
    confidence,
    entryPrice: sltp.entryPrice,
    stopLoss: sltp.stopLoss,
    takeProfit1: sltp.takeProfit1,
    takeProfit2: sltp.takeProfit2,
    slDistance: sltp.slDistance,
    tp1Distance: sltp.tp1Distance,
    tp2Distance: sltp.tp2Distance,
    rrRatio1: sltp.rrRatio1,
    rrRatio2: sltp.rrRatio2,
    lotSize: sizing.lotSize,
    riskUsd: sizing.potentialLossUsd,
    potentialProfitUsd: sizing.potentialProfitUsd,
    atr,
    reasons,
    sessionWarning: id === "M15_SCALP" && !sessionOk ? "خارج جلسات London/NY" : undefined,
  };
}

// --- المُصدَّر الرئيسي --------------------------------------------------------
export function generateTradeSetups(
  currentPrice: number,
  balance: number,
  candlesM15: RawCandle[],
  candlesH1: RawCandle[],
  candlesH4: RawCandle[],
  sessionOk: boolean,
): TradeSetup[] {
  const results: TradeSetup[] = [];

  const h4 = buildSetup({
    id: "H4_SWING", label: "Swing H4", emoji: "🌊",
    candles: candlesH4, currentPrice, balance, sessionOk,
  });
  const h1 = buildSetup({
    id: "H1_INTRADAY", label: "Intraday H1", emoji: "📈",
    candles: candlesH1, currentPrice, balance, sessionOk,
  });
  const m15 = buildSetup({
    id: "M15_SCALP", label: "Scalp M15", emoji: "⚡",
    candles: candlesM15, currentPrice, balance, sessionOk,
  });

  if (h4)  results.push(h4);
  if (h1)  results.push(h1);
  if (m15) results.push(m15);

  // فرز: الأعلى ثقة أولاً
  return results.sort((a, b) => b.confidence - a.confidence);
}
