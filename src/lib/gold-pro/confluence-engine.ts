// src/lib/gold-pro/confluence-engine.ts
// Confluence Score Engine — Pure Functions
// لا تنفيذ تداول — لا order_send

import type { GoldIndicators, MTFResult, ConfluenceResult, ConfluenceComponent, GoldSignal } from "./types";

interface ConfluenceInput {
  indicators: GoldIndicators;
  mtf: MTFResult;
  currentPrice: number;
  sessionOk: boolean;   // هل الجلسة مناسبة (London/NY)
  newsRisk: boolean;    // هل يوجد خطر أخبار
}

export function calculateConfluence(input: ConfluenceInput): ConfluenceResult {
  const { indicators, mtf, currentPrice, sessionOk, newsRisk } = input;
  const components: ConfluenceComponent[] = [];

  // ─── 1. EMA21 > EMA50 (وزن 10) ──────────────────────────────────────────
  const ema21AboveEma50 = indicators.ema21 > indicators.ema50;
  components.push({
    name: "EMA21 فوق EMA50",
    weight: 10,
    score: ema21AboveEma50 ? 10 : 0,
    reason: ema21AboveEma50 ? "الاتجاه قصير المدى صاعد" : "الاتجاه قصير المدى هابط",
  });

  // ─── 2. EMA50 > EMA200 (وزن 10) ─────────────────────────────────────────
  const ema50AboveEma200 = indicators.ema50 > indicators.ema200;
  components.push({
    name: "EMA50 فوق EMA200",
    weight: 10,
    score: ema50AboveEma200 ? 10 : 0,
    reason: ema50AboveEma200 ? "الاتجاه متوسط المدى صاعد" : "الاتجاه متوسط المدى هابط",
  });

  // ─── 3. MACD Histogram > 0 (وزن 15) ────────────────────────────────────
  const macdBullish = indicators.macd.histogram > 0;
  components.push({
    name: "MACD Histogram",
    weight: 15,
    score: macdBullish ? 15 : 0,
    reason: macdBullish ? `MACD +${indicators.macd.histogram.toFixed(2)} — زخم صاعد` : `MACD ${indicators.macd.histogram.toFixed(2)} — زخم هابط`,
  });

  // ─── 4. RSI في منطقة آمنة 40-70 (وزن 10) ───────────────────────────────
  const rsiSafe = indicators.rsi >= 40 && indicators.rsi <= 70;
  components.push({
    name: "RSI منطقة آمنة (40-70)",
    weight: 10,
    score: rsiSafe ? 10 : 0,
    reason: rsiSafe ? `RSI ${indicators.rsi} — منطقة آمنة` :
      indicators.rsi > 70 ? `RSI ${indicators.rsi} — تشبع شراء` : `RSI ${indicators.rsi} — تشبع بيع`,
  });

  // ─── 5. RSI > 50 للاتجاه الصاعد (وزن 10) ───────────────────────────────
  const rsiAbove50 = indicators.rsi > 50;
  components.push({
    name: "RSI فوق 50",
    weight: 10,
    score: rsiAbove50 ? 10 : 0,
    reason: rsiAbove50 ? "الزخم صاعد" : "الزخم هابط",
  });

  // ─── 6. ADX > 25 اتجاه قوي (وزن 10) ────────────────────────────────────
  const adxStrong = indicators.adx.adx >= 25;
  components.push({
    name: "ADX قوة الاتجاه",
    weight: 10,
    score: adxStrong ? 10 : 0,
    reason: adxStrong ? `ADX ${indicators.adx.adx} — اتجاه قوي` : `ADX ${indicators.adx.adx} — سوق جانبي`,
  });

  // ─── 7. السعر فوق BB Middle (وزن 10) ────────────────────────────────────
  const aboveBBMiddle = currentPrice > indicators.bollingerBands.middle;
  components.push({
    name: "السعر فوق BB Middle",
    weight: 10,
    score: aboveBBMiddle ? 10 : 0,
    reason: aboveBBMiddle ? "السعر في النصف العلوي للـ BB" : "السعر في النصف السفلي للـ BB",
  });

  // ─── 8. توافق MTF 3/4 (وزن 15) ─────────────────────────────────────────
  const mtfAligned = mtf.bullishCount >= 3;
  components.push({
    name: "توافق MTF",
    weight: 15,
    score: mtfAligned ? 15 : 0,
    reason: `${mtf.bullishCount}/4 إطارات صاعدة`,
  });

  // ─── 9. جلسة مناسبة (وزن 5) ─────────────────────────────────────────────
  components.push({
    name: "جلسة التداول",
    weight: 5,
    score: sessionOk ? 5 : 0,
    reason: sessionOk ? "London/NY — سيولة عالية" : "جلسة آسيا — سيولة منخفضة",
  });

  // ─── 10. لا أخبار مؤثرة (وزن 5) ────────────────────────────────────────
  components.push({
    name: "فلتر الأخبار",
    weight: 5,
    score: !newsRisk ? 5 : 0,
    reason: !newsRisk ? "لا أخبار مؤثرة قريبة" : "⚠️ خطر أخبار — تأجيل الدخول",
  });

  const totalScore = components.reduce((sum, c) => sum + c.score, 0);
  const bullishSignals = components.filter(c => c.score > 0).length;

  const signal: GoldSignal = totalScore >= 70 ? "BUY" : totalScore <= 30 ? "SELL" : "WAIT";

  return {
    score: totalScore,
    signal,
    components,
    bullishSignals,
    totalSignals: components.length,
  };
}

// Session detector (UTC hours)
export function detectSession(utcHour: number): { label: string; ok: boolean } {
  if (utcHour >= 7 && utcHour < 16) return { label: "London", ok: true };
  if (utcHour >= 13 && utcHour < 21) return { label: "New York", ok: true };
  if (utcHour >= 0 && utcHour < 7) return { label: "Asian", ok: false };
  return { label: "Off-hours", ok: false };
}
