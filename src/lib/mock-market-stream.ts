/**
 * Mock-only random walk prices for UI vitality. No MT5, no orders, no APIs.
 */

export const MARKET_SYMBOLS = [
  "XAUUSD",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "AUDUSD",
  "USDCAD",
] as const;

export type MarketSymbol = (typeof MARKET_SYMBOLS)[number];

export type MarketDirection = "up" | "down" | "flat";

export type MarketTick = {
  symbol: MarketSymbol;
  bid: number;
  ask: number;
  spread: number;
  mid: number;
  change: number;
  changePercent: number;
  direction: MarketDirection;
  /** Last ~24 mid samples for sparkline */
  history: number[];
  updatedAt: number;
};

const HISTORY_LEN = 24;

function baseMid(symbol: MarketSymbol): number {
  switch (symbol) {
    case "XAUUSD":
      return 2650;
    case "EURUSD":
      return 1.085;
    case "GBPUSD":
      return 1.265;
    case "USDJPY":
      return 149.2;
    case "AUDUSD":
      return 0.652;
    case "USDCAD":
      return 1.352;
    default:
      return 1;
  }
}

function defaultSpread(symbol: MarketSymbol): number {
  if (symbol === "XAUUSD") return 0.35;
  if (symbol === "USDJPY") return 0.02;
  return 0.00012;
}

function roundPrice(symbol: MarketSymbol, v: number): number {
  if (symbol === "XAUUSD") return Math.round(v * 100) / 100;
  if (symbol === "USDJPY") return Math.round(v * 100) / 100;
  return Math.round(v * 100000) / 100000;
}

export function createInitialMarketState(): Record<MarketSymbol, MarketTick> {
  const out = {} as Record<MarketSymbol, MarketTick>;
  const now = Date.now();
  for (const sym of MARKET_SYMBOLS) {
    const mid = baseMid(sym);
    const spread = defaultSpread(sym);
    const half = spread / 2;
    const history = Array.from({ length: HISTORY_LEN }, () => mid);
    out[sym] = {
      symbol: sym,
      mid,
      bid: roundPrice(sym, mid - half),
      ask: roundPrice(sym, mid + half),
      spread,
      change: 0,
      changePercent: 0,
      direction: "flat",
      history,
      updatedAt: now,
    };
  }
  return out;
}

function volatility(symbol: MarketSymbol): number {
  if (symbol === "XAUUSD") return 0.45;
  if (symbol === "USDJPY") return 0.04;
  return 0.00008;
}

export function stepMarketState(prev: Record<MarketSymbol, MarketTick>): Record<MarketSymbol, MarketTick> {
  const now = Date.now();
  const next = { ...prev };
  for (const sym of MARKET_SYMBOLS) {
    const cur = prev[sym];
    const vol = volatility(sym);
    const delta = (Math.random() - 0.5) * 2 * vol;
    const newMid = Math.max(0.0001, cur.mid + delta);
    const spread = defaultSpread(sym);
    const half = spread / 2;
    const open = cur.history[0] ?? cur.mid;
    const change = newMid - open;
    const changePercent = open !== 0 ? (change / open) * 100 : 0;
    let direction: MarketDirection = "flat";
    if (change > (open * 0.00002 || 0.00001)) direction = "up";
    else if (change < -(open * 0.00002 || 0.00001)) direction = "down";

    const history = [...cur.history.slice(-(HISTORY_LEN - 1)), roundPrice(sym, newMid)];

    next[sym] = {
      symbol: sym,
      mid: roundPrice(sym, newMid),
      bid: roundPrice(sym, newMid - half),
      ask: roundPrice(sym, newMid + half),
      spread,
      change: roundPrice(sym, change),
      changePercent: Math.round(changePercent * 10000) / 10000,
      direction,
      history,
      updatedAt: now,
    };
  }
  return next;
}
