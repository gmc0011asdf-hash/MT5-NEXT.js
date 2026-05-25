// convex/tradeExecutions.ts
// Stage 14 — سجل تنفيذ الصفقات
// لا يحتوي على أي منطق تنفيذ — سجل قراءة/كتابة فقط

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** تسجيل صفقة منفّذة بعد نجاح order_send */
export const logExecution = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
    orderType: v.union(v.literal("BUY"), v.literal("SELL")),
    lot: v.number(),
    entryPrice: v.number(),
    sl: v.number(),
    tp: v.number(),
    ticket: v.number(),
    confluenceScore: v.number(),
    setupLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    return await ctx.db.insert("tradeExecutions", {
      userId: identity.subject,
      timestamp: Date.now(),
      symbol: args.symbol,
      orderType: args.orderType,
      lot: args.lot,
      entryPrice: args.entryPrice,
      sl: args.sl,
      tp: args.tp,
      ticket: args.ticket,
      confluenceScore: args.confluenceScore,
      setupLabel: args.setupLabel,
      status: "open",
    });
  },
});

/** جلب آخر 30 صفقة للمستخدم */
export const getMyExecutions = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.db
      .query("tradeExecutions")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(30);
  },
});

/** تحديث نتيجة صفقة بعد إغلاقها */
export const updateExecutionOutcome = mutation({
  args: {
    executionId: v.id("tradeExecutions"),
    closePrice: v.number(),
    profit: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const exec = await ctx.db.get(args.executionId);
    if (!exec || exec.userId !== identity.subject) throw new Error("Not found");

    await ctx.db.patch(args.executionId, {
      closePrice: args.closePrice,
      profit: args.profit,
      closedAt: Date.now(),
      status: "closed",
    });
  },
});
