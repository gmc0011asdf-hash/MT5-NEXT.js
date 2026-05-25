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
