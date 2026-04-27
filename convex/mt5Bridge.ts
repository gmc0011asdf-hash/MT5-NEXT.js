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
const SOURCE_LOCAL_SYMBOL_CATALOG = "mt5-local-catalog" as const;
const SOURCE_LOCAL_HISTORY = "mt5-local-trade-history" as const;

const MAX_SYMBOLS_PER_MUTATION = 200;
const MAX_DEALS_PER_MUTATION = 200;

function isFinalChunk(
  chunkIndex: number | undefined,
  totalChunks: number | undefined,
): boolean {
  if (totalChunks === undefined || totalChunks <= 1) return true;
  if (chunkIndex === undefined) return true;
  return chunkIndex === totalChunks - 1;
}

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

function readOptionalStringField(
  row: Record<string, unknown>,
  snake: string,
  camel: string,
): string | undefined {
  const s1 = row[snake];
  const s2 = row[camel];
  if (typeof s1 === "string" && s1.length > 0) return s1;
  if (typeof s2 === "string" && s2.length > 0) return s2;
  return undefined;
}

function readOptionalBool(row: Record<string, unknown>, key: string): boolean | undefined {
  const v = row[key];
  if (typeof v === "boolean") return v;
  return undefined;
}

/**
 * مزامنة أزواج MT5 (قراءة فقط) — دفعة واحدة بحد أقصى 200 رمز؛ لا order_send.
 * upsert لكل رمز عبر فهرس by_name فقط + إعداد المستخدم بـ by_userId_symbol.
 */
export const syncReadOnlySymbolsFromLocalService = mutation({
  args: {
    connected: v.boolean(),
    symbols: v.array(v.any()),
    syncRunId: v.optional(v.string()),
    total: v.optional(v.number()),
    chunkIndex: v.optional(v.number()),
    totalChunks: v.optional(v.number()),
    read_only_mode: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireIdentifiedUser(identity);
    const now = Date.now();
    const runId = args.syncRunId ?? `mt5-cat-${now}`;

    if (args.symbols.length > MAX_SYMBOLS_PER_MUTATION) {
      throw new ConvexError("عدد الرموز كبير جدًا، يجب إرسالها على دفعات");
    }

    if (!args.connected) {
      await enforceGovernanceReadOnly(ctx, userId, now);
      await ctx.db.insert("auditEvents", {
        userId,
        action: "mt5_local_readonly_symbols_disconnected",
        entity: "mt5LocalService",
        message: args.error ?? "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
        createdAt: now,
        source: SOURCE_LOCAL_SYMBOL_CATALOG,
        syncRunId: runId,
      });
      return { ok: false as const, connected: false as const };
    }

    let symbolRows = 0;
    for (const row of args.symbols) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      if (!name) continue;

      const digits = readNumeric(rec.digits);
      const point = readNumeric(rec.point);
      const spread = readNumeric(rec.spread);
      const tradeMode = readNumeric(
        rec.trade_mode !== undefined ? rec.trade_mode : rec.tradeMode,
      );

      const existingSym = await ctx.db
        .query("mt5Symbols")
        .withIndex("by_name", (q) => q.eq("name", name))
        .first();

      const doc = {
        name,
        path: readOptionalStringField(rec, "path", "path"),
        description: readOptionalStringField(rec, "description", "description"),
        currencyBase: readOptionalStringField(rec, "currency_base", "currencyBase"),
        currencyProfit: readOptionalStringField(rec, "currency_profit", "currencyProfit"),
        currencyMargin: readOptionalStringField(rec, "currency_margin", "currencyMargin"),
        digits: digits !== undefined ? Math.floor(digits) : undefined,
        visible: readOptionalBool(rec, "visible"),
        tradeMode: tradeMode !== undefined ? Math.floor(tradeMode) : undefined,
        point,
        spread: spread !== undefined ? Math.floor(spread) : undefined,
        source: SOURCE_LOCAL_SYMBOL_CATALOG,
        syncRunId: runId,
        capturedAt: now,
      };

      if (existingSym) {
        await ctx.db.patch(existingSym._id, doc);
      } else {
        await ctx.db.insert("mt5Symbols", doc);
      }
      symbolRows += 1;

      const existingSetting = await ctx.db
        .query("userSymbolSettings")
        .withIndex("by_userId_symbol", (q) => q.eq("userId", userId).eq("symbol", name))
        .first();
      if (!existingSetting) {
        await ctx.db.insert("userSymbolSettings", {
          userId,
          symbol: name,
          enabled: false,
          showInLab: false,
          updatedAt: now,
        });
      }
    }

    if (isFinalChunk(args.chunkIndex, args.totalChunks)) {
      await enforceGovernanceReadOnly(ctx, userId, now);
      const totalLabel = args.total !== undefined ? ` / ${args.total}` : "";
      await ctx.db.insert("auditEvents", {
        userId,
        action: "mt5_local_readonly_symbols_sync",
        entity: "mt5LocalService",
        message: `كتالوج أزواج MT5 (دفعات)${totalLabel} — آخر دفعة: ${symbolRows} رمز. قراءة فقط.`,
        createdAt: now,
        source: SOURCE_LOCAL_SYMBOL_CATALOG,
        syncRunId: runId,
      });
    }

    return { ok: true as const, connected: true as const, inserted: { symbolRows, syncRunId: runId } };
  },
});

/**
 * مزامنة سجل الصفقات المغلقة (قراءة فقط) — دفعة بحد أقصى 200 صفقة؛ لا order_send.
 */
export const syncReadOnlyTradeHistoryFromLocalService = mutation({
  args: {
    connected: v.boolean(),
    deals: v.array(v.any()),
    read_only_mode: v.optional(v.boolean()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    error: v.optional(v.string()),
    syncRunId: v.optional(v.string()),
    chunkIndex: v.optional(v.number()),
    totalChunks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireIdentifiedUser(identity);
    const now = Date.now();
    const runId = args.syncRunId ?? `mt5-hist-${now}`;

    if (args.deals.length > MAX_DEALS_PER_MUTATION) {
      throw new ConvexError("عدد صفقات السجل كبير جدًا، يجب إرسالها على دفعات");
    }

    if (isFinalChunk(args.chunkIndex, args.totalChunks)) {
      await ctx.db.insert("monitoringStatus", {
        userId,
        service: "mt5-local-history-readonly",
        status: args.connected ? "history_sync_received" : "offline_or_inner_error",
        message:
          args.error ??
          (args.connected
            ? "سجل صفقات محلي للقراءة فقط (دفعات)"
            : "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل"),
        checkedAt: now,
        syncRunId: runId,
      });
    }

    if (!args.connected) {
      if (isFinalChunk(args.chunkIndex, args.totalChunks)) {
        await enforceGovernanceReadOnly(ctx, userId, now);
        await ctx.db.insert("auditEvents", {
          userId,
          action: "mt5_local_readonly_history_disconnected",
          entity: "mt5LocalService",
          message: args.error ?? "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
          createdAt: now,
          source: SOURCE_LOCAL_HISTORY,
          syncRunId: runId,
        });
      }
      return { ok: false as const, connected: false as const };
    }

    let inserted = 0;
    let skippedDuplicates = 0;

    for (const row of args.deals) {
      if (!row || typeof row !== "object") continue;
      const d = row as Record<string, unknown>;
      const dealTicket =
        d.ticket !== undefined && d.ticket !== null ? String(d.ticket).trim() : "";
      if (!dealTicket) continue;

      const existing = await ctx.db
        .query("mt5TradeHistoryDeals")
        .withIndex("by_userId_dealTicket", (q) =>
          q.eq("userId", userId).eq("dealTicket", dealTicket),
        )
        .first();
      if (existing) {
        skippedDuplicates += 1;
        continue;
      }

      const sym = typeof d.symbol === "string" ? d.symbol : "";
      if (!sym) continue;

      const timeRaw = d.time;
      const timeMs = readNumeric(timeRaw);
      if (timeMs === undefined || !Number.isFinite(timeMs)) continue;

      const volume = readNumeric(d.volume);
      const price = readNumeric(d.price);
      const profit = readNumeric(d.profit);
      if (volume === undefined || price === undefined || profit === undefined) continue;

      const orderVal = readNumeric(d.order);
      const posVal = readNumeric(d.position_id !== undefined ? d.position_id : d.positionId);

      const orderTicket =
        orderVal !== undefined && orderVal !== 0 ? String(Math.floor(orderVal)) : undefined;
      const positionId =
        posVal !== undefined && posVal !== 0 ? String(Math.floor(posVal)) : undefined;

      const commission = readNumeric(d.commission);
      const swap = readNumeric(d.swap);
      const fee = d.fee !== undefined && d.fee !== null ? readNumeric(d.fee) : undefined;
      const magic = readNumeric(d.magic);

      const typeStr =
        d.type !== undefined && d.type !== null ? String(d.type) : undefined;
      const entryStr =
        d.entry !== undefined && d.entry !== null ? String(d.entry) : undefined;

      await ctx.db.insert("mt5TradeHistoryDeals", {
        userId,
        dealTicket,
        orderTicket,
        positionId,
        symbol: sym,
        type: typeStr,
        entry: entryStr,
        volume,
        price,
        profit,
        commission: commission !== undefined ? commission : undefined,
        swap: swap !== undefined ? swap : undefined,
        fee: fee !== undefined ? fee : undefined,
        time: timeMs,
        comment: typeof d.comment === "string" ? d.comment : undefined,
        magic: magic !== undefined ? Math.floor(magic) : undefined,
        source: SOURCE_LOCAL_HISTORY,
        syncRunId: runId,
        capturedAt: now,
      });
      inserted += 1;
    }

    if (isFinalChunk(args.chunkIndex, args.totalChunks)) {
      await enforceGovernanceReadOnly(ctx, userId, now);
      await ctx.db.insert("auditEvents", {
        userId,
        action: "mt5_local_readonly_trade_history_sync",
        entity: "mt5LocalService",
        message: `سجل صفقات MT5 (دفعات) — صفوف جديدة في آخر دفعة: ${inserted}، مكرر متجاهل: ${skippedDuplicates}. قراءة فقط.`,
        createdAt: now,
        source: SOURCE_LOCAL_HISTORY,
        syncRunId: runId,
      });
    }

    return {
      ok: true as const,
      connected: true as const,
      inserted: { deals: inserted, skippedDuplicates, syncRunId: runId },
    };
  },
});

/** إعداد عرض الأزواج للمستخدم — لا يستدعي MT5. */
export const updateMySymbolSetting = mutation({
  args: {
    symbol: v.string(),
    enabled: v.boolean(),
    showInLab: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireIdentifiedUser(identity);
    const now = Date.now();
    await enforceGovernanceReadOnly(ctx, userId, now);
    const existing = await ctx.db
      .query("userSymbolSettings")
      .withIndex("by_userId_symbol", (q) => q.eq("userId", userId).eq("symbol", args.symbol))
      .first();
    const payload = {
      userId,
      symbol: args.symbol,
      enabled: args.enabled,
      showInLab: args.showInLab,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("userSymbolSettings", payload);
    }
    await ctx.db.insert("auditEvents", {
      userId,
      action: "user_symbol_lab_setting_updated",
      entity: "userSymbolSettings",
      entityId: args.symbol,
      message: `أزواج المختبر: ${args.symbol} — مفعّل: ${args.enabled}، عرض في المختبر: ${args.showInLab}. عرض فقط، بدون تنفيذ صفقات.`,
      createdAt: now,
      source: "user-symbol-settings",
    });
    return { ok: true as const };
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
