import { ConvexError } from "convex/values";
import { mutation } from "./_generated/server";

const AUTH_MSG = "يجب تسجيل الدخول لاستخدام هذه الوظائف";
const DEMO_SOURCE = "core-demo-seed";

export const seedCoreDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError(AUTH_MSG);
    }

    const clerkUserId = identity.subject;
    const now = Date.now();
    const email = identity.email ?? undefined;
    const name =
      typeof identity.givenName === "string" || typeof identity.familyName === "string"
        ? [identity.givenName, identity.familyName].filter(Boolean).join(" ") || undefined
        : undefined;

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        email: email ?? existingUser.email,
        name: name ?? existingUser.name,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("users", {
        clerkUserId,
        email,
        name,
        role: "demo",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }

    const userId = clerkUserId;

    const existingGov = await ctx.db
      .query("governanceState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const govPayload = {
      userId,
      mode: "demo-safe",
      tradingEnabled: false,
      readOnly: true,
      maxDailyTrades: 0,
      maxRiskUsd: 0,
      updatedAt: now,
    };

    if (existingGov) {
      await ctx.db.patch(existingGov._id, govPayload);
    } else {
      await ctx.db.insert("governanceState", govPayload);
    }

    await ctx.db.insert("mt5AccountSnapshots", {
      userId,
      accountLogin: "DEMO-10001",
      broker: "Demo Broker",
      server: "Demo-Server-01",
      currency: "USD",
      balance: 100_000,
      equity: 100_012.5,
      margin: 250,
      freeMargin: 99_762.5,
      marginLevel: 40_005,
      capturedAt: now,
      source: DEMO_SOURCE,
    });

    await ctx.db.insert("mt5MarketTicks", {
      symbol: "EURUSD",
      bid: 1.0842,
      ask: 1.0844,
      spread: 2,
      capturedAt: now,
      source: DEMO_SOURCE,
    });
    await ctx.db.insert("mt5MarketTicks", {
      symbol: "XAUUSD",
      bid: 2_345.1,
      ask: 2_345.4,
      spread: 3,
      capturedAt: now - 1,
      source: DEMO_SOURCE,
    });

    const signalId = await ctx.db.insert("labSignalSnapshots", {
      userId,
      symbol: "EURUSD",
      timeframe: "H1",
      verdict: "neutral-demo",
      probability: 0.42,
      entry: 1.085,
      stopLoss: 1.078,
      takeProfit: 1.092,
      riskUsd: 50,
      recommendedLot: 0.01,
      status: "demo",
      reason: "بيانات تجريبية فقط — لا تنفيذ.",
      createdAt: now,
      source: DEMO_SOURCE,
    });

    await ctx.db.insert("committeeReports", {
      signalId,
      userId,
      symbol: "EURUSD",
      marketMindScore: 72,
      protectionMindScore: 88,
      executionMindScore: 65,
      finalVerdict: "demo-hold",
      summary: "تقرير لجنة تجريبي — لا يؤثر على التداول الحقيقي.",
      createdAt: now,
    });

    await ctx.db.insert("mt5OpenPositions", {
      userId,
      ticket: "DEMO-T-9001",
      symbol: "EURUSD",
      type: "buy",
      volume: 0.01,
      openPrice: 1.084,
      currentPrice: 1.0843,
      stopLoss: 1.08,
      takeProfit: 1.09,
      profit: 3.2,
      openedAt: now - 3_600_000,
      capturedAt: now,
      source: DEMO_SOURCE,
    });

    await ctx.db.insert("protectionEvents", {
      userId,
      symbol: "EURUSD",
      eventType: "demo-guard",
      severity: "info",
      message: "حدث حماية تجريبي — لا حظر فعلي.",
      blocked: false,
      createdAt: now,
      source: DEMO_SOURCE,
    });

    await ctx.db.insert("auditEvents", {
      userId,
      action: "core_seed",
      entity: "system",
      entityId: undefined,
      message: "تم حقن بيانات تجريبية للنظام (قراءة فقط).",
      createdAt: now,
      source: DEMO_SOURCE,
    });

    await ctx.db.insert("monitoringStatus", {
      userId,
      service: "convex-core-demo",
      status: "ok",
      message: "مسار مراقبة تجريبي — لا اتصال MT5.",
      checkedAt: now,
    });

    return { ok: true as const, seededAt: now };
  },
});
