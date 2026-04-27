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
 * Convex never opens outbound connections to MT5 — snapshots arrive only from Next.js API routes.
 */
import { ConvexError, v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

const AUTH_MSG = "يجب تسجيل الدخول لاستخدام هذه الوظائف";
const SOURCE = "mt5-bridge-read-only-stub" as const;
const SOURCE_LOCAL = "mt5-local-readonly" as const;

type SnapshotArg = {
  connected: boolean;
  read_only_mode: boolean;
  account?: unknown;
  ticks: unknown[];
  positions: unknown[];
  count?: number;
  symbols_configured?: string[];
  error?: string;
};

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

const localSnapshotValidator = v.object({
  connected: v.boolean(),
  read_only_mode: v.boolean(),
  account: v.optional(v.any()),
  ticks: v.array(v.any()),
  positions: v.array(v.any()),
  count: v.optional(v.number()),
  symbols_configured: v.optional(v.array(v.string())),
  error: v.optional(v.string()),
});

async function enforceGovernanceReadOnly(
  ctx: MutationCtx,
  userId: string,
  now: number,
): Promise<void> {
  const existingGov = await ctx.db
    .query("governanceState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  const govPayload = {
    userId,
    mode: "read-only-mt5-local-sync",
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
}

function parseTickCapturedAtMs(raw: unknown): number {
  const now = Date.now();
  if (typeof raw !== "string") return now;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : now;
}

function readNumeric(field: unknown): number | undefined {
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string") {
    const n = Number(field);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Stores a snapshot fetched by Next.js from the local read-only MT5 service.
 * Never inspects account.trade_allowed for enabling trades — governance stays locked read-only.
 */
export const syncReadOnlySnapshotFromLocalService = mutation({
  args: {
    snapshot: localSnapshotValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireIdentifiedUser(identity);
    const now = Date.now();
    const snapshot = args.snapshot as SnapshotArg;
    const syncRunId = `mt5-local-${now}`;

    await ctx.db.insert("monitoringStatus", {
      userId,
      service: "mt5-local-readonly",
      status: snapshot.connected ? "snapshot_received" : "offline_or_inner_error",
      message:
        snapshot.error ??
        (snapshot.connected ? "لقطة محلية للقراءة فقط" : "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل"),
      checkedAt: now,
      syncRunId,
    });

    if (!snapshot.connected) {
      await enforceGovernanceReadOnly(ctx, userId, now);
      await ctx.db.insert("auditEvents", {
        userId,
        action: "mt5_local_readonly_sync_disconnected",
        entity: "mt5LocalService",
        entityId: undefined,
        message: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
        createdAt: now,
        source: SOURCE_LOCAL,
        syncRunId,
      });
      return { ok: false as const, connected: false as const };
    }

    let accountInserted = 0;
    let ticksInserted = 0;
    let positionsInserted = 0;

    const acct = snapshot.account;
    if (acct !== undefined && acct !== null && typeof acct === "object") {
      const a = acct as Record<string, unknown>;
      const currency = typeof a.currency === "string" ? a.currency : "USD";
      const balance = readNumeric(a.balance);
      const equity = readNumeric(a.equity);
      const margin = readNumeric(a.margin);
      const freeMargin = readNumeric(a.freeMargin);
      if (
        balance !== undefined &&
        equity !== undefined &&
        margin !== undefined &&
        freeMargin !== undefined
      ) {
        let marginLevel: number | undefined;
        if (margin > 0 && equity !== undefined) {
          marginLevel = (equity / margin) * 100;
        }
        await ctx.db.insert("mt5AccountSnapshots", {
          userId,
          accountLogin:
            a.login !== undefined && a.login !== null ? String(a.login) : undefined,
          broker:
            typeof a.company === "string"
              ? a.company
              : typeof (a as { broker?: unknown }).broker === "string"
                ? String((a as { broker: string }).broker)
                : undefined,
          server: typeof a.server === "string" ? a.server : undefined,
          currency,
          balance,
          equity,
          margin,
          freeMargin,
          marginLevel,
          capturedAt: now,
          source: SOURCE_LOCAL,
          syncRunId,
        });
        accountInserted = 1;
      }
    }

    for (const row of snapshot.ticks) {
      if (!row || typeof row !== "object") continue;
      const t = row as Record<string, unknown>;
      if ("error" in t && t.error) continue;
      const symbol = typeof t.symbol === "string" ? t.symbol : "";
      const bid = readNumeric(t.bid);
      const ask = readNumeric(t.ask);
      const spread = readNumeric(t.spread);
      if (!symbol || bid === undefined || ask === undefined) continue;
      await ctx.db.insert("mt5MarketTicks", {
        symbol,
        bid,
        ask,
        spread: spread ?? Math.abs(ask - bid),
        capturedAt: parseTickCapturedAtMs(t.time),
        source: SOURCE_LOCAL,
        syncRunId,
      });
      ticksInserted += 1;
    }

    for (const row of snapshot.positions) {
      if (!row || typeof row !== "object") continue;
      const p = row as Record<string, unknown>;
      const symbol = typeof p.symbol === "string" ? p.symbol : "";
      const volume = readNumeric(p.volume);
      const openPrice = readNumeric(p.price_open);
      const currentPrice = readNumeric(p.price_current);
      const profit = readNumeric(p.profit);
      if (!symbol || volume === undefined || openPrice === undefined || currentPrice === undefined || profit === undefined)
        continue;
      const slRaw = readNumeric(p.sl);
      const tpRaw = readNumeric(p.tp);
      await ctx.db.insert("mt5OpenPositions", {
        userId,
        ticket: p.ticket !== undefined && p.ticket !== null ? String(p.ticket) : undefined,
        symbol,
        type: String(p.type ?? ""),
        volume,
        openPrice,
        currentPrice,
        stopLoss: slRaw !== undefined && slRaw !== 0 ? slRaw : undefined,
        takeProfit: tpRaw !== undefined && tpRaw !== 0 ? tpRaw : undefined,
        profit,
        openedAt: undefined,
        capturedAt: now,
        source: SOURCE_LOCAL,
        syncRunId,
      });
      positionsInserted += 1;
    }

    await enforceGovernanceReadOnly(ctx, userId, now);

    await ctx.db.insert("auditEvents", {
      userId,
      action: "mt5_local_readonly_snapshot_sync",
      entity: "mt5LocalService",
      entityId: undefined,
      message: "تمت مزامنة لقطة MT5 للقراءة فقط",
      createdAt: now,
      source: SOURCE_LOCAL,
      syncRunId,
    });

    return {
      ok: true as const,
      connected: true as const,
      inserted: {
        accountSnapshots: accountInserted,
        ticks: ticksInserted,
        positions: positionsInserted,
        auditEvents: 1,
        monitoringStatus: 1,
      },
    };
  },
});

/** Dev-only: strips seeded stub/demo rows — requires Convex env ALLOW_DEV_CLEANUP === "true". Never deletes mt5-local-readonly. */
const DEMO_SOURCES_FOR_PURGE = new Set(["core-demo-seed", "mt5-bridge-read-only-stub"]);

export const clearDemoMt5ReadOnlyData = mutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.ALLOW_DEV_CLEANUP !== "true") {
      throw new ConvexError(
        "مسح تجريبي معطّل — عيّن ALLOW_DEV_CLEANUP=true في بيئة Convex للتطوير فقط.",
      );
    }
    const identity = await ctx.auth.getUserIdentity();
    requireIdentifiedUser(identity);

    let removed = 0;

    const tables = [
      "mt5AccountSnapshots",
      "mt5MarketTicks",
      "mt5OpenPositions",
      "auditEvents",
      "labSignalSnapshots",
      "protectionEvents",
    ] as const;

    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        const src = (row as { source?: string }).source;
        if (typeof src === "string" && DEMO_SOURCES_FOR_PURGE.has(src)) {
          await ctx.db.delete(row._id);
          removed += 1;
        }
      }
    }

    return { ok: true as const, removed };
  },
});
