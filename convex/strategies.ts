import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

// ─── Queries ─────────────────────────────────────────────────────────────────

export const listStrategies = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    return ctx.db
      .query("strategies")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getStrategy = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(args.strategyId);
    if (!doc || doc.userId !== identity.subject) return null;
    return doc;
  },
});

export const getStrategyRules = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== identity.subject) return null;
    return ctx.db
      .query("strategyRules")
      .withIndex("by_strategyId", (q) => q.eq("strategyId", args.strategyId))
      .first();
  },
});

export const listStrategyFiles = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== identity.subject) return [];
    return ctx.db
      .query("strategyFiles")
      .withIndex("by_strategyId", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(50);
  },
});

export const listStrategyExperiments = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== identity.subject) return [];
    return ctx.db
      .query("strategyExperiments")
      .withIndex("by_strategyId", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(20);
  },
});

export const listStrategySignals = query({
  args: { strategyId: v.id("strategies"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== identity.subject) return [];
    return ctx.db
      .query("strategySignals")
      .withIndex("by_strategyId", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const listStrategyBacktests = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== identity.subject) return [];
    return ctx.db
      .query("strategyBacktests")
      .withIndex("by_strategyId", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(20);
  },
});

export const listStrategyDecisions = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== identity.subject) return [];
    return ctx.db
      .query("strategyDecisions")
      .withIndex("by_strategyId", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(50);
  },
});

export const listExperimentSignals = query({
  args: { experimentId: v.id("strategyExperiments"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.userId !== identity.subject) return [];
    return ctx.db
      .query("strategySignals")
      .withIndex("by_experimentId", (q) => q.eq("experimentId", args.experimentId))
      .order("desc")
      .take(args.limit ?? 30);
  },
});

export const getActiveExperiment = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== identity.subject) return null;
    // Return most recent experiment with no endedAt
    const experiments = await ctx.db
      .query("strategyExperiments")
      .withIndex("by_strategyId", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(10);
    return experiments.find((e) => !e.endedAt) ?? null;
  },
});

export const listStrategiesWithBacktests = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    const strategies = await ctx.db
      .query("strategies")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(30);
    return Promise.all(
      strategies.map(async (s) => {
        const backtests = await ctx.db
          .query("strategyBacktests")
          .withIndex("by_strategyId", (q) => q.eq("strategyId", s._id))
          .order("desc")
          .take(20);
        return { ...s, backtests };
      }),
    );
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const createStrategy = mutation({
  args: {
    name:              v.string(),
    description:       v.optional(v.string()),
    allowedTimeframes: v.array(v.string()),
    allowedSessions:   v.array(v.string()),
    marketCondition:   v.string(),
    tags:              v.array(v.string()),
    notes:             v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    const now = Date.now();
    return ctx.db.insert("strategies", {
      userId,
      name:             args.name,
      description:      args.description,
      status:           "DRAFT",
      allowedTimeframes: args.allowedTimeframes,
      allowedSessions:  args.allowedSessions,
      marketCondition:  args.marketCondition,
      tags:             args.tags,
      notes:            args.notes,
      createdAt:        now,
      updatedAt:        now,
    });
  },
});

export const updateStrategy = mutation({
  args: {
    strategyId:        v.id("strategies"),
    name:              v.optional(v.string()),
    description:       v.optional(v.string()),
    allowedTimeframes: v.optional(v.array(v.string())),
    allowedSessions:   v.optional(v.array(v.string())),
    marketCondition:   v.optional(v.string()),
    tags:              v.optional(v.array(v.string())),
    notes:             v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(args.strategyId);
    if (!doc || doc.userId !== identity.subject) throw new Error("Not found");
    const { strategyId, ...fields } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) patch[k] = v;
    }
    await ctx.db.patch(strategyId, patch);
  },
});

export const updateStrategyStatus = mutation({
  args: {
    strategyId: v.id("strategies"),
    newStatus:  v.string(),
    reason:     v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(args.strategyId);
    if (!doc || doc.userId !== identity.subject) throw new Error("Not found");
    const now = Date.now();
    const userId = identity.subject;
    await ctx.db.patch(args.strategyId, {
      status:             args.newStatus,
      statusChangedAt:    now,
      statusChangedBy:    userId,
      statusChangeReason: args.reason,
      updatedAt:          now,
    });
    await ctx.db.insert("strategyDecisions", {
      strategyId:  args.strategyId,
      userId,
      fromStatus:  doc.status,
      toStatus:    args.newStatus,
      reason:      args.reason,
      decidedBy:   userId,
      decidedAt:   now,
      createdAt:   now,
    });
  },
});

export const upsertStrategyRules = mutation({
  args: {
    strategyId:         v.id("strategies"),
    entryConditions:    v.string(),
    exitConditions:     v.string(),
    invalidationRules:  v.string(),
    blockConditions:    v.optional(v.string()),
    riskRules:          v.optional(v.string()),
    entryType:          v.string(),
    defaultPlan:        v.string(),
    defaultTarget:      v.string(),
    minRR:              v.number(),
    maxSpread:          v.number(),
    requiredCommittees: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Not found");
    const existing = await ctx.db
      .query("strategyRules")
      .withIndex("by_strategyId", (q) => q.eq("strategyId", args.strategyId))
      .first();
    const now = Date.now();
    const { strategyId, ...rest } = args;
    if (existing) {
      await ctx.db.patch(existing._id, { ...rest, updatedAt: now });
    } else {
      await ctx.db.insert("strategyRules", { ...rest, strategyId, userId, updatedAt: now });
    }
  },
});

export const addStrategyFile = mutation({
  args: {
    strategyId:    v.id("strategies"),
    fileType:      v.string(),
    fileName:      v.string(),
    timeframe:     v.optional(v.string()),
    periodFrom:    v.optional(v.number()),
    periodTo:      v.optional(v.number()),
    notes:         v.optional(v.string()),
    parsedSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Not found");
    return ctx.db.insert("strategyFiles", { ...args, userId, uploadedAt: Date.now() });
  },
});

export const createStrategyExperiment = mutation({
  args: {
    strategyId:     v.id("strategies"),
    experimentType: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Not found");
    const now = Date.now();
    return ctx.db.insert("strategyExperiments", {
      strategyId:     args.strategyId,
      userId,
      experimentType: args.experimentType,
      startedAt:      now,
      totalSignals:   0,
      winCount:       0,
      lossCount:      0,
      violations:     0,
      createdAt:      now,
      updatedAt:      now,
    });
  },
});

export const updateStrategyExperiment = mutation({
  args: {
    experimentId: v.id("strategyExperiments"),
    totalSignals: v.optional(v.number()),
    winCount:     v.optional(v.number()),
    lossCount:    v.optional(v.number()),
    winRate:      v.optional(v.number()),
    avgRR:        v.optional(v.number()),
    violations:   v.optional(v.number()),
    endedAt:      v.optional(v.number()),
    endReason:    v.optional(v.string()),
    notes:        v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(args.experimentId);
    if (!doc || doc.userId !== identity.subject) throw new Error("Not found");
    const { experimentId, ...fields } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) patch[k] = v;
    }
    await ctx.db.patch(experimentId, patch);
  },
});

export const addStrategySignal = mutation({
  args: {
    strategyId:      v.id("strategies"),
    experimentId:    v.optional(v.id("strategyExperiments")),
    signalTime:      v.number(),
    timeframe:       v.string(),
    direction:       v.string(),
    entryPrice:      v.number(),
    slPrice:         v.number(),
    tp1Price:        v.number(),
    tp2Price:        v.optional(v.number()),
    calculatedLot:   v.optional(v.number()),
    committeeResult: v.optional(v.string()),
    guardResult:     v.optional(v.string()),
    mode:            v.string(),
    rulesMatched:    v.array(v.string()),
    rulesMissed:     v.array(v.string()),
    notes:           v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Not found");
    return ctx.db.insert("strategySignals", {
      ...args,
      userId,
      outcome:   "PENDING",
      createdAt: Date.now(),
    });
  },
});

export const updateSignalOutcome = mutation({
  args: {
    signalId:     v.id("strategySignals"),
    outcome:      v.string(),
    outcomeTime:  v.optional(v.number()),
    outcomePrice: v.optional(v.number()),
    actualRR:     v.optional(v.number()),
    notes:        v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(args.signalId);
    if (!doc || doc.userId !== identity.subject) throw new Error("Not found");
    const { signalId, ...patch } = args;
    await ctx.db.patch(signalId, patch);
  },
});

// Compound: record outcome + recompute experiment stats in one transaction.
export const recordSignalOutcome = mutation({
  args: {
    signalId:     v.id("strategySignals"),
    outcome:      v.string(),
    outcomeTime:  v.optional(v.number()),
    outcomePrice: v.optional(v.number()),
    actualRR:     v.optional(v.number()),
    notes:        v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const signal = await ctx.db.get(args.signalId);
    if (!signal || signal.userId !== identity.subject) throw new Error("Not found");

    const { signalId, ...patch } = args;
    await ctx.db.patch(signalId, { ...patch, outcomeTime: args.outcomeTime ?? Date.now() });

    // Recompute experiment stats if signal belongs to one
    if (signal.experimentId) {
      const allSignals = await ctx.db
        .query("strategySignals")
        .withIndex("by_experimentId", (q) => q.eq("experimentId", signal.experimentId!))
        .collect();

      // Use the updated outcome for this signal in the count
      const updated = allSignals.map((s) =>
        s._id === signalId ? { ...s, outcome: args.outcome } : s,
      );

      const resolved = updated.filter((s) => s.outcome !== "PENDING" && s.outcome !== "EXPIRED");
      const wins     = resolved.filter((s) => s.outcome === "WIN");
      const losses   = resolved.filter((s) => s.outcome === "LOSS");
      const winRate  = resolved.length > 0 ? (wins.length / resolved.length) * 100 : 0;
      const rrValues = resolved.filter((s) => s.actualRR != null).map((s) => s.actualRR as number);
      const avgRR    = rrValues.length > 0 ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : 0;

      await ctx.db.patch(signal.experimentId, {
        totalSignals: updated.length,
        winCount:     wins.length,
        lossCount:    losses.length,
        winRate:      Math.round(winRate * 10) / 10,
        avgRR:        Math.round(avgRR * 100) / 100,
        updatedAt:    Date.now(),
      });
    }
  },
});

export const addStrategyBacktest = mutation({
  args: {
    strategyId:     v.id("strategies"),
    fileId:         v.optional(v.id("strategyFiles")),
    timeframe:      v.string(),
    periodFrom:     v.number(),
    periodTo:       v.number(),
    totalTrades:    v.number(),
    winRate:        v.number(),
    netProfit:      v.number(),
    maxDrawdown:    v.number(),
    profitFactor:   v.number(),
    avgRR:          v.number(),
    selectedPlan:   v.optional(v.string()),
    selectedTarget: v.optional(v.string()),
    notes:          v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Not found");
    return ctx.db.insert("strategyBacktests", { ...args, userId, createdAt: Date.now() });
  },
});

export const addStrategyPerformanceSnapshot = mutation({
  args: {
    strategyId:    v.id("strategies"),
    snapshotTime:  v.number(),
    totalSignals:  v.number(),
    winRate:       v.number(),
    avgRR:         v.number(),
    profitFactor:  v.optional(v.number()),
    currentStatus: v.string(),
    notes:         v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Not found");
    return ctx.db.insert("strategyPerformanceSnapshots", { ...args, userId, createdAt: Date.now() });
  },
});
