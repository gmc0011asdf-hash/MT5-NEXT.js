// src/lib/gold-pro/symbol-analysis.ts
// تحليل عام لأي رمز متاح في MT5 — يبني على دوال المؤشرات في indicators.ts
// لا تنفيذ تداول — حساب وعرض فقط (read-only)

import type { RawCandle, GoldIndicators, ConfluenceComponent, GoldSignal } from "./types";
import {
  lastEMA,
  lastRSI,
  calculateATR,
  calculateMACD,
  calculateBollingerBands,
  calculateADX,
  calculateStochRSI,
  calculatePivotPoints,
  calculateFibonacci,
  calculateSupportResistance,
} from "./indicators";

export interface SymbolAnalysisResult {
  price: number;
  indicators: GoldIndicators;
  components: ConfluenceComponent[];
  score: number; // 0-100
  signal: GoldSignal;
}

const MIN_CANDLES_FOR_ANALYSIS = 30;

/** يحسب مجموعة المؤشرات وتوافقها لأي رمز اعتماداً على شموع H1 (أو أي إطار آخر). */
export function analyzeSymbolCandles(candles: RawCandle[]): SymbolAnalysisResult | null {
  if (candles.length < MIN_CANDLES_FOR_ANALYSIS) return null;

  const price = candles[candles.length - 1].close;

  const indicators: GoldIndicators = {
    ema21: lastEMA(candles, 21),
    ema50: lastEMA(candles, 50),
    ema200: lastEMA(candles, 200),
    macd: calculateMACD(candles),
    adx: calculateADX(candles),
    rsi: lastRSI(candles),
    stochRsi: calculateStochRSI(candles),
    atr: calculateATR(candles),
    bollingerBands: calculateBollingerBands(candles),
    pivotPoints: calculatePivotPoints(candles),
    fibonacci: calculateFibonacci(candles),
    supportResistance: calculateSupportResistance(candles, price),
  };

  const components: ConfluenceComponent[] = [];

  const ema21AboveEma50 = indicators.ema21 > indicators.ema50;
  components.push({
    name: "EMA21 فوق EMA50",
    weight: 15,
    score: ema21AboveEma50 ? 15 : 0,
    reason: ema21AboveEma50 ? "الاتجاه قصير المدى صاعد" : "الاتجاه قصير المدى هابط",
  });

  const ema50AboveEma200 = indicators.ema200 > 0 && indicators.ema50 > indicators.ema200;
  components.push({
    name: "EMA50 فوق EMA200",
    weight: 15,
    score: ema50AboveEma200 ? 15 : 0,
    reason: indicators.ema200 === 0
      ? "بيانات غير كافية لحساب EMA200"
      : ema50AboveEma200 ? "الاتجاه العام صاعد" : "الاتجاه العام هابط",
  });

  const macdBullish = indicators.macd.histogram > 0;
  components.push({
    name: "MACD Histogram",
    weight: 20,
    score: macdBullish ? 20 : 0,
    reason: macdBullish
      ? `MACD +${indicators.macd.histogram.toFixed(4)} — زخم صاعد`
      : `MACD ${indicators.macd.histogram.toFixed(4)} — زخم هابط`,
  });

  const rsiSafe = indicators.rsi >= 40 && indicators.rsi <= 70;
  components.push({
    name: "RSI منطقة آمنة (40-70)",
    weight: 15,
    score: rsiSafe ? 15 : 0,
    reason: rsiSafe
      ? `RSI ${indicators.rsi} — منطقة آمنة`
      : indicators.rsi > 70 ? `RSI ${indicators.rsi} — تشبع شراء` : `RSI ${indicators.rsi} — تشبع بيع`,
  });

  const rsiAbove50 = indicators.rsi > 50;
  components.push({
    name: "RSI فوق 50",
    weight: 10,
    score: rsiAbove50 ? 10 : 0,
    reason: rsiAbove50 ? "الزخم صاعد" : "الزخم هابط",
  });

  const adxStrong = indicators.adx.adx >= 25;
  components.push({
    name: "ADX قوة الاتجاه",
    weight: 10,
    score: adxStrong ? 10 : 0,
    reason: adxStrong ? `ADX ${indicators.adx.adx} — اتجاه قوي` : `ADX ${indicators.adx.adx} — سوق جانبي`,
  });

  const aboveBBMiddle = price > indicators.bollingerBands.middle;
  components.push({
    name: "السعر فوق BB Middle",
    weight: 15,
    score: aboveBBMiddle ? 15 : 0,
    reason: aboveBBMiddle ? "السعر في النصف العلوي للـ BB" : "السعر في النصف السفلي للـ BB",
  });

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const totalScore = components.reduce((sum, c) => sum + c.score, 0);
  const score = totalWeight > 0 ? Math.round((totalScore / totalWeight) * 100) : 0;

  const signal: GoldSignal = score >= 70 ? "BUY" : score <= 30 ? "SELL" : "WAIT";

  return { price, indicators, components, score, signal };
}
