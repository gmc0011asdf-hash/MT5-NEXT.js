// src/lib/gold-pro/indicators.ts
// محرك المؤشرات الفنية — Pure Functions — لا side effects
// لا order_send — لا تنفيذ تداول — قراءة وحساب فقط

import type {
  RawCandle, MACDResult, BollingerBands, ADXResult,
  StochRSIResult, PivotPoints, FibonacciLevels,
  SupportResistanceLevels,
} from "./types";

// ─── EMA ─────────────────────────────────────────────────────────────────────

export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return prices.map(() => NaN);
  const k = 2 / (period + 1);
  const result: number[] = new Array(prices.length).fill(NaN);
  // أول قيمة = SMA للـ period الأولى
  const firstSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = firstSMA;
  for (let i = period; i < prices.length; i++) {
    result[i] = prices[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function lastEMA(candles: RawCandle[], period: number): number {
  const closes = candles.map(c => c.close);
  const emas = calculateEMA(closes, period);
  const last = emas[emas.length - 1];
  return isNaN(last) ? 0 : last;
}

// ─── RSI (Wilder) ─────────────────────────────────────────────────────────────

export function calculateRSI(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return closes.map(() => NaN);
  const changes = closes.slice(1).map((p, i) => p - closes[i]);
  const result: number[] = new Array(closes.length).fill(NaN);

  // Initial averages (simple)
  let avgGain = changes.slice(0, period).filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  let avgLoss = changes.slice(0, period).filter(c => c < 0).reduce((a, b) => a + Math.abs(b), 0) / period;
  result[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));

  // Wilder smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const change = changes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  }
  return result;
}

export function lastRSI(candles: RawCandle[], period = 14): number {
  const rsiArr = calculateRSI(candles.map(c => c.close), period);
  const last = rsiArr[rsiArr.length - 1];
  return isNaN(last) ? 50 : Math.round(last * 10) / 10;
}

// ─── ATR (Wilder) ─────────────────────────────────────────────────────────────

export function calculateATR(candles: RawCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    ));
  }
  // Initial ATR = SMA of first `period` TRs
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Wilder smoothing
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return Math.round(atr * 100) / 100;
}

// ─── MACD (12, 26, 9) ────────────────────────────────────────────────────────

export function calculateMACD(candles: RawCandle[]): MACDResult {
  const closes = candles.map(c => c.close);
  if (closes.length < 35) return { value: 0, signal: 0, histogram: 0 };
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => (isNaN(v) || isNaN(ema26[i])) ? NaN : v - ema26[i]);
  const validMacd = macdLine.filter(v => !isNaN(v));
  if (validMacd.length < 9) return { value: 0, signal: 0, histogram: 0 };
  const signalArr = calculateEMA(validMacd, 9);
  const lastMacd = validMacd[validMacd.length - 1];
  const lastSignal = signalArr[signalArr.length - 1];
  const value = Math.round(lastMacd * 100) / 100;
  const signal = Math.round(lastSignal * 100) / 100;
  return { value, signal, histogram: Math.round((value - signal) * 100) / 100 };
}

// ─── Bollinger Bands (20, 2σ) ────────────────────────────────────────────────

export function calculateBollingerBands(candles: RawCandle[], period = 20): BollingerBands {
  if (candles.length < period) {
    const close = candles[candles.length - 1]?.close ?? 0;
    return { upper: close, middle: close, lower: close, width: 0, position: "middle" };
  }
  const slice = candles.slice(-period).map(c => c.close);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = sma + 2 * std;
  const lower = sma - 2 * std;
  const width = sma > 0 ? Math.round(((upper - lower) / sma) * 10000) / 100 : 0;
  const currentPrice = candles[candles.length - 1].close;
  const position: BollingerBands["position"] =
    currentPrice > sma + std * 0.5 ? "above" :
    currentPrice < sma - std * 0.5 ? "below" : "middle";
  return {
    upper: Math.round(upper * 100) / 100,
    middle: Math.round(sma * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    width,
    position,
  };
}

// ─── ADX (14) ────────────────────────────────────────────────────────────────

export function calculateADX(candles: RawCandle[], period = 14): ADXResult {
  if (candles.length < period * 2) {
    return { adx: 0, diPlus: 0, diMinus: 0, strength: "weak" };
  }
  const dms: Array<{ plus: number; minus: number; tr: number }> = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    const dmPlus = (upMove > downMove && upMove > 0) ? upMove : 0;
    const dmMinus = (downMove > upMove && downMove > 0) ? downMove : 0;
    const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close));
    dms.push({ plus: dmPlus, minus: dmMinus, tr });
  }
  // Wilder smooth
  let smoothTR = dms.slice(0, period).reduce((a, b) => a + b.tr, 0);
  let smoothPlus = dms.slice(0, period).reduce((a, b) => a + b.plus, 0);
  let smoothMinus = dms.slice(0, period).reduce((a, b) => a + b.minus, 0);
  const dxArr: number[] = [];
  for (let i = period; i < dms.length; i++) {
    smoothTR = smoothTR - smoothTR / period + dms[i].tr;
    smoothPlus = smoothPlus - smoothPlus / period + dms[i].plus;
    smoothMinus = smoothMinus - smoothMinus / period + dms[i].minus;
    const diPlus = smoothTR > 0 ? (smoothPlus / smoothTR) * 100 : 0;
    const diMinus = smoothTR > 0 ? (smoothMinus / smoothTR) * 100 : 0;
    const diSum = diPlus + diMinus;
    dxArr.push(diSum > 0 ? Math.abs(diPlus - diMinus) / diSum * 100 : 0);
  }
  const adxRaw = dxArr.slice(-period).reduce((a, b) => a + b, 0) / Math.min(dxArr.length, period);
  const adx = Math.round(adxRaw * 10) / 10;
  // last DI values
  const lastTR = smoothTR;
  const diPlus = Math.round((lastTR > 0 ? (smoothPlus / lastTR) * 100 : 0) * 10) / 10;
  const diMinus = Math.round((lastTR > 0 ? (smoothMinus / lastTR) * 100 : 0) * 10) / 10;
  const strength: ADXResult["strength"] = adx >= 25 ? "strong" : adx >= 20 ? "moderate" : "weak";
  return { adx, diPlus, diMinus, strength };
}

// ─── Stochastic RSI ───────────────────────────────────────────────────────────

export function calculateStochRSI(candles: RawCandle[], rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3): StochRSIResult {
  const rsiArr = calculateRSI(candles.map(c => c.close), rsiPeriod).filter(v => !isNaN(v));
  if (rsiArr.length < stochPeriod + kPeriod + dPeriod) {
    return { k: 50, d: 50, zone: "neutral" };
  }
  const stochArr: number[] = [];
  for (let i = stochPeriod - 1; i < rsiArr.length; i++) {
    const window = rsiArr.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...window);
    const max = Math.max(...window);
    stochArr.push(max === min ? 0 : ((rsiArr[i] - min) / (max - min)) * 100);
  }
  // K = SMA(stoch, kPeriod)
  const kArr: number[] = [];
  for (let i = kPeriod - 1; i < stochArr.length; i++) {
    kArr.push(stochArr.slice(i - kPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / kPeriod);
  }
  // D = SMA(k, dPeriod)
  const dArr: number[] = [];
  for (let i = dPeriod - 1; i < kArr.length; i++) {
    dArr.push(kArr.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod);
  }
  const k = Math.round((kArr[kArr.length - 1] ?? 50) * 10) / 10;
  const d = Math.round((dArr[dArr.length - 1] ?? 50) * 10) / 10;
  const zone: StochRSIResult["zone"] = k >= 80 ? "overbought" : k <= 20 ? "oversold" : "neutral";
  return { k, d, zone };
}

// ─── Pivot Points (Floor Method — Daily) ────────────────────────────────────

export function calculatePivotPoints(candles: RawCandle[]): PivotPoints {
  if (candles.length === 0) return { r2: 0, r1: 0, pp: 0, s1: 0, s2: 0 };
  // استخدم آخر شمعة D1 مغلقة
  const prev = candles.length >= 2 ? candles[candles.length - 2] : candles[candles.length - 1];
  const pp = (prev.high + prev.low + prev.close) / 3;
  return {
    r2: Math.round((pp + (prev.high - prev.low)) * 100) / 100,
    r1: Math.round((2 * pp - prev.low) * 100) / 100,
    pp: Math.round(pp * 100) / 100,
    s1: Math.round((2 * pp - prev.high) * 100) / 100,
    s2: Math.round((pp - (prev.high - prev.low)) * 100) / 100,
  };
}

// ─── Fibonacci (Swing H/L من آخر 20 شمعة H4) ────────────────────────────────

export function calculateFibonacci(candlesH4: RawCandle[]): FibonacciLevels {
  if (candlesH4.length === 0) return { swingHigh: 0, swingLow: 0, level236: 0, level382: 0, level500: 0, level618: 0, level786: 0 };
  const slice = candlesH4.slice(-20);
  const swingHigh = Math.max(...slice.map(c => c.high));
  const swingLow = Math.min(...slice.map(c => c.low));
  const range = swingHigh - swingLow;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    swingHigh: r(swingHigh),
    swingLow: r(swingLow),
    level236: r(swingHigh - range * 0.236),
    level382: r(swingHigh - range * 0.382),
    level500: r(swingHigh - range * 0.500),
    level618: r(swingHigh - range * 0.618),
    level786: r(swingHigh - range * 0.786),
  };
}

// ─── Support & Resistance (من قمم وقيعان H1) ───────────────────────────────

export function calculateSupportResistance(candlesH1: RawCandle[], currentPrice: number): SupportResistanceLevels {
  const highs = candlesH1.map(c => c.high);
  const lows = candlesH1.map(c => c.low);
  // كشف القمم المحلية
  const resistances: number[] = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] &&
        highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
      resistances.push(Math.round(highs[i] * 100) / 100);
    }
  }
  // كشف القيعان المحلية
  const supports: number[] = [];
  for (let i = 2; i < lows.length - 2; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] &&
        lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
      supports.push(Math.round(lows[i] * 100) / 100);
    }
  }
  return {
    supports: supports.filter(s => s < currentPrice).sort((a, b) => b - a).slice(0, 3),
    resistances: resistances.filter(r => r > currentPrice).sort((a, b) => a - b).slice(0, 3),
  };
}
