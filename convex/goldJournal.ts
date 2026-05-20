/**
 * goldJournal.ts — Gold Execution Journal v1
 * ─────────────────────────────────────────────────────────────────────────────
 * Mutations and queries for:
 *   - goldAnalysisSnapshots   (analysis results)
 *   - goldExecutionGroups     (execution tracking)
 *   - goldPendingPlans        (future pending trade plans)
 *
 * ⚠️ No order_send — no trading execution — storage and retrieval only.
 * ⚠️ All mutations check ctx.auth.getUserIdentity() — no anonymous writes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { mutation, query } from "./_generated/server";
import { v }               from "convex/values";

// ─── Analysis Snapshots ───────────────────────────────────────────────────────

export const saveAnalysisSnapshot = mutation({
  args: {
    symbol:               v.string(),
    timeframe:            v.optional(v.string()),
    direction:            v.optional(v.string()),
    analysisStatus:       v.optional(v.string()),
    grade:                v.optional(v.string()),
    probability:          v.optional(v.number()),
    hardBlockCount:       v.optional(v.number()),
    softBlockCount:       v.optional(v.number()),
    targetPreference:     v.optional(v.string()),
    selectedPlanName:     v.optional(v.string()),
    entry:                v.optional(v.number()),
    stopLoss:             v.optional(v.number()),
    takeProfit:           v.optional(v.number()),
    lot:                  v.optional(v.number()),
    riskUsd:              v.optional(v.number()),
    rrRatio:              v.optional(v.number()),
    actionPlanType:       v.optional(v.string()),
    executionPolicy:      v.optional(v.string()),
    recommendationStatus: v.optional(v.string()),
    profile:              v.optional(v.string()),
    reasonSummary:        v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const id = await ctx.db.insert("goldAnalysisSnapshots", {
      ...args,
      userId:     identity.subject,
      wasExecuted: false,
      createdAt:  Date.now(),
      source:     "gold-lab",
    });
    return id;
  },
});

export const markSnapshotExecuted = mutation({
  args: { snapshotId: v.id("goldAnalysisSnapshots") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;
    const snap = await ctx.db.get(args.snapshotId);
    if (!snap || snap.userId !== identity.subject) return;
    await ctx.db.patch(args.snapshotId, { wasExecuted: true });
  },
});

export const getMyRecentSnapshots = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("goldAnalysisSnapshots")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(limit);
  },
});

// ─── Execution Groups ─────────────────────────────────────────────────────────

export const saveExecutionGroup = mutation({
  args: {
    groupId:             v.string(),
    analysisSnapshotId:  v.optional(v.id("goldAnalysisSnapshots")),
    symbol:              v.string(),
    direction:           v.optional(v.string()),
    targetPreference:    v.optional(v.string()),
    selectedPlanName:    v.optional(v.string()),
    profile:             v.optional(v.string()),
    timeframe:           v.optional(v.string()),
    totalRiskUsd:        v.optional(v.number()),
    totalLot:            v.optional(v.number()),
    ordersRequested:     v.number(),
    ordersSent:          v.number(),
    tickets:             v.optional(v.array(v.number())),
    partialSuccess:      v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const id = await ctx.db.insert("goldExecutionGroups", {
      ...args,
      userId:    identity.subject,
      createdAt: Date.now(),
      source:    "gold-lab",
    });
    return id;
  },
});

export const getMyRecentExecutionGroups = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const limit = Math.min(args.limit ?? 30, 100);
    return await ctx.db
      .query("goldExecutionGroups")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(limit);
  },
});

// ─── Pending Plans ────────────────────────────────────────────────────────────

export const savePendingPlan = mutation({
  args: {
    analysisSnapshotId: v.optional(v.id("goldAnalysisSnapshots")),
    pendingType:        v.string(),
    status:             v.string(),
    symbol:             v.string(),
    timeframe:          v.optional(v.string()),
    direction:          v.optional(v.string()),
    triggerPrice:       v.number(),
    stopLoss:           v.number(),
    takeProfit1:        v.optional(v.number()),
    takeProfit2:        v.optional(v.number()),
    takeProfit3:        v.optional(v.number()),
    lot:                v.optional(v.number()),
    riskUsd:            v.optional(v.number()),
    conditionText:      v.optional(v.string()),
    reason:             v.optional(v.string()),
    targetPreference:   v.optional(v.string()),
    expiryTime:         v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.insert("goldPendingPlans", {
      ...args,
      userId:    identity.subject,
      createdAt: Date.now(),
      source:    "gold-lab",
    });
  },
});

export const updatePendingPlanStatus = mutation({
  args: { planId: v.id("goldPendingPlans"), status: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.userId !== identity.subject) return;
    await ctx.db.patch(args.planId, { status: args.status });
  },
});

export const getMyPendingPlans = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    if (args.status) {
      return await ctx.db
        .query("goldPendingPlans")
        .withIndex("by_userId_status", (q) =>
          q.eq("userId", identity.subject).eq("status", args.status!),
        )
        .order("desc")
        .take(50);
    }
    return await ctx.db
      .query("goldPendingPlans")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(50);
  },
});
