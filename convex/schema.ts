import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  testEvents: defineTable({
    title: v.string(),
    source: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  users: defineTable({
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    role: v.string(),
    status: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_email", ["email"]),

  mt5AccountSnapshots: defineTable({
    userId: v.string(),
    accountLogin: v.optional(v.string()),
    broker: v.optional(v.string()),
    server: v.optional(v.string()),
    currency: v.string(),
    balance: v.number(),
    equity: v.number(),
    margin: v.number(),
    freeMargin: v.number(),
    marginLevel: v.optional(v.number()),
    capturedAt: v.number(),
    source: v.string(),
    syncRunId: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_capturedAt", ["capturedAt"])
    .index("by_userId_capturedAt", ["userId", "capturedAt"]),

  mt5MarketTicks: defineTable({
    symbol: v.string(),
    bid: v.number(),
    ask: v.number(),
    spread: v.number(),
    capturedAt: v.number(),
    source: v.string(),
    syncRunId: v.optional(v.string()),
  })
    .index("by_symbol", ["symbol"])
    .index("by_capturedAt", ["capturedAt"])
    .index("by_symbol_capturedAt", ["symbol", "capturedAt"]),

  mt5OpenPositions: defineTable({
    userId: v.string(),
    ticket: v.optional(v.string()),
    symbol: v.string(),
    type: v.string(),
    volume: v.number(),
    openPrice: v.number(),
    currentPrice: v.number(),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    profit: v.number(),
    openedAt: v.optional(v.number()),
    capturedAt: v.number(),
    source: v.string(),
    syncRunId: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_symbol", ["symbol"])
    .index("by_userId_symbol", ["userId", "symbol"])
    .index("by_capturedAt", ["capturedAt"]),

  labSignalSnapshots: defineTable({
    userId: v.string(),
    symbol: v.string(),
    timeframe: v.string(),
    verdict: v.string(),
    probability: v.number(),
    entry: v.optional(v.number()),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    riskUsd: v.optional(v.number()),
    recommendedLot: v.optional(v.number()),
    status: v.string(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    source: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_symbol", ["symbol"])
    .index("by_createdAt", ["createdAt"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

  committeeReports: defineTable({
    signalId: v.optional(v.id("labSignalSnapshots")),
    userId: v.string(),
    symbol: v.string(),
    marketMindScore: v.number(),
    protectionMindScore: v.number(),
    executionMindScore: v.number(),
    finalVerdict: v.string(),
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_symbol", ["symbol"])
    .index("by_createdAt", ["createdAt"]),

  protectionEvents: defineTable({
    userId: v.string(),
    symbol: v.optional(v.string()),
    eventType: v.string(),
    severity: v.string(),
    message: v.string(),
    blocked: v.boolean(),
    createdAt: v.number(),
    source: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_symbol", ["symbol"])
    .index("by_createdAt", ["createdAt"])
    .index("by_severity", ["severity"]),

  governanceState: defineTable({
    userId: v.string(),
    mode: v.string(),
    tradingEnabled: v.boolean(),
    readOnly: v.boolean(),
    maxDailyTrades: v.number(),
    maxRiskUsd: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  auditEvents: defineTable({
    userId: v.string(),
    action: v.string(),
    entity: v.string(),
    entityId: v.optional(v.string()),
    message: v.string(),
    createdAt: v.number(),
    source: v.string(),
    syncRunId: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_action", ["action"])
    .index("by_createdAt", ["createdAt"]),

  monitoringStatus: defineTable({
    userId: v.string(),
    service: v.string(),
    status: v.string(),
    message: v.optional(v.string()),
    checkedAt: v.number(),
    syncRunId: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_service", ["service"])
    .index("by_checkedAt", ["checkedAt"]),
});
