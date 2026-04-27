/**
 * MT5 READ-ONLY BRIDGE (Convex) — جسم قاعدة لجمع لقطات MT5 بشكل آمن.
 *
 * =============================================================================
 * SAFETY CONTRACT — أغلق أي PR يحاول:
 * - order_send / close / modify / delete / pending / market execution
 * - تمكين tradingEnabled أو إلغاء readOnly في الحوكمة
 * - ربط مباشر ينفّذ صفقات من دالة المسار هنا
 * =============================================================================
 * This file may:
 * - Expose read-only preview STUBS (no real MT5 I/O yet)
 * - Write snapshot rows to Convex (mt5* tables) that represent *read* data only
 * - Log audit / monitoring lines for bridge health
 *
 * There is no MetaTrader network I/O in this build; data is demo-shaped only.
 */
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";

const AUTH_MSG = "يجب تسجيل الدخول لاستخدام هذه الوظائف";
const SOURCE = "mt5-bridge-read-only-stub" as const;

function requireIdentifiedUser(identity: { subject: string } | null): string {
  if (!identity) {
    throw new ConvexError(AUTH_MSG);
  }
  return identity.subject;
}

/** وضع الاتصال: لا خادم MT5 حقيقي — وضع وهم للقراءة فقط. */
export const getMt5BridgeConnectionStatus = query({
  args: {},
  handler: async () => {
    return {
      connected: false as const,
      mode: "read_only_stub" as const,
      messageAr: "جسر MT5 في وضع وهمي — قراءة فقط. لا يوجد اتصال بميتا تريدر في هذه البنية.",
    };
  },
});

/**
 * لقطة حساب بشكل وهمي (قارن بمخطط mt5AccountSnapshots) — لا بيانات حية.
 */
export const previewReadOnlyAccountSnapshotStub = query({
  args: {},
  handler: async () => {
    return {
      isStub: true as const,
      messageAr: "شكل لقطة تعبئة — لا يوجد اتصال MT5. مفاتيح المستقبل: userId, accountLogin, balance, ...",
      example: {
        accountLogin: "READ-ONLY-SHAPED",
        currency: "USD",
        balance: 0,
        equity: 0,
        margin: 0,
        freeMargin: 0,
        source: SOURCE,
      },
    };
  },
});

/** تيكات بشكل وهمي — نفس شكل mt5MarketTicks. */
export const previewReadOnlyMarketTicksStub = query({
  args: {},
  handler: async () => {
    return {
      isStub: true as const,
      messageAr: "شكل تيكات — لا بث مباشر من MT5 في هذه البنية.",
      example: [
        { symbol: "EURUSD", bid: 0, ask: 0, spread: 0, source: SOURCE },
        { symbol: "XAUUSD", bid: 0, ask: 0, spread: 0, source: SOURCE },
      ],
    };
  },
});

/** مراكز مفتوحة بشكل وهمي — نفس شكل mt5OpenPositions. */
export const previewReadOnlyOpenPositionsStub = query({
  args: {},
  handler: async () => {
    return {
      isStub: true as const,
      messageAr: "شكل مراكز — لا سحب مراكز حي من MT5 في هذه البنية.",
      example: [
        {
          symbol: "EURUSD",
          type: "read-only-example",
          volume: 0,
          openPrice: 0,
          currentPrice: 0,
          profit: 0,
          source: SOURCE,
        },
      ],
    };
  },
});

/**
 * مزامنة وهمية: تكتب فقط لقطات بشكل آمن (للتجربة) + تدقيق + مراقبة.
 * يعيد الحوكمة إلى: tradingEnabled: false, readOnly: true
 * ‎—‎ لا يستدعي أي وظائف تداول.
 */
export const demoSyncReadOnlySnapshotsFromMt5Stub = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireIdentifiedUser(identity);
    const now = Date.now();

    const existingGov = await ctx.db
      .query("governanceState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const govPayload = {
      userId,
      mode: "read-only-bridge-stub",
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
      accountLogin: "BRIDGE-STUB-R-O",
      broker: "Stub-Not-Connected",
      server: "read-only-stub",
      currency: "USD",
      balance: 100_000.5,
      equity: 100_001.2,
      margin: 100,
      freeMargin: 99_900.1,
      marginLevel: 9_999.0,
      capturedAt: now,
      source: SOURCE,
    });

    await ctx.db.insert("mt5MarketTicks", {
      symbol: "GBPUSD",
      bid: 1.2641,
      ask: 1.2643,
      spread: 2,
      capturedAt: now,
      source: SOURCE,
    });
    await ctx.db.insert("mt5MarketTicks", {
      symbol: "USDJPY",
      bid: 149.22,
      ask: 149.25,
      spread: 3,
      capturedAt: now - 1,
      source: SOURCE,
    });

    await ctx.db.insert("mt5OpenPositions", {
      userId,
      ticket: "BRIDGE-POS-RO-1",
      symbol: "XAUUSD",
      type: "read-only-demo",
      volume: 0.01,
      openPrice: 2_340.0,
      currentPrice: 2_340.5,
      stopLoss: 2_300.0,
      takeProfit: 2_400.0,
      profit: 0.5,
      openedAt: now - 3_600_000,
      capturedAt: now,
      source: SOURCE,
    });

    await ctx.db.insert("monitoringStatus", {
      userId,
      service: "mt5-bridge-read-only",
      status: "stub_synced",
      message: "مزامنة وهمية — قراءة فقط. لا اتصال MT5.",
      checkedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      userId,
      action: "mt5_bridge_read_only_stub_sync",
      entity: "mt5Bridge",
      entityId: "demoSyncReadOnlySnapshotsFromMt5Stub",
      message: "مزامنة لقطات وهمية عبر جسر MT5 (قراءة فقط) — بدون أي أمر تداول.",
      createdAt: now,
      source: SOURCE,
    });

    return { ok: true as const, syncedAt: now, source: SOURCE };
  },
});
