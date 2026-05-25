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
