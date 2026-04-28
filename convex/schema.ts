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
    comment: v.optional(v.string()),
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

  mt5Symbols: defineTable({
    name: v.string(),
    path: v.optional(v.string()),
    description: v.optional(v.string()),
    currencyBase: v.optional(v.string()),
    currencyProfit: v.optional(v.string()),
    currencyMargin: v.optional(v.string()),
    digits: v.optional(v.number()),
    visible: v.optional(v.boolean()),
    tradeMode: v.optional(v.number()),
    point: v.optional(v.number()),
    spread: v.optional(v.number()),
    visibleOnly: v.optional(v.boolean()),
    selectedInMarketWatch: v.optional(v.boolean()),
    source: v.string(),
    syncRunId: v.optional(v.string()),
    capturedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_capturedAt", ["capturedAt"])
    .index("by_source", ["source"])
    .index("by_source_capturedAt", ["source", "capturedAt"]),

  userSymbolSettings: defineTable({
    userId: v.string(),
    symbol: v.string(),
    enabled: v.boolean(),
    showInLab: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_symbol", ["symbol"])
    .index("by_userId_symbol", ["userId", "symbol"]),

  mt5TradeHistoryDeals: defineTable({
    userId: v.string(),
    dealTicket: v.string(),
    orderTicket: v.optional(v.string()),
    positionId: v.optional(v.string()),
    symbol: v.string(),
    type: v.optional(v.string()),
    entry: v.optional(v.string()),
    volume: v.number(),
    price: v.number(),
    profit: v.number(),
    commission: v.optional(v.number()),
    swap: v.optional(v.number()),
    fee: v.optional(v.number()),
    time: v.number(),
    comment: v.optional(v.string()),
    magic: v.optional(v.number()),
    source: v.string(),
    syncRunId: v.optional(v.string()),
    capturedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_symbol", ["symbol"])
    .index("by_time", ["time"])
    .index("by_userId_time", ["userId", "time"])
    .index("by_dealTicket", ["dealTicket"])
    .index("by_userId_dealTicket", ["userId", "dealTicket"]),

  mt5Candles: defineTable({
    userId: v.string(),
    symbol: v.string(),
    timeframe: v.string(),
    time: v.number(),
    open: v.number(),
    high: v.number(),
    low: v.number(),
    close: v.number(),
    tickVolume: v.optional(v.number()),
    spread: v.optional(v.number()),
    realVolume: v.optional(v.number()),
    source: v.string(),
    syncRunId: v.optional(v.string()),
    capturedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_symbol_timeframe", ["symbol", "timeframe"])
    .index("by_symbol_timeframe_time", ["symbol", "timeframe", "time"])
    .index("by_userId_symbol_timeframe", ["userId", "symbol", "timeframe"]),

  technicalIndicatorSnapshots: defineTable({
    userId: v.string(),
    symbol: v.string(),
    timeframe: v.string(),
    candleCount: v.number(),
    ema20: v.optional(v.number()),
    ema50: v.optional(v.number()),
    ema200: v.optional(v.number()),
    rsi14: v.optional(v.number()),
    atr14: v.optional(v.number()),
    macd: v.optional(v.number()),
    macdSignal: v.optional(v.number()),
    macdHistogram: v.optional(v.number()),
    volatility: v.optional(v.number()),
    recentHigh: v.optional(v.number()),
    recentLow: v.optional(v.number()),
    lastClose: v.optional(v.number()),
    trendBias: v.string(),
    momentumBias: v.string(),
    createdAt: v.number(),
    source: v.string(),
    syncRunId: v.optional(v.string()),
  })
    .index("by_userId_symbol_timeframe", ["userId", "symbol", "timeframe"])
    .index("by_symbol_timeframe", ["symbol", "timeframe"])
    .index("by_createdAt", ["createdAt"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),
});
