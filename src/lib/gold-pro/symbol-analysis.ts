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
  ictPatterns: string[];
}

const MIN_CANDLES_FOR_ANALYSIS = 30;

function detectICTPatterns(candles: RawCandle[]): string[] {
  if (candles.length < 5) return [];
  const patterns: string[] = [];
  
  // Recent 3 candles
  const c1 = candles[candles.length - 3]; // oldest of the 3
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1]; // latest
  
  // 1. Bullish FVG (Fair Value Gap)
  if (c3.low > c1.high && c2.close > c2.open) {
    patterns.push("Bullish: فجوة سعرية عادلة صاعدة (Bullish FVG) - تدل على قوة شرائية ومغناطيس للسعر");
  }
  
  // 2. Bearish FVG
  if (c1.low > c3.high && c2.close < c2.open) {
    patterns.push("Bearish: فجوة سعرية عادلة هابطة (Bearish FVG) - تدل على قوة بيعية ومغناطيس للسعر");
  }
  
  // 3. Bullish Order Block (OB) - Last down candle before strong up move
  if (c2.close < c2.open && c3.close > c3.open && c3.close > c2.high) {
    patterns.push("Bullish: بلوك أوامر شرائي (Order Block) - منطقة طلب محتملة لصناع السوق");
  }
  
  // 4. Bearish Order Block (OB) - Last up candle before strong down move
  if (c2.close > c2.open && c3.close < c3.open && c3.close < c2.low) {
    patterns.push("Bearish: بلوك أوامر بيعي (Order Block) - منطقة عرض محتملة لصناع السوق");
  }
  
  // 5. Bullish Pin Bar / Hammer (Rejection)
  const body3 = Math.abs(c3.close - c3.open);
  const total3 = c3.high - c3.low;
  const lowerWick3 = Math.min(c3.open, c3.close) - c3.low;
  if (total3 > 0 && lowerWick3 > total3 * 0.6 && body3 < total3 * 0.3) {
    patterns.push("Bullish: شمعة رفض شرائية (Pin Bar / Hammer) - تدل على رفض الهبوط وقوة المشترين");
  }
  
  // 6. Bearish Pin Bar / Shooting Star (Rejection)
  const upperWick3 = c3.high - Math.max(c3.open, c3.close);
  if (total3 > 0 && upperWick3 > total3 * 0.6 && body3 < total3 * 0.3) {
    patterns.push("Bearish: شمعة رفض بيعية (Shooting Star) - تدل على رفض الصعود وقوة البائعين");
  }
  
  // 7. Engulfing
  const body2 = Math.abs(c2.close - c2.open);
  if (c2.close < c2.open && c3.close > c3.open && body3 > body2 && c3.close > c2.open && c3.open < c2.close) {
    patterns.push("Bullish: شمعة ابتلاعية شرائية (Bullish Engulfing) - انعكاس قوي للاتجاه الهابط");
  }
  if (c2.close > c2.open && c3.close < c3.open && body3 > body2 && c3.close < c2.open && c3.open > c2.close) {
    patterns.push("Bearish: شمعة ابتلاعية بيعية (Bearish Engulfing) - انعكاس قوي للاتجاه الصاعد");
  }

  return patterns;
}

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

  const ictPatterns = detectICTPatterns(candles);
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

  return { price, indicators, components, score, signal, ictPatterns };
}
