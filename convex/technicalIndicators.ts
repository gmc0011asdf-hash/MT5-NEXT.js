import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { SOURCE_MT5_LOCAL, SOURCE_MT5_MARKET_WATCH_VISIBLE } from "./coreQueries";

const AUTH_MSG = "يجب تسجيل الدخول لاستخدام هذه الوظائف";
const INDICATOR_SOURCE = "mt5-candles-derived" as const;
const DEFAULT_TIMEFRAMES = ["M15", "H1", "H4", "D1"] as const;
const CANDLE_FETCH_LIMIT = 350;
const VOLATILITY_WINDOW = 20;
const HIGH_LOW_WINDOW = 20;

function num(vl: number): number {
  return Number.isFinite(vl) ? vl : 0;
}

function sma(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function ema(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const seed = sma(values.slice(0, period), period);
  if (seed === undefined) return undefined;
  const k = 2 / (period + 1);
  let current = seed;
  for (let i = period; i < values.length; i += 1) {
    current = values[i]! * k + current * (1 - k);
  }
  return current;
}

function rsi(values: number[], period = 14): number | undefined {
  if (values.length <= period) return undefined;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i]! - values[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(candles: Doc<"mt5Candles">[], period = 14): number | undefined {
  if (candles.length <= period) return undefined;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const cur = candles[i]!;
    const prev = candles[i - 1]!;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }
  if (trs.length < period) return undefined;
  const base = sma(trs.slice(0, period), period);
  if (base === undefined) return undefined;
  let current = base;
  for (let i = period; i < trs.length; i += 1) {
    current = (current * (period - 1) + trs[i]!) / period;
  }
  return current;
}

function macd(values: number[]): { macd?: number; macdSignal?: number; macdHistogram?: number } {
  if (values.length < 35) return {};
  const fastK = 2 / (12 + 1);
  const slowK = 2 / (26 + 1);
  let fast = values[0]!;
  let slow = values[0]!;
  const line: number[] = [];
  for (const close of values) {
    fast = close * fastK + fast * (1 - fastK);
    slow = close * slowK + slow * (1 - slowK);
    line.push(fast - slow);
  }
  const signal = ema(line, 9);
  if (signal === undefined) return {};
  const macdValue = line[line.length - 1];
  const hist = macdValue - signal;
  return {
    macd: macdValue,
    macdSignal: signal,
    macdHistogram: hist,
  };
}

function volatility(closes: number[]): number | undefined {
  if (closes.length < VOLATILITY_WINDOW) return undefined;
  const slice = closes.slice(-VOLATILITY_WINDOW);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  if (mean === 0) return undefined;
  const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / slice.length;
  return (Math.sqrt(variance) / Math.abs(mean)) * 100;
}

function trendBiasFromEma(ema20?: number, ema50?: number, ema200?: number): string {
  if (ema20 === undefined || ema50 === undefined || ema200 === undefined) return "neutral";
  if (ema20 > ema50 && ema50 > ema200) return "bullish";
  if (ema20 < ema50 && ema50 < ema200) return "bearish";
  return "neutral";
}

function momentumBiasFromSignals(rsi14?: number, macdHistogram?: number): string {
  if (rsi14 === undefined || macdHistogram === undefined) return "neutral";
  if ((rsi14 >= 55 && macdHistogram > 0) || (rsi14 <= 45 && macdHistogram < 0)) return "strong";
  return "weak";
}

function visibleSymbolNames(rows: Doc<"mt5Symbols">[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.selectedInMarketWatch === true || r.source === SOURCE_MT5_MARKET_WATCH_VISIBLE) {
      out.add(r.name);
    }
  }
  return out;
}

export const computeTechnicalIndicatorsForEnabledSymbols = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError(AUTH_MSG);
    const userId = identity.subject;
    const now = Date.now();
    const syncRunId = `ti-${now}`;

    const gov = await ctx.db
      .query("governanceState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const govPayload = {
      userId,
      mode: gov?.mode ?? "read-only-mt5-local-sync",
      tradingEnabled: false,
      readOnly: true,
      maxDailyTrades: gov?.maxDailyTrades ?? 0,
      maxRiskUsd: gov?.maxRiskUsd ?? 0,
      updatedAt: now,
    };
    if (gov) await ctx.db.patch(gov._id, govPayload);
    else await ctx.db.insert("governanceState", govPayload);

    const [settingsRows, mt5SymbolsRows] = await Promise.all([
      ctx.db
        .query("userSymbolSettings")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("mt5Symbols")
        .withIndex("by_source_capturedAt", (q) => q.eq("source", SOURCE_MT5_MARKET_WATCH_VISIBLE))
        .order("desc")
        .take(25_000),
    ]);
    const visible = visibleSymbolNames(mt5SymbolsRows);
    const enabledSymbols = settingsRows
      .filter((s) => s.enabled && s.showInLab && visible.has(s.symbol))
      .map((s) => s.symbol)
      .sort((a, b) => a.localeCompare(b));

    let inserted = 0;
    let partial = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const symbol of enabledSymbols) {
      for (const timeframe of DEFAULT_TIMEFRAMES) {
        const candles = await ctx.db
          .query("mt5Candles")
          .withIndex("by_userId_symbol_timeframe", (q) =>
            q.eq("userId", userId).eq("symbol", symbol).eq("timeframe", timeframe),
          )
          .order("desc")
          .take(CANDLE_FETCH_LIMIT);
        if (candles.length === 0) {
          skipped += 1;
          details.push(`${symbol}/${timeframe}: no_candles`);
          continue;
        }
        const ordered = [...candles].sort((a, b) => a.time - b.time);
        const closes = ordered.map((c) => c.close);
        const recent = ordered.slice(-HIGH_LOW_WINDOW);
        const ema20 = ema(closes, 20);
        const ema50 = ema(closes, 50);
        const ema200 = ema(closes, 200);
        const rsi14 = rsi(closes, 14);
        const atr14 = atr(ordered, 14);
        const macdValues = macd(closes);
        const vol = volatility(closes);
        const recentHigh = recent.length > 0 ? Math.max(...recent.map((c) => c.high)) : undefined;
        const recentLow = recent.length > 0 ? Math.min(...recent.map((c) => c.low)) : undefined;
        const lastClose = closes[closes.length - 1];
        const trendBias = trendBiasFromEma(ema20, ema50, ema200);
        const momentumBias = momentumBiasFromSignals(rsi14, macdValues.macdHistogram);
        const ready = ema200 !== undefined && rsi14 !== undefined && atr14 !== undefined && macdValues.macd !== undefined;

        await ctx.db.insert("technicalIndicatorSnapshots", {
          userId,
          symbol,
          timeframe,
          candleCount: ordered.length,
          ema20: ema20 !== undefined ? num(ema20) : undefined,
          ema50: ema50 !== undefined ? num(ema50) : undefined,
          ema200: ema200 !== undefined ? num(ema200) : undefined,
          rsi14: rsi14 !== undefined ? num(rsi14) : undefined,
          atr14: atr14 !== undefined ? num(atr14) : undefined,
          macd: macdValues.macd !== undefined ? num(macdValues.macd) : undefined,
          macdSignal: macdValues.macdSignal !== undefined ? num(macdValues.macdSignal) : undefined,
          macdHistogram: macdValues.macdHistogram !== undefined ? num(macdValues.macdHistogram) : undefined,
          volatility: vol !== undefined ? num(vol) : undefined,
          recentHigh: recentHigh !== undefined ? num(recentHigh) : undefined,
          recentLow: recentLow !== undefined ? num(recentLow) : undefined,
          lastClose: lastClose !== undefined ? num(lastClose) : undefined,
          trendBias,
          momentumBias,
          createdAt: now,
          source: INDICATOR_SOURCE,
          syncRunId,
        });
        if (ready) inserted += 1;
        else {
          partial += 1;
          details.push(`${symbol}/${timeframe}: partial_insufficient_candles(${ordered.length})`);
        }
      }
    }

    await ctx.db.insert("auditEvents", {
      userId,
      action: "mt5_technical_indicators_computed",
      entity: "technicalIndicatorSnapshots",
      entityId: syncRunId,
      message: `technical indicators computed from mt5 candles. full=${inserted}, partial=${partial}, skipped=${skipped}`,
      createdAt: now,
      source: INDICATOR_SOURCE,
      syncRunId,
    });

    return {
      ok: true as const,
      syncRunId,
      computed: inserted,
      partial,
      skipped,
      symbols: enabledSymbols,
      details,
      governanceReadOnly: true as const,
      tradingEnabled: false as const,
    };
  },
});

export const getMyLatestTechnicalIndicators = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;
    const rows = await ctx.db
      .query("technicalIndicatorSnapshots")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(400);
    const latestBySymbolTf = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const k = `${row.symbol}::${row.timeframe}`;
      if (!latestBySymbolTf.has(k)) latestBySymbolTf.set(k, row);
    }
    return [...latestBySymbolTf.values()].sort((a, b) =>
      a.symbol === b.symbol ? a.timeframe.localeCompare(b.timeframe) : a.symbol.localeCompare(b.symbol),
    );
  },
});

export const getIndicatorsForSymbol = query({
  args: { symbol: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("technicalIndicatorSnapshots")
      .withIndex("by_symbol_timeframe", (q) => q.eq("symbol", args.symbol))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  },
});

/**
 * Stage 5A: حساب المؤشرات لزوج واحد وإطار زمني واحد — للطلب الفوري من لوحة التحليل.
 * On-demand indicator computation for a single (symbol, timeframe) — no stored settings required.
 * Returns computed values directly without persisting to technicalIndicatorSnapshots.
 * Uses the by_userId_symbol_timeframe index — no collect() on large tables.
 */
export const computeIndicatorsForSymbol = query({
  args: {
    symbol: v.string(),
    timeframe: v.string(),
    candleCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { status: "unauthenticated" as const };
    const userId = identity.subject;
    const limit = Math.min(Math.max(args.candleCount ?? CANDLE_FETCH_LIMIT, 50), CANDLE_FETCH_LIMIT);
    const now = Date.now();

    const candles = await ctx.db
      .query("mt5Candles")
      .withIndex("by_userId_symbol_timeframe", (q) =>
        q.eq("userId", userId).eq("symbol", args.symbol).eq("timeframe", args.timeframe),
      )
      .order("desc")
      .take(limit);

    if (candles.length === 0) {
      return { status: "insufficient_data" as const, candleCount: 0, symbol: args.symbol, timeframe: args.timeframe };
    }

    const ordered = [...candles].sort((a, b) => a.time - b.time);
    const closes = ordered.map((c) => c.close);
    const recent = ordered.slice(-HIGH_LOW_WINDOW);

    const ema20v = ema(closes, 20);
    const ema50v = ema(closes, 50);
    const ema200v = ema(closes, 200);
    const rsi14v = rsi(closes, 14);
    const atr14v = atr(ordered, 14);
    const macdValues = macd(closes);
    const vol = volatility(closes);
    const recentHigh = recent.length > 0 ? Math.max(...recent.map((c) => c.high)) : undefined;
    const recentLow  = recent.length > 0 ? Math.min(...recent.map((c) => c.low)) : undefined;
    const lastClose  = closes[closes.length - 1];
    const trendBias  = trendBiasFromEma(ema20v, ema50v, ema200v);
    const momentumB  = momentumBiasFromSignals(rsi14v, macdValues.macdHistogram);

    // Freshness: latest candle time vs now
    const latestCandleTime = ordered[ordered.length - 1]!.time;
    const candleAgeMs = now - latestCandleTime;

    return {
      status: "ok" as const,
      symbol: args.symbol,
      timeframe: args.timeframe,
      candleCount: ordered.length,
      ema20: ema20v,
      ema50: ema50v,
      ema200: ema200v,
      rsi14: rsi14v,
      atr14: atr14v,
      macd: macdValues.macd,
      macdSignal: macdValues.macdSignal,
      macdHistogram: macdValues.macdHistogram,
      volatility: vol,
      recentHigh,
      recentLow,
      lastClose,
      trendBias,
      momentumBias: momentumB,
      latestCandleTime,
      candleAgeMs,
    };
  },
});

export const getIndicatorReadiness = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;
    const settingsRows = await ctx.db
      .query("userSymbolSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const enabledSymbols = settingsRows.filter((s) => s.enabled && s.showInLab).map((s) => s.symbol);
    const requiredCombos = enabledSymbols.length * DEFAULT_TIMEFRAMES.length;
    const snapshots = await ctx.db
      .query("technicalIndicatorSnapshots")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.max(requiredCombos * 3, 120));

    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const s of snapshots) {
      const key = `${s.symbol}::${s.timeframe}`;
      if (!latest.has(key)) latest.set(key, s);
    }
    let readyCount = 0;
    let partialCount = 0;
    for (const row of latest.values()) {
      const ready =
        row.ema200 !== undefined &&
        row.rsi14 !== undefined &&
        row.atr14 !== undefined &&
        row.macd !== undefined &&
        row.macdSignal !== undefined &&
        row.macdHistogram !== undefined;
      if (ready) readyCount += 1;
      else partialCount += 1;
    }

    return {
      enabledSymbolsCount: enabledSymbols.length,
      requiredCombos,
      availableLatestCombos: latest.size,
      readyCount,
      partialCount,
      missingCount: Math.max(requiredCombos - latest.size, 0),
      governance: { readOnly: true, tradingEnabled: false },
      source: INDICATOR_SOURCE,
    };
  },
});
