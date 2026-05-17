/**
 * mt5CandlesQuery.ts — B1
 * Raw candle data for market structure analysis.
 * Read-only — no auth required (query is public like technicalIndicators).
 * لا order_send — لا تنفيذ تداول — قراءة فقط.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";

export const getCandlesForStructure = query({
  args: {
    symbol:    v.string(),
    timeframe: v.string(),
    limit:     v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 300, 500);
    const rows = await ctx.db
      .query("mt5Candles")
      .withIndex("by_symbol_timeframe_time", (q) =>
        q.eq("symbol", args.symbol).eq("timeframe", args.timeframe),
      )
      .order("desc")
      .take(limit);
    // Return in chronological order (oldest first) for the analysis engine
    return rows.reverse().map((c) => ({
      time:  c.time,
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    }));
  },
});
