# Gold Pro Lab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** بناء مختبر تحليل ذهب مؤسسي في `/lab/gold-pro` يحسب 10 مؤشرات من بيانات MT5 المباشرة ويولّد توصية BUY/SELL/WAIT مع Confluence Score + SL/TP + Position Sizing.

**Architecture:** Hybrid — حسابات TypeScript في المتصفح للسرعة + حفظ snapshots في Convex للتاريخ. البيانات تأتي من MT5 Bridge على `/readonly/candles` و `/readonly/ticks`.

**Tech Stack:** Next.js 16 · TypeScript · Tailwind CSS v4 · Convex · Clerk Auth · Lucide React · MT5 FastAPI Bridge (port 8010)

**Critical Rules:**
- لا `order_send` أو أي تنفيذ تداول
- لا تعديل على `convex/technicalIndicators.ts` أو `mt5_readonly_service/main.py` أو `src/app/api/lab/analyze-preview/route.ts`
- كل Convex mutation تستخدم `ctx.auth.getUserIdentity()` — لا userId من الواجهة
- تشغيل `pnpm exec tsc --noEmit` و `pnpm run build` قبل كل commit
- RTL في كل مكوّن UI

---

## File Map

### New Files
```
src/lib/gold-pro/
├── types.ts                    ← جميع TypeScript interfaces
├── indicators.ts               ← EMA/RSI/ATR/MACD/BB/ADX/StochRSI/Pivot/Fib/S&R
├── confluence-engine.ts        ← Confluence Score (0-100) + BUY/SELL/WAIT
└── position-sizing.ts          ← 2% rule + ATR SL/TP + Lot calculation

src/app/api/lab/gold-pro/
├── analysis/route.ts           ← GET — يجلب candles+ticks من MT5 Bridge
└── save-snapshot/route.ts      ← POST — يحفظ snapshot في Convex

src/components/gold-pro/
├── GoldProLab.tsx              ← المكوّن الرئيسي (orchestrator)
├── PriceHeader.tsx             ← السعر الحي + Session + News warning
├── ConfluenceScore.tsx         ← الرقم + ring + تصنيف
├── SignalCard.tsx              ← BUY/SELL/WAIT + Entry/SL/TP/RR
├── PositionSizingPanel.tsx     ← Lot + مخاطرة $  + P&L متوقع
├── MTFPanel.tsx                ← M15/H1/H4/D1 اتجاه + ADX
├── IndicatorsPanel.tsx         ← EMA/MACD/RSI/ATR/BB تفصيلي
├── SupportResistancePanel.tsx  ← Fib + S/R مستويات
├── PivotPointsPanel.tsx        ← R2/R1/PP/S1/S2 يومية
└── AnalysisHistory.tsx         ← آخر 10 توصيات + دقة %

src/app/(dashboard)/lab/gold-pro/
└── page.tsx                    ← الصفحة (Client Component)

convex/
└── goldProAnalysis.ts          ← mutations + queries

```

### Modified Files
```
convex/schema.ts                ← إضافة goldProAnalysis table
src/lib/constants/navigation.ts ← إضافة "Gold Pro Lab" في قسم الذهب
```

---

## Task 1: Types

**Files:**
- Create: `src/lib/gold-pro/types.ts`

- [ ] **1.1 — أنشئ الملف**

```typescript
// src/lib/gold-pro/types.ts
// ─── Raw Data from MT5 Bridge ─────────────────────────────────────────────────

export interface RawCandle {
  symbol: string;
  timeframe: string;
  time: number;
  time_iso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_volume: number;
  spread: number;
}

export interface RawTick {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  spread_points: number;
  time: string;
  market_closed: boolean;
}

export interface MT5BridgeAnalysisData {
  connected: boolean;
  ticks: RawTick[];
  candlesM15: RawCandle[];
  candlesH1: RawCandle[];
  candlesH4: RawCandle[];
  candlesD1: RawCandle[];
  balance: number;
  equity: number;
}

// ─── Indicator Results ────────────────────────────────────────────────────────

export interface MACDResult {
  value: number;      // MACD line
  signal: number;     // Signal line
  histogram: number;  // MACD - Signal
}

export interface BollingerBands {
  upper: number;
  middle: number;  // SMA20
  lower: number;
  width: number;   // (upper - lower) / middle × 100 (%)
  position: "above" | "middle" | "below"; // السعر بالنسبة للوسط
}

export interface ADXResult {
  adx: number;
  diPlus: number;
  diMinus: number;
  strength: "strong" | "moderate" | "weak"; // >25 strong, 20-25 moderate, <20 weak
}

export interface StochRSIResult {
  k: number;
  d: number;
  zone: "overbought" | "neutral" | "oversold"; // k>80 overbought, k<20 oversold
}

export interface PivotPoints {
  r2: number;
  r1: number;
  pp: number;
  s1: number;
  s2: number;
}

export interface FibonacciLevels {
  swingHigh: number;
  swingLow: number;
  level236: number;
  level382: number;
  level500: number;
  level618: number;
  level786: number;
}

export interface SupportResistanceLevels {
  supports: number[];     // أقرب 3 مستويات دعم تحت السعر
  resistances: number[];  // أقرب 3 مستويات مقاومة فوق السعر
}

// ─── Full Indicator Set ───────────────────────────────────────────────────────

export interface GoldIndicators {
  // Trend
  ema21: number;
  ema50: number;
  ema200: number;
  macd: MACDResult;
  adx: ADXResult;
  // Momentum
  rsi: number;
  stochRsi: StochRSIResult;
  // Volatility
  atr: number;
  bollingerBands: BollingerBands;
  // Levels
  pivotPoints: PivotPoints;
  fibonacci: FibonacciLevels;
  supportResistance: SupportResistanceLevels;
}

// ─── MTF ─────────────────────────────────────────────────────────────────────

export type TFBias = "bullish" | "bearish" | "neutral";

export interface TimeframeAnalysis {
  timeframe: "M15" | "H1" | "H4" | "D1";
  bias: TFBias;
  rsi: number;
  emaFastAboveSlow: boolean; // EMA21 > EMA50
  aboveEma200: boolean;
}

export interface MTFResult {
  m15: TimeframeAnalysis;
  h1: TimeframeAnalysis;
  h4: TimeframeAnalysis;
  d1: TimeframeAnalysis;
  bullishCount: number;  // 0-4
  alignment: number;     // 0-100
}

// ─── Signal & Confluence ──────────────────────────────────────────────────────

export type GoldSignal = "BUY" | "SELL" | "WAIT";

export interface ConfluenceComponent {
  name: string;
  weight: number;
  score: number;   // 0 أو weight (pass/fail)
  reason: string;
}

export interface ConfluenceResult {
  score: number;        // 0-100
  signal: GoldSignal;
  components: ConfluenceComponent[];
  bullishSignals: number;
  totalSignals: number;
}

// ─── Position Sizing ──────────────────────────────────────────────────────────

export interface SLTPResult {
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  slDistance: number;   // نقاط
  tp1Distance: number;
  tp2Distance: number;
  rrRatio1: number;     // TP1 / SL
  rrRatio2: number;     // TP2 / SL
}

export interface PositionSizingResult {
  balance: number;
  riskPercent: number;        // 0.02 = 2%
  riskAmountUsd: number;      // balance × riskPercent
  lotSize: number;            // محسوب
  lotSizeRaw: number;         // قبل التقريب
  potentialLossUsd: number;   // lotSize × slDistance × tickValue
  potentialProfitUsd: number; // TP1
  tickValue: number;          // $0.1 per point per 0.01 lot for XAUUSD
}

// ─── Full Analysis Result ─────────────────────────────────────────────────────

export interface GoldProAnalysis {
  timestamp: number;
  symbol: "XAUUSD";
  price: number;      // ASK
  bid: number;
  ask: number;
  spread: number;
  marketClosed: boolean;
  sessionLabel: string;  // "London" | "New York" | "Asian" | "Off-hours"
  indicators: GoldIndicators;
  mtf: MTFResult;
  confluence: ConfluenceResult;
  sltp: SLTPResult;
  positioning: PositionSizingResult;
  dataQuality: "good" | "partial" | "stale";
}

// ─── Convex Snapshot ─────────────────────────────────────────────────────────

export interface GoldProSnapshot {
  symbol: string;
  timestamp: number;
  price: number;
  signal: GoldSignal;
  confluenceScore: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  rrRatio: number;
  lotSize: number;
  atr: number;
  mtfAlignment: number;
  indicators: {
    ema21: number;
    ema50: number;
    ema200: number;
    rsi: number;
    macd: number;
    adx: number;
    bbPosition: string;
  };
  outcome?: "win" | "loss" | "pending";
}
```

- [ ] **1.2 — تحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```
المتوقع: zero errors

- [ ] **1.3 — Commit**

```bash
git add src/lib/gold-pro/types.ts
git commit -m "feat(gold-pro): add TypeScript types for analysis lab"
```

---

## Task 2: Indicators Engine

**Files:**
- Create: `src/lib/gold-pro/indicators.ts`

- [ ] **2.1 — أنشئ الملف بالمحتوى الكامل**

```typescript
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
```

- [ ] **2.2 — تحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```
المتوقع: zero errors

- [ ] **2.3 — Commit**

```bash
git add src/lib/gold-pro/indicators.ts
git commit -m "feat(gold-pro): add indicators engine (EMA/RSI/ATR/MACD/BB/ADX/StochRSI/Pivot/Fib/SR)"
```

---

## Task 3: Confluence Engine

**Files:**
- Create: `src/lib/gold-pro/confluence-engine.ts`

- [ ] **3.1 — أنشئ الملف**

```typescript
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
```

- [ ] **3.2 — تحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```
المتوقع: zero errors

- [ ] **3.3 — Commit**

```bash
git add src/lib/gold-pro/confluence-engine.ts
git commit -m "feat(gold-pro): add Confluence Score engine (10 signals, 0-100)"
```

---

## Task 4: Position Sizing

**Files:**
- Create: `src/lib/gold-pro/position-sizing.ts`

- [ ] **4.1 — أنشئ الملف**

```typescript
// src/lib/gold-pro/position-sizing.ts
// Position Sizing + SL/TP Engine — لا تنفيذ تداول
// XAUUSD: contract_size = 100 oz, tick_size = 0.01, tick_value = $0.1 per 0.01 lot

import type { SLTPResult, PositionSizingResult, GoldSignal } from "./types";

// ثابت XAUUSD من Symbol Info المستخرج من MT5 Bridge
const TICK_VALUE_PER_POINT_PER_LOT = 10; // $10 per point per 1 lot
const MIN_LOT = 0.01;
const MAX_LOT = 10.0;
const LOT_STEP = 0.01;

export function calculateSLTP(
  entryPrice: number,
  atr: number,
  signal: GoldSignal,
  slMultiplier = 1.5,
  tp1Multiplier = 2.0,
  tp2Multiplier = 3.0,
): SLTPResult {
  const slDist = Math.round(atr * slMultiplier * 100) / 100;
  const tp1Dist = Math.round(atr * tp1Multiplier * 100) / 100;
  const tp2Dist = Math.round(atr * tp2Multiplier * 100) / 100;

  if (signal === "BUY") {
    return {
      entryPrice,
      stopLoss: Math.round((entryPrice - slDist) * 100) / 100,
      takeProfit1: Math.round((entryPrice + tp1Dist) * 100) / 100,
      takeProfit2: Math.round((entryPrice + tp2Dist) * 100) / 100,
      slDistance: slDist,
      tp1Distance: tp1Dist,
      tp2Distance: tp2Dist,
      rrRatio1: Math.round((tp1Multiplier / slMultiplier) * 100) / 100,
      rrRatio2: Math.round((tp2Multiplier / slMultiplier) * 100) / 100,
    };
  } else if (signal === "SELL") {
    return {
      entryPrice,
      stopLoss: Math.round((entryPrice + slDist) * 100) / 100,
      takeProfit1: Math.round((entryPrice - tp1Dist) * 100) / 100,
      takeProfit2: Math.round((entryPrice - tp2Dist) * 100) / 100,
      slDistance: slDist,
      tp1Distance: tp1Dist,
      tp2Distance: tp2Dist,
      rrRatio1: Math.round((tp1Multiplier / slMultiplier) * 100) / 100,
      rrRatio2: Math.round((tp2Multiplier / slMultiplier) * 100) / 100,
    };
  }
  // WAIT — same as BUY for display only
  return {
    entryPrice,
    stopLoss: Math.round((entryPrice - slDist) * 100) / 100,
    takeProfit1: Math.round((entryPrice + tp1Dist) * 100) / 100,
    takeProfit2: Math.round((entryPrice + tp2Dist) * 100) / 100,
    slDistance: slDist,
    tp1Distance: tp1Dist,
    tp2Distance: tp2Dist,
    rrRatio1: Math.round((tp1Multiplier / slMultiplier) * 100) / 100,
    rrRatio2: Math.round((tp2Multiplier / slMultiplier) * 100) / 100,
  };
}

export function calculatePositionSize(
  balance: number,
  slDistance: number, // بالنقاط (USD)
  riskPercent = 0.02,
): PositionSizingResult {
  const riskAmountUsd = Math.round(balance * riskPercent * 100) / 100;
  // Lot = riskAmount / (slDistance * tickValuePerPointPerLot)
  const lotSizeRaw = slDistance > 0 ? riskAmountUsd / (slDistance * TICK_VALUE_PER_POINT_PER_LOT) : MIN_LOT;
  // تقريب لأدنى خطوة lot
  const lotSizeRounded = Math.floor(lotSizeRaw / LOT_STEP) * LOT_STEP;
  const lotSize = Math.max(MIN_LOT, Math.min(MAX_LOT, Math.round(lotSizeRounded * 100) / 100));

  const potentialLossUsd = Math.round(lotSize * slDistance * TICK_VALUE_PER_POINT_PER_LOT * 100) / 100;
  const potentialProfitUsd = Math.round(lotSize * slDistance * 2 * TICK_VALUE_PER_POINT_PER_LOT * 100) / 100;

  return {
    balance,
    riskPercent,
    riskAmountUsd,
    lotSize,
    lotSizeRaw: Math.round(lotSizeRaw * 10000) / 10000,
    potentialLossUsd,
    potentialProfitUsd,
    tickValue: TICK_VALUE_PER_POINT_PER_LOT,
  };
}
```

- [ ] **4.2 — تحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```
المتوقع: zero errors

- [ ] **4.3 — Commit**

```bash
git add src/lib/gold-pro/position-sizing.ts
git commit -m "feat(gold-pro): add position sizing engine (2% rule + ATR SL/TP)"
```

---

## Task 5: API Route — Analysis

**Files:**
- Create: `src/app/api/lab/gold-pro/analysis/route.ts`

- [ ] **5.1 — أنشئ المجلد والملف**

```typescript
// src/app/api/lab/gold-pro/analysis/route.ts
// GET /api/lab/gold-pro/analysis
// يجلب candles + ticks من MT5 Bridge ويرجعها للعميل
// لا تنفيذ تداول — Read-only

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const BRIDGE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function GET() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ── جلب البيانات بالتوازي ─────────────────────────────────────────────
    const [snapshotRes, h1Res, h4Res, d1Res, m15Res] = await Promise.all([
      fetch(`${BRIDGE}/readonly/snapshot?symbol=XAUUSD`, { cache: "no-store" }),
      fetch(`${BRIDGE}/readonly/candles?symbol=XAUUSD&timeframe=H1&count=100`, { cache: "no-store" }),
      fetch(`${BRIDGE}/readonly/candles?symbol=XAUUSD&timeframe=H4&count=50`, { cache: "no-store" }),
      fetch(`${BRIDGE}/readonly/candles?symbol=XAUUSD&timeframe=D1&count=30`, { cache: "no-store" }),
      fetch(`${BRIDGE}/readonly/candles?symbol=XAUUSD&timeframe=M15&count=60`, { cache: "no-store" }),
    ]);

    if (!snapshotRes.ok || !h1Res.ok) {
      return NextResponse.json({ error: "MT5 Bridge غير متصل" }, { status: 503 });
    }

    const [snapshot, h1Data, h4Data, d1Data, m15Data] = await Promise.all([
      snapshotRes.json(),
      h1Res.json(),
      h4Res.json(),
      d1Res.json(),
      m15Res.json(),
    ]);

    // ── استخراج XAUUSD فقط من البيانات ──────────────────────────────────
    const xauTick = snapshot.ticks?.find((t: { symbol: string }) => t.symbol === "XAUUSD");
    const filterXAU = (candles: Array<{ symbol: string; timeframe: string }>) =>
      candles.filter(c => c.symbol === "XAUUSD");

    return NextResponse.json({
      connected: snapshot.connected ?? false,
      tick: xauTick ?? null,
      account: snapshot.account ?? null,
      candlesH1: filterXAU(h1Data.candles ?? []),
      candlesH4: filterXAU(h4Data.candles ?? []),
      candlesD1: filterXAU(d1Data.candles ?? []),
      candlesM15: filterXAU(m15Data.candles ?? []),
      fetchedAt: Date.now(),
    });
  } catch (err) {
    console.error("[gold-pro/analysis]", err);
    return NextResponse.json({ error: "خطأ في الاتصال بـ MT5 Bridge" }, { status: 503 });
  }
}
```

- [ ] **5.2 — تحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```
المتوقع: zero errors

- [ ] **5.3 — Commit**

```bash
git add src/app/api/lab/gold-pro/analysis/route.ts
git commit -m "feat(gold-pro): add analysis API route (MT5 Bridge data fetcher)"
```

---

## Task 6: Convex Schema + Functions

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/goldProAnalysis.ts`

- [ ] **6.1 — أضف الجدول في `convex/schema.ts`**

أضف هذا الجدول قبل السطر الأخير من `defineSchema({...})`:

```typescript
  goldProAnalysis: defineTable({
    userId: v.string(),
    timestamp: v.number(),
    symbol: v.string(),
    price: v.number(),
    signal: v.union(v.literal("BUY"), v.literal("SELL"), v.literal("WAIT")),
    confluenceScore: v.number(),
    entryPrice: v.number(),
    stopLoss: v.number(),
    takeProfit1: v.number(),
    takeProfit2: v.number(),
    rrRatio: v.number(),
    lotSize: v.number(),
    atr: v.number(),
    mtfAlignment: v.number(),
    indicators: v.object({
      ema21: v.number(),
      ema50: v.number(),
      ema200: v.number(),
      rsi: v.number(),
      macd: v.number(),
      adx: v.number(),
      bbPosition: v.string(),
    }),
    outcome: v.optional(v.union(v.literal("win"), v.literal("loss"), v.literal("pending"))),
    outcomePrice: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_timestamp", ["userId", "timestamp"]),
```

- [ ] **6.2 — شغّل codegen**

```bash
pnpm exec convex codegen
```
المتوقع: ملفات `_generated` تتحدث بدون errors

- [ ] **6.3 — أنشئ `convex/goldProAnalysis.ts`**

```typescript
// convex/goldProAnalysis.ts
// Queries + Mutations لمختبر تحليل الذهب المؤسسي
// لا تنفيذ تداول — قراءة وحفظ تحليلات فقط

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Save Analysis Snapshot ────────────────────────────────────────────────────
export const saveAnalysis = mutation({
  args: {
    symbol: v.string(),
    timestamp: v.number(),
    price: v.number(),
    signal: v.union(v.literal("BUY"), v.literal("SELL"), v.literal("WAIT")),
    confluenceScore: v.number(),
    entryPrice: v.number(),
    stopLoss: v.number(),
    takeProfit1: v.number(),
    takeProfit2: v.number(),
    rrRatio: v.number(),
    lotSize: v.number(),
    atr: v.number(),
    mtfAlignment: v.number(),
    indicators: v.object({
      ema21: v.number(),
      ema50: v.number(),
      ema200: v.number(),
      rsi: v.number(),
      macd: v.number(),
      adx: v.number(),
      bbPosition: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    return await ctx.db.insert("goldProAnalysis", {
      userId,
      ...args,
      outcome: "pending",
    });
  },
});

// ── Get My Last 20 Analyses ───────────────────────────────────────────────────
export const getMyAnalyses = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;
    return await ctx.db
      .query("goldProAnalysis")
      .withIndex("by_user_timestamp", q => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});

// ── Update Outcome ────────────────────────────────────────────────────────────
export const updateOutcome = mutation({
  args: {
    id: v.id("goldProAnalysis"),
    outcome: v.union(v.literal("win"), v.literal("loss")),
    outcomePrice: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const record = await ctx.db.get(args.id);
    if (!record || record.userId !== identity.subject) throw new Error("Not found");
    await ctx.db.patch(args.id, { outcome: args.outcome, outcomePrice: args.outcomePrice });
  },
});

// ── Accuracy Stats ────────────────────────────────────────────────────────────
export const getAccuracyStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { total: 0, wins: 0, losses: 0, pending: 0, accuracy: 0 };
    const userId = identity.subject;
    const all = await ctx.db
      .query("goldProAnalysis")
      .withIndex("by_user", q => q.eq("userId", userId))
      .collect();
    const wins = all.filter(a => a.outcome === "win").length;
    const losses = all.filter(a => a.outcome === "loss").length;
    const pending = all.filter(a => a.outcome === "pending" || !a.outcome).length;
    const decided = wins + losses;
    return {
      total: all.length,
      wins,
      losses,
      pending,
      accuracy: decided > 0 ? Math.round((wins / decided) * 100) : 0,
    };
  },
});
```

- [ ] **6.4 — تحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```
المتوقع: zero errors

- [ ] **6.5 — Commit**

```bash
git add convex/schema.ts convex/goldProAnalysis.ts
git commit -m "feat(gold-pro): add Convex schema + goldProAnalysis mutations/queries"
```

---

## Task 7: Save Snapshot API Route

**Files:**
- Create: `src/app/api/lab/gold-pro/save-snapshot/route.ts`

- [ ] **7.1 — أنشئ الملف**

```typescript
// src/app/api/lab/gold-pro/save-snapshot/route.ts
// POST — يحفظ snapshot التحليل في Convex
// لا تنفيذ تداول

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const id = await convex.mutation(api.goldProAnalysis.saveAnalysis, body);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error("[gold-pro/save-snapshot]", err);
    return NextResponse.json({ error: "فشل الحفظ" }, { status: 500 });
  }
}
```

- [ ] **7.2 — تحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```
المتوقع: zero errors

- [ ] **7.3 — Commit**

```bash
git add src/app/api/lab/gold-pro/save-snapshot/route.ts
git commit -m "feat(gold-pro): add save-snapshot API route"
```

---

## Task 8: UI Components

**Files:**
- Create: `src/components/gold-pro/GoldProLab.tsx` وكل المكوّنات

- [ ] **8.1 — أنشئ المكوّن الرئيسي `GoldProLab.tsx`**

```typescript
// src/components/gold-pro/GoldProLab.tsx
"use client";

import { useState, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { GoldProAnalysis } from "@/lib/gold-pro/types";
import {
  calculateEMA, lastEMA, lastRSI, calculateATR, calculateMACD,
  calculateBollingerBands, calculateADX, calculateStochRSI,
  calculatePivotPoints, calculateFibonacci, calculateSupportResistance,
} from "@/lib/gold-pro/indicators";
import { calculateConfluence, detectSession } from "@/lib/gold-pro/confluence-engine";
import { calculateSLTP, calculatePositionSize } from "@/lib/gold-pro/position-sizing";
import { PriceHeader } from "./PriceHeader";
import { ConfluenceScoreCard } from "./ConfluenceScore";
import { SignalCard } from "./SignalCard";
import { PositionSizingPanel } from "./PositionSizingPanel";
import { MTFPanel } from "./MTFPanel";
import { IndicatorsPanel } from "./IndicatorsPanel";
import { SupportResistancePanel } from "./SupportResistancePanel";
import { PivotPointsPanel } from "./PivotPointsPanel";
import { AnalysisHistory } from "./AnalysisHistory";
import type { RawCandle } from "@/lib/gold-pro/types";

export function GoldProLab() {
  const [analysis, setAnalysis] = useState<GoldProAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const history = useQuery(api.goldProAnalysis.getMyAnalyses);
  const stats = useQuery(api.goldProAnalysis.getAccuracyStats);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lab/gold-pro/analysis");
      if (!res.ok) throw new Error("فشل جلب البيانات من MT5 Bridge");
      const data = await res.json();
      if (!data.connected || !data.tick) throw new Error("MT5 Bridge غير متصل");

      const { tick, candlesH1, candlesH4, candlesD1, candlesM15, account } = data;
      const currentPrice = tick.ask as number;
      const balance = account?.balance ?? 3000;

      // ─── حساب المؤشرات على H1 ────────────────────────────────────────────
      const ema21 = lastEMA(candlesH1, 21);
      const ema50 = lastEMA(candlesH1, 50);
      const ema200 = lastEMA(candlesH1, 200);
      const rsi = lastRSI(candlesH1, 14);
      const atr = calculateATR(candlesH1, 14);
      const macd = calculateMACD(candlesH1);
      const bb = calculateBollingerBands(candlesH1, 20);
      const adx = calculateADX(candlesH1, 14);
      const stochRsi = calculateStochRSI(candlesH1);
      const pivots = calculatePivotPoints(candlesD1 as RawCandle[]);
      const fib = calculateFibonacci(candlesH4 as RawCandle[]);
      const sr = calculateSupportResistance(candlesH1 as RawCandle[], currentPrice);

      // ─── MTF ─────────────────────────────────────────────────────────────
      const makeTF = (candles: RawCandle[], tf: "M15" | "H1" | "H4" | "D1") => {
        const e21 = lastEMA(candles, 21);
        const e50 = lastEMA(candles, 50);
        const e200 = lastEMA(candles, 200);
        const r = lastRSI(candles, 14);
        const bias = e21 > e50 && r > 50 ? "bullish" as const :
                     e21 < e50 && r < 50 ? "bearish" as const : "neutral" as const;
        return { timeframe: tf, bias, rsi: r, emaFastAboveSlow: e21 > e50, aboveEma200: currentPrice > e200 };
      };
      const mtfM15 = makeTF(candlesM15 as RawCandle[], "M15");
      const mtfH1  = makeTF(candlesH1 as RawCandle[],  "H1");
      const mtfH4  = makeTF(candlesH4 as RawCandle[],  "H4");
      const mtfD1  = makeTF(candlesD1 as RawCandle[],  "D1");
      const bullishCount = [mtfM15, mtfH1, mtfH4, mtfD1].filter(t => t.bias === "bullish").length;
      const mtf = { m15: mtfM15, h1: mtfH1, h4: mtfH4, d1: mtfD1, bullishCount, alignment: bullishCount * 25 };

      // ─── Session ─────────────────────────────────────────────────────────
      const utcHour = new Date().getUTCHours();
      const session = detectSession(utcHour);

      // ─── Confluence ───────────────────────────────────────────────────────
      const confluence = calculateConfluence({
        indicators: { ema21, ema50, ema200, macd, adx, rsi, stochRsi, atr, bollingerBands: bb, pivotPoints: pivots, fibonacci: fib, supportResistance: sr },
        mtf,
        currentPrice,
        sessionOk: session.ok,
        newsRisk: false, // مرحلة مستقبلية
      });

      // ─── SL/TP + Position Size ────────────────────────────────────────────
      const sltp = calculateSLTP(currentPrice, atr, confluence.signal);
      const positioning = calculatePositionSize(balance, sltp.slDistance);

      setAnalysis({
        timestamp: Date.now(),
        symbol: "XAUUSD",
        price: currentPrice,
        bid: tick.bid,
        ask: tick.ask,
        spread: tick.spread_points,
        marketClosed: tick.market_closed,
        sessionLabel: session.label,
        indicators: { ema21, ema50, ema200, macd, adx, rsi, stochRsi, atr, bollingerBands: bb, pivotPoints: pivots, fibonacci: fib, supportResistance: sr },
        mtf,
        confluence,
        sltp,
        positioning,
        dataQuality: candlesH1.length >= 50 ? "good" : "partial",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSnapshot = useCallback(async () => {
    if (!analysis || saving) return;
    setSaving(true);
    try {
      await fetch("/api/lab/gold-pro/save-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: analysis.symbol,
          timestamp: analysis.timestamp,
          price: analysis.price,
          signal: analysis.confluence.signal,
          confluenceScore: analysis.confluence.score,
          entryPrice: analysis.sltp.entryPrice,
          stopLoss: analysis.sltp.stopLoss,
          takeProfit1: analysis.sltp.takeProfit1,
          takeProfit2: analysis.sltp.takeProfit2,
          rrRatio: analysis.sltp.rrRatio1,
          lotSize: analysis.positioning.lotSize,
          atr: analysis.indicators.atr,
          mtfAlignment: analysis.mtf.bullishCount,
          indicators: {
            ema21: analysis.indicators.ema21,
            ema50: analysis.indicators.ema50,
            ema200: analysis.indicators.ema200,
            rsi: analysis.indicators.rsi,
            macd: analysis.indicators.macd.value,
            adx: analysis.indicators.adx.adx,
            bbPosition: analysis.indicators.bollingerBands.position,
          },
        }),
      });
    } finally {
      setSaving(false);
    }
  }, [analysis, saving]);

  return (
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-amber-400">🏆 Gold Pro Lab</h1>
          <p className="text-xs text-slate-400">مختبر تحليل الذهب المؤسسي — للأغراض التحليلية المعلوماتية فقط</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="rounded-lg bg-amber-500 px-6 py-2 font-bold text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? "⏳ جاري التحليل..." : "⚡ تحليل الآن"}
          </button>
          {analysis && (
            <button
              onClick={saveSnapshot}
              disabled={saving}
              className="rounded-lg border border-indigo-500 px-4 py-2 text-indigo-400 hover:bg-indigo-950 disabled:opacity-50"
            >
              {saving ? "💾..." : "💾 حفظ"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {!analysis && !loading && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-12 text-center text-slate-400">
          <div className="mb-2 text-4xl">📊</div>
          <p>اضغط "تحليل الآن" لبدء تحليل XAUUSD من البيانات المباشرة</p>
        </div>
      )}

      {analysis && (
        <>
          {/* Row 1: Price + Confluence + Signal */}
          <div className="grid grid-cols-3 gap-4">
            <PriceHeader analysis={analysis} />
            <ConfluenceScoreCard confluence={analysis.confluence} />
            <SignalCard analysis={analysis} />
          </div>

          {/* Row 2: Position Sizing + MTF */}
          <div className="grid grid-cols-2 gap-4">
            <PositionSizingPanel analysis={analysis} />
            <MTFPanel mtf={analysis.mtf} adx={analysis.indicators.adx} />
          </div>

          {/* Row 3: Indicators */}
          <div className="grid grid-cols-3 gap-4">
            <IndicatorsPanel analysis={analysis} />
            <SupportResistancePanel analysis={analysis} />
            <PivotPointsPanel pivots={analysis.indicators.pivotPoints} currentPrice={analysis.price} />
          </div>

          {/* Row 4: History */}
          <AnalysisHistory history={history ?? []} stats={stats ?? { total: 0, wins: 0, losses: 0, pending: 0, accuracy: 0 }} />
        </>
      )}

      <p className="text-center text-xs text-slate-600">
        ⚠️ للأغراض التحليلية المعلوماتية فقط — ليس توصية مالية — نظام الملك الهندسي للتداول العالمي
      </p>
    </div>
  );
}
```

- [ ] **8.2 — أنشئ `PriceHeader.tsx`**

```typescript
// src/components/gold-pro/PriceHeader.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function PriceHeader({ analysis }: { analysis: GoldProAnalysis }) {
  return (
    <div className="rounded-xl border border-yellow-900 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-widest text-slate-500">السعر الحي · XAUUSD</p>
      <p className="mt-1 text-3xl font-bold text-amber-400">{analysis.ask.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-green-700 bg-green-950 px-2 py-0.5 text-green-400">
          BID: {analysis.bid.toFixed(2)}
        </span>
        <span className="text-slate-500">Spread: {analysis.spread} pts</span>
      </div>
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400">Session</span>
          <span className={`font-medium ${analysis.sessionLabel === "Asian" ? "text-yellow-400" : "text-green-400"}`}>
            {analysis.sessionLabel}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">جودة البيانات</span>
          <span className={analysis.dataQuality === "good" ? "text-green-400" : "text-yellow-400"}>
            {analysis.dataQuality === "good" ? "✓ جيدة" : "⚠ جزئية"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">السوق</span>
          <span className={analysis.marketClosed ? "text-red-400" : "text-green-400"}>
            {analysis.marketClosed ? "مغلق" : "مفتوح"}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **8.3 — أنشئ `ConfluenceScore.tsx`**

```typescript
// src/components/gold-pro/ConfluenceScore.tsx
import type { ConfluenceResult } from "@/lib/gold-pro/types";

export function ConfluenceScoreCard({ confluence }: { confluence: ConfluenceResult }) {
  const color = confluence.score >= 70 ? "text-green-400 border-green-700" :
                confluence.score <= 30 ? "text-red-400 border-red-800" : "text-yellow-400 border-yellow-800";
  const bgColor = confluence.score >= 70 ? "bg-green-950" :
                  confluence.score <= 30 ? "bg-red-950" : "bg-yellow-950";
  const label = confluence.score >= 70 ? "BUY قوي" :
                confluence.score <= 30 ? "SELL قوي" : "انتظر";
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
      <p className="text-xs uppercase tracking-widest text-slate-500">Confluence Score</p>
      <div className={`mx-auto my-3 flex h-24 w-24 flex-col items-center justify-center rounded-full border-4 ${color}`}>
        <span className="text-3xl font-bold">{confluence.score}</span>
        <span className="text-xs text-slate-400">/ 100</span>
      </div>
      <span className={`rounded-full border px-4 py-1 text-sm font-bold ${color} ${bgColor}`}>{label}</span>
      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-slate-700">
          <div
            className={`h-full rounded-full transition-all ${confluence.score >= 70 ? "bg-green-500" : confluence.score <= 30 ? "bg-red-500" : "bg-yellow-500"}`}
            style={{ width: `${confluence.score}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">{confluence.bullishSignals}/{confluence.totalSignals} إشارات إيجابية</p>
      </div>
    </div>
  );
}
```

- [ ] **8.4 — أنشئ `SignalCard.tsx`**

```typescript
// src/components/gold-pro/SignalCard.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function SignalCard({ analysis }: { analysis: GoldProAnalysis }) {
  const { confluence, sltp } = analysis;
  const isBuy = confluence.signal === "BUY";
  const isSell = confluence.signal === "SELL";
  const signalColor = isBuy ? "border-green-700 bg-green-950 text-green-400" :
                      isSell ? "border-red-800 bg-red-950 text-red-400" :
                               "border-yellow-800 bg-yellow-950 text-yellow-400";
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-widest text-slate-500">التوصية النهائية</p>
      <div className={`mt-2 rounded-lg border p-3 text-center ${signalColor}`}>
        <p className="text-2xl font-bold">{isBuy ? "● BUY" : isSell ? "● SELL" : "◆ WAIT"}</p>
        <p className="text-xs text-slate-400">ثقة {confluence.score}%</p>
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between"><span className="text-slate-400">دخول</span><span className="font-mono text-amber-400">{sltp.entryPrice.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-red-400">Stop Loss</span><span className="font-mono text-red-400">{sltp.stopLoss.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-green-400">TP 1</span><span className="font-mono text-green-400">{sltp.takeProfit1.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-green-400">TP 2</span><span className="font-mono text-green-400">{sltp.takeProfit2.toFixed(2)}</span></div>
        <div className="flex justify-between border-t border-slate-700 pt-1.5">
          <span className="text-slate-400">R/R Ratio</span>
          <span className={`font-bold ${sltp.rrRatio1 >= 1.5 ? "text-green-400" : "text-yellow-400"}`}>1 : {sltp.rrRatio1.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **8.5 — أنشئ `PositionSizingPanel.tsx`**

```typescript
// src/components/gold-pro/PositionSizingPanel.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function PositionSizingPanel({ analysis }: { analysis: GoldProAnalysis }) {
  const { positioning, indicators } = analysis;
  return (
    <div className="rounded-xl border border-blue-900 bg-slate-900 p-4">
      <p className="mb-3 border-b border-slate-700 pb-2 text-xs uppercase tracking-widest text-slate-500">⚖️ إدارة المخاطر — Position Sizing</p>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="space-y-2">
          <div className="flex justify-between"><span className="text-slate-400">الرصيد</span><span className="text-blue-400">${positioning.balance.toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">المخاطرة (2%)</span><span className="text-amber-400">${positioning.riskAmountUsd.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">ATR (14)</span><span className="text-blue-400">${indicators.atr.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">SL المسافة</span><span className="text-red-400">{analysis.sltp.slDistance.toFixed(2)} pts</span></div>
        </div>
        <div className="flex flex-col items-center justify-center border-r border-slate-700 pr-4">
          <p className="text-xs text-slate-400">حجم الصفقة</p>
          <p className="text-4xl font-bold text-blue-400">{positioning.lotSize.toFixed(2)}</p>
          <p className="text-xs text-slate-500">Lot</p>
        </div>
      </div>
      <div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-xs">
        <div className="flex justify-between"><span className="text-slate-400">خسارة محتملة</span><span className="text-red-400">-${positioning.potentialLossUsd.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">ربح محتمل (TP1)</span><span className="text-green-400">+${positioning.potentialProfitUsd.toFixed(2)}</span></div>
      </div>
    </div>
  );
}
```

- [ ] **8.6 — أنشئ `MTFPanel.tsx`**

```typescript
// src/components/gold-pro/MTFPanel.tsx
import type { MTFResult, ADXResult } from "@/lib/gold-pro/types";

export function MTFPanel({ mtf, adx }: { mtf: MTFResult; adx: ADXResult }) {
  const tfs = [
    { label: "M15", data: mtf.m15 },
    { label: "H1",  data: mtf.h1 },
    { label: "H4",  data: mtf.h4 },
    { label: "D1",  data: mtf.d1 },
  ];
  return (
    <div className="rounded-xl border border-purple-900 bg-slate-900 p-4">
      <p className="mb-3 border-b border-slate-700 pb-2 text-xs uppercase tracking-widest text-slate-500">📊 تحليل متعدد الإطارات (MTF)</p>
      <div className="grid grid-cols-4 gap-2">
        {tfs.map(({ label, data }) => (
          <div key={label} className="rounded-lg bg-slate-800 p-2 text-center">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-sm font-bold ${data.bias === "bullish" ? "text-green-400" : data.bias === "bearish" ? "text-red-400" : "text-yellow-400"}`}>
              {data.bias === "bullish" ? "▲ صاعد" : data.bias === "bearish" ? "▼ هابط" : "◆ محايد"}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">RSI:{data.rsi.toFixed(0)}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400">توافق الإطارات</span>
          <span className={`font-bold ${mtf.bullishCount >= 3 ? "text-green-400" : "text-yellow-400"}`}>{mtf.bullishCount}/4 صاعد</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">ADX قوة الاتجاه</span>
          <span className={`font-bold ${adx.strength === "strong" ? "text-green-400" : adx.strength === "moderate" ? "text-yellow-400" : "text-slate-400"}`}>
            {adx.adx.toFixed(1)} — {adx.strength === "strong" ? "قوي" : adx.strength === "moderate" ? "متوسط" : "ضعيف"}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **8.7 — أنشئ `IndicatorsPanel.tsx`**

```typescript
// src/components/gold-pro/IndicatorsPanel.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function IndicatorsPanel({ analysis }: { analysis: GoldProAnalysis }) {
  const { indicators, price } = analysis;
  const row = (label: string, value: string, badge: string, badgeColor: string) => (
    <div className="flex items-center justify-between border-b border-slate-800 py-1.5 text-xs last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-300">{value}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${badgeColor}`}>{badge}</span>
    </div>
  );
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">📈 المؤشرات</p>
      {row("EMA 21", indicators.ema21.toFixed(2), price > indicators.ema21 ? "فوق ↗" : "تحت ↘", price > indicators.ema21 ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400")}
      {row("EMA 50", indicators.ema50.toFixed(2), price > indicators.ema50 ? "فوق ↗" : "تحت ↘", price > indicators.ema50 ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400")}
      {row("EMA 200", indicators.ema200.toFixed(2), price > indicators.ema200 ? "فوق ↗" : "تحت ↘", price > indicators.ema200 ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400")}
      {row("MACD", indicators.macd.value.toFixed(2), indicators.macd.histogram > 0 ? "↗ صاعد" : "↘ هابط", indicators.macd.histogram > 0 ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400")}
      {row("RSI (14)", indicators.rsi.toFixed(1), indicators.rsi > 70 ? "تشبع شراء" : indicators.rsi < 30 ? "تشبع بيع" : "طبيعي", indicators.rsi > 70 ? "bg-yellow-950 text-yellow-400" : indicators.rsi < 30 ? "bg-red-950 text-red-400" : "bg-green-950 text-green-400")}
      {row("Stoch RSI K", indicators.stochRsi.k.toFixed(1), indicators.stochRsi.zone === "overbought" ? "تشبع ↑" : indicators.stochRsi.zone === "oversold" ? "تشبع ↓" : "طبيعي", indicators.stochRsi.zone === "overbought" ? "bg-yellow-950 text-yellow-400" : indicators.stochRsi.zone === "oversold" ? "bg-blue-950 text-blue-400" : "bg-green-950 text-green-400")}
      {row("ATR (14)", `$${indicators.atr.toFixed(2)}`, "تقلب", "bg-slate-800 text-slate-400")}
      {row("BB Position", indicators.bollingerBands.middle.toFixed(2), indicators.bollingerBands.position === "above" ? "فوق" : indicators.bollingerBands.position === "below" ? "تحت" : "وسط", "bg-slate-800 text-slate-400")}
    </div>
  );
}
```

- [ ] **8.8 — أنشئ `SupportResistancePanel.tsx`**

```typescript
// src/components/gold-pro/SupportResistancePanel.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function SupportResistancePanel({ analysis }: { analysis: GoldProAnalysis }) {
  const { indicators, price } = analysis;
  const { supportResistance: sr, fibonacci: fib } = indicators;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">🎯 دعم · مقاومة · فيبوناتشي</p>
      <div className="space-y-1 text-xs">
        {sr.resistances.slice(0, 2).map((r, i) => (
          <div key={i} className="flex justify-between border-b border-slate-800 py-1">
            <span className="text-red-400">مقاومة {i + 1}</span>
            <span className="font-mono text-red-400">{r.toFixed(2)}</span>
          </div>
        ))}
        <div className="flex justify-between border-b border-slate-700 bg-slate-800 px-1 py-1.5">
          <span className="text-amber-400">● السعر الحالي</span>
          <span className="font-mono font-bold text-amber-400">{price.toFixed(2)}</span>
        </div>
        {sr.supports.slice(0, 2).map((s, i) => (
          <div key={i} className="flex justify-between border-b border-slate-800 py-1">
            <span className="text-green-400">دعم {i + 1}</span>
            <span className="font-mono text-green-400">{s.toFixed(2)}</span>
          </div>
        ))}
        <div className="mt-2 border-t border-slate-700 pt-2">
          <p className="mb-1 text-slate-500">فيبوناتشي H4</p>
          <div className="flex justify-between py-0.5"><span className="text-slate-400">38.2%</span><span className="font-mono text-blue-400">{fib.level382.toFixed(2)}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-slate-400">61.8%</span><span className="font-mono text-blue-400">{fib.level618.toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **8.9 — أنشئ `PivotPointsPanel.tsx`**

```typescript
// src/components/gold-pro/PivotPointsPanel.tsx
import type { PivotPoints } from "@/lib/gold-pro/types";

export function PivotPointsPanel({ pivots, currentPrice }: { pivots: PivotPoints; currentPrice: number }) {
  const items = [
    { label: "R2", value: pivots.r2, color: "text-red-400" },
    { label: "R1", value: pivots.r1, color: "text-red-300" },
    { label: "PP", value: pivots.pp, color: "text-amber-400" },
    { label: "S1", value: pivots.s1, color: "text-green-300" },
    { label: "S2", value: pivots.s2, color: "text-green-400" },
  ];
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">📌 Pivot Points يومية</p>
      <div className="grid grid-cols-5 gap-1">
        {items.map(({ label, value, color }) => (
          <div
            key={label}
            className={`rounded-lg bg-slate-800 p-2 text-center ${Math.abs(value - currentPrice) < 5 ? "ring-1 ring-amber-500" : ""}`}
          >
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-xs font-bold ${color}`}>{value.toFixed(0)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">السعر الحالي: {currentPrice.toFixed(2)}</p>
    </div>
  );
}
```

- [ ] **8.10 — أنشئ `AnalysisHistory.tsx`**

```typescript
// src/components/gold-pro/AnalysisHistory.tsx
import type { Doc } from "../../../convex/_generated/dataModel";

interface Stats { total: number; wins: number; losses: number; pending: number; accuracy: number; }

export function AnalysisHistory({
  history,
  stats,
}: {
  history: Doc<"goldProAnalysis">[];
  stats: Stats;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <p className="mb-3 text-xs uppercase tracking-widest text-slate-500">📋 آخر التوصيات المحفوظة</p>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد توصيات محفوظة بعد</p>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 5).map((h) => (
              <div key={h._id} className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{new Date(h.timestamp).toLocaleDateString("ar")}</span>
                <span className={`rounded-full px-2 py-0.5 font-bold ${h.signal === "BUY" ? "bg-green-950 text-green-400" : h.signal === "SELL" ? "bg-red-950 text-red-400" : "bg-yellow-950 text-yellow-400"}`}>{h.signal}</span>
                <span className="text-slate-400">{h.confluenceScore}%</span>
                <span className={`rounded-full px-2 py-0.5 ${h.outcome === "win" ? "bg-green-950 text-green-400" : h.outcome === "loss" ? "bg-red-950 text-red-400" : "bg-slate-800 text-slate-500"}`}>
                  {h.outcome === "win" ? "✓ ناجحة" : h.outcome === "loss" ? "✗ خاسرة" : "⏳ مفتوحة"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <p className="mb-3 text-xs uppercase tracking-widest text-slate-500">📊 إحصاءات الدقة</p>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between"><span className="text-slate-400">إجمالي التحليلات</span><span className="text-blue-400">{stats.total}</span></div>
          <div className="flex justify-between"><span className="text-green-400">ناجحة</span><span className="text-green-400">{stats.wins}</span></div>
          <div className="flex justify-between"><span className="text-red-400">خاسرة</span><span className="text-red-400">{stats.losses}</span></div>
          <div className="flex justify-between"><span className="text-yellow-400">مفتوحة</span><span className="text-yellow-400">{stats.pending}</span></div>
          <div className="mt-2 flex justify-between border-t border-slate-700 pt-2">
            <span className="text-slate-400">دقة التوصيات</span>
            <span className={`text-lg font-bold ${stats.accuracy >= 60 ? "text-green-400" : "text-yellow-400"}`}>{stats.accuracy}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **8.11 — تحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```
المتوقع: zero errors

- [ ] **8.12 — Commit**

```bash
git add src/components/gold-pro/
git commit -m "feat(gold-pro): add all UI components (10 components)"
```

---

## Task 9: الصفحة الرئيسية

**Files:**
- Create: `src/app/(dashboard)/lab/gold-pro/page.tsx`

- [ ] **9.1 — أنشئ الصفحة**

```typescript
// src/app/(dashboard)/lab/gold-pro/page.tsx
"use client";
import { GoldProLab } from "@/components/gold-pro/GoldProLab";

export default function GoldProLabPage() {
  return <GoldProLab />;
}
```

- [ ] **9.2 — أضف الرابط في Navigation**

في `src/lib/constants/navigation.ts`، أضف في مصفوفة `items` داخل group `"gold"`:

```typescript
{ label: "Gold Pro Lab", href: "/lab/gold-pro", icon: FlaskConical },
```

وأضف في `NAV_ITEMS`:

```typescript
{ label: "Gold Pro Lab", href: "/lab/gold-pro", icon: FlaskConical },
```

- [ ] **9.3 — تحقق من TypeScript والبناء**

```bash
pnpm exec tsc --noEmit
pnpm run build
```
المتوقع: zero errors + successful build

- [ ] **9.4 — Commit النهائي**

```bash
git add src/app/(dashboard)/lab/gold-pro/ src/lib/constants/navigation.ts
git commit -m "feat(gold-pro): add page + navigation link — Gold Pro Lab complete"
```

---

## Task 10: التحقق النهائي

- [ ] **10.1 — شغّل التحقق الكامل**

```bash
pnpm exec tsc --noEmit
pnpm run build
git status --short
```
المتوقع: zero errors · successful build · working tree clean

- [ ] **10.2 — تحقق يدوي في المتصفح**

```bash
pnpm dev
```
افتح: `http://localhost:3000/lab/gold-pro`

تحقق من:
- [ ] الصفحة تفتح بدون أخطاء
- [ ] زر "تحليل الآن" يعمل
- [ ] Confluence Score يظهر 0-100
- [ ] SL/TP = 1.5×/2×/3× ATR محسوبة صحيحاً
- [ ] R/R Ratio ≥ 1.3
- [ ] Lot size = (balance × 2%) / (SL × 10) منطقي
- [ ] RTL سليم
- [ ] Disclaimer ظاهر
- [ ] لا `order_send` في أي ملف

- [ ] **10.3 — تحديث PROJECT_CONTEXT.md**

أضف في قسم المراحل المنجزة:
```
| Gold Pro Lab | مختبر تحليل الذهب المؤسسي | ✅ منجز |
```

```bash
git add PROJECT_CONTEXT.md
git commit -m "docs: mark Gold Pro Lab as completed in PROJECT_CONTEXT.md"
```

---

## Checklist النهائي

```
[ ] pnpm exec tsc --noEmit → zero errors
[ ] pnpm build → successful
[ ] Confluence Score 0-100 يعمل صحيحاً
[ ] SL = ATR × 1.5 | TP1 = ATR × 2 | TP2 = ATR × 3
[ ] Lot = (balance × 2%) / (SL × 10)
[ ] RTL محترم
[ ] Disclaimer ظاهر
[ ] لا order_send
[ ] Auth في كل mutation
[ ] convex codegen تم تشغيله بعد schema change
```
