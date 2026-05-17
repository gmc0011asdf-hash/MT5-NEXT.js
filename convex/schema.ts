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
    .index("by_checkedAt", ["checkedAt"])
    .index("by_userId_service", ["userId", "service"]),

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
    .index("by_userId_symbol_timeframe", ["userId", "symbol", "timeframe"])
    .index("by_userId_symbol_timeframe_time", ["userId", "symbol", "timeframe", "time"]),

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

  // ─── Decision Journal (A9) ────────────────────────────────────────────────
  // Read-only analytical decision log — no trade execution.
  // userId = identity.subject from Clerk. Timestamps are Unix ms (number).

  decisionRuns: defineTable({
    decisionId:        v.string(),
    platform:          v.string(),
    symbol:            v.string(),
    timeframe:         v.string(),
    status:            v.string(),
    finalDecision:     v.string(),
    grade:             v.string(),
    probability:       v.number(),
    entryPrice:        v.number(),
    invalidationPrice: v.number(),
    reason:            v.string(),
    userId:            v.string(),
    createdAt:         v.number(),
    updatedAt:         v.number(),
    readOnly:          v.boolean(),
    source:            v.string(),
  })
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_userId_platform",  ["userId", "platform"])
    .index("by_userId_symbol",    ["userId", "symbol"])
    .index("by_userId_status",    ["userId", "status"])
    .index("by_decisionId",       ["decisionId"]),

  committeeResults: defineTable({
    decisionId:    v.string(),
    userId:        v.string(),
    committeeId:   v.string(),
    committeeName: v.string(),
    verdict:       v.string(),
    score:         v.number(),
    summary:       v.string(),
    reasons:       v.array(v.string()),
    createdAt:     v.number(),
  })
    .index("by_decisionId",      ["decisionId"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

  decisionRiskSnapshots: defineTable({
    decisionId:      v.string(),
    userId:          v.string(),
    riskUsd:         v.number(),
    riskPercent:     v.number(),
    estimatedLot:    v.number(),
    stopLoss:        v.number(),
    takeProfit1:     v.number(),
    takeProfit2:     v.optional(v.number()),
    takeProfit3:     v.optional(v.number()),
    rewardRiskRatio: v.number(),
    marginSafe:      v.boolean(),
    createdAt:       v.number(),
  })
    .index("by_decisionId",      ["decisionId"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

  decisionReviewSchedules: defineTable({
    decisionId:        v.string(),
    userId:            v.string(),
    criticalTimeframe: v.string(),
    nextReviewAt:      v.number(),
    expiresAt:         v.number(),
    reviewReason:      v.string(),
    monitoringMode:    v.string(),
    createdAt:         v.number(),
    updatedAt:         v.number(),
  })
    .index("by_userId_nextReviewAt", ["userId", "nextReviewAt"])
    .index("by_userId_expiresAt",    ["userId", "expiresAt"])
    .index("by_decisionId",          ["decisionId"]),

  decisionAuditEvents: defineTable({
    decisionId:  v.string(),
    userId:      v.string(),
    eventType:   v.string(),
    fromStatus:  v.optional(v.string()),
    toStatus:    v.optional(v.string()),
    message:     v.string(),
    triggeredBy: v.string(),
    createdAt:   v.number(),
  })
    .index("by_decisionId",      ["decisionId"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

  demoExecutionAttempts: defineTable({
    userId:        v.string(),
    platform:      v.string(),            // "MT5"
    accountMode:   v.string(),            // "DEMO_ONLY"
    decisionId:    v.optional(v.string()),
    symbol:        v.string(),
    orderType:     v.string(),
    direction:     v.optional(v.string()),
    requestedLot:  v.optional(v.number()),
    status:        v.string(),            // "DONE" | "REJECTED" | "PRECHECK_FAILED" | "ERROR"
    ok:            v.boolean(),
    accepted:      v.optional(v.boolean()),
    ticket:        v.optional(v.number()),
    retcode:       v.optional(v.number()),
    retcodeText:   v.optional(v.string()),
    errorMessage:  v.optional(v.string()),
    marginRequired:   v.optional(v.number()),
    marginFree:       v.optional(v.number()),
    marginFreeAfter:  v.optional(v.number()),
    fillingMode:      v.optional(v.string()),
    fillingRetries:   v.optional(v.number()),
    createdAt:     v.number(),
  })
    .index("by_user_createdAt",         ["userId", "createdAt"])
    .index("by_user_symbol_createdAt",  ["userId", "symbol", "createdAt"])
    .index("by_user_decisionId",        ["userId", "decisionId"]),

  // ── B6.1: Finnhub news events ───────────────────────────────────────────────
  newsEvents: defineTable({
    provider:        v.string(),           // "finnhub"
    providerEventId: v.string(),           // Finnhub article id (stringified)
    category:        v.string(),           // "general" | "crypto" | "forex"
    market:          v.string(),           // "GLOBAL" | "CRYPTO" | "MT5"
    headline:        v.string(),
    summary:         v.optional(v.string()),
    source:          v.optional(v.string()),
    url:             v.optional(v.string()),
    image:           v.optional(v.string()),
    related:         v.optional(v.string()),
    publishedAt:     v.number(),           // Unix ms
    impact:          v.string(),           // "HIGH" | "MEDIUM" | "LOW"
    affectedSymbols: v.array(v.string()),
    createdAt:       v.number(),
    updatedAt:       v.number(),
  })
    .index("by_provider_id",           ["provider", "providerEventId"])
    .index("by_publishedAt",           ["publishedAt"])
    .index("by_category_publishedAt",  ["category", "publishedAt"]),

  // ── B6.1.1: Human review and translation layer ──────────────────────────────
  newsReviews: defineTable({
    newsEventId:                v.id("newsEvents"),
    userId:                     v.string(),
    // Translation (manual, no external API key stored)
    translatedHeadline:         v.optional(v.string()),
    translatedSummary:          v.optional(v.string()),
    // Human override — can raise impact, never automatically lowers it
    userImpactOverride:         v.optional(v.string()), // "NONE"|"LOW"|"MEDIUM"|"HIGH"|"BLOCK"
    userAffectedSymbolsOverride: v.optional(v.array(v.string())),
    relationshipType:           v.optional(v.string()), // "DIRECT"|"INDIRECT"|"MACRO"|"GLOBAL_RISK"|"NONE"
    userDirectionBias:          v.optional(v.string()), // "BULLISH"|"BEARISH"|"NEUTRAL"|"UNKNOWN"
    userConfidence:             v.optional(v.number()), // 0–100
    userNote:                   v.optional(v.string()),
    // Computed final values
    finalImpact:                v.string(),  // highest of auto + user
    finalAffectedSymbols:       v.array(v.string()),
    finalDecision:              v.string(),  // "PASS"|"WATCH"|"WARN"|"BLOCK_REVIEW"
    reviewedAt:                 v.number(),
    createdAt:                  v.number(),
    updatedAt:                  v.number(),
  })
    .index("by_news_user",       ["newsEventId", "userId"])
    .index("by_user_reviewedAt", ["userId", "reviewedAt"])
    .index("by_finalImpact",     ["finalImpact"])
    .index("by_finalDecision",   ["finalDecision"]),
});
