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
