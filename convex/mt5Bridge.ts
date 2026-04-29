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
const SOURCE_LOCAL_SYMBOL_CATALOG = "mt5-market-watch-visible" as const;
const SOURCE_LOCAL_HISTORY = "mt5-local-readonly" as const;

const MAX_SYMBOLS_PER_MUTATION = 200;
const MAX_DEALS_PER_MUTATION = 200;
const MAX_CANDLES_PER_MUTATION = 1000;

/**
 * T3-04: Upsert a single monitoringStatus row by (userId, service).
 * Uses the by_userId_service compound index so no unbounded collect() is needed.
 * Replaces every direct ctx.db.insert("monitoringStatus", ...) call.
 */
async function _upsertMonitoringStatus(
  ctx: MutationCtx,
  doc: {
    userId: string;
    service: string;
    status: string;
    message?: string;
    checkedAt: number;
    syncRunId?: string;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("monitoringStatus")
    .withIndex("by_userId_service", (q) =>
      q.eq("userId", doc.userId).eq("service", doc.service),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: doc.status,
      message: doc.message,
      checkedAt: doc.checkedAt,
      syncRunId: doc.syncRunId,
    });
  } else {
    await ctx.db.insert("monitoringStatus", doc);
  }
}

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
      comment: "stub",
      openedAt: now - 3_600_000,
      capturedAt: now,
      source: SOURCE,
    });

    await _upsertMonitoringStatus(ctx, {
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

    await _upsertMonitoringStatus(ctx, {
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
        comment: typeof p.comment === "string" && p.comment.length > 0 ? p.comment : undefined,
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
    const runId = args.syncRunId ?? `mt5-mw-visible-${now}`;

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

      const selectedInMarketWatch = rec.selectedInMarketWatch === true || rec.visible === true;
      if (!selectedInMarketWatch) continue;
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
        visibleOnly: true,
        selectedInMarketWatch,
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
      await _upsertMonitoringStatus(ctx, {
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

// ---------------------------------------------------------------------------
// Candle freshness thresholds — عتبات حداثة الشموع
// الشمعة التي لا تزال تتشكّل قد تُعدَّل (patch)؛ أما الشموع المغلقة فيجب أن تكون متطابقة عادةً.
// ---------------------------------------------------------------------------
const STALE_THRESHOLD_MS: Record<string, number> = {
  M1:  3 * 60 * 1000,        // 3 minutes
  M5:  10 * 60 * 1000,       // 10 minutes
  M15: 30 * 60 * 1000,       // 30 minutes
  M30: 60 * 60 * 1000,       // 60 minutes
  H1:  2 * 60 * 60 * 1000,   // 2 hours
  H4:  8 * 60 * 60 * 1000,   // 8 hours
  D1:  36 * 60 * 60 * 1000,  // 36 hours
};

// Broker clock skew tolerance thresholds — عتبات فارق توقيت الوسيط
// MT5 broker servers often run ahead of UTC by seconds or even minutes.
// 2 min  → accept silently (normal NTP drift)
// 12 h   → accept with brokerClockSkewDetected flag (server/timezone offset)
// > 12 h → reject as obviously impossible future candle
const SKEW_SILENT_MS  = 2  * 60 * 1000;        // 2 minutes  — accept, no flag
const SKEW_WARN_MS    = 12 * 60 * 60 * 1000;   // 12 hours   — accept + flag
// anything beyond SKEW_WARN_MS is rejected as invalid

type CandelFreshnessSummary = {
  /** Server wall-clock at the time of this sync (ms) */
  serverNowMs: number;
  /** Latest candle time (ms) per "SYMBOL/TIMEFRAME" pair seen in this batch */
  latestCandleTime: Record<string, number>;
  /** Age of the newest candle across all pairs (ms) — negative if none seen */
  newestCandleAgeMs: number;
  /** Pairs whose latest candle exceeds the expected freshness threshold */
  stalePairs: string[];
  /** True if any accepted candle had a timestamp ahead of server time by > 2 min */
  brokerClockSkewDetected: boolean;
  /** Maximum observed skew in ms across all skew-flagged candles (0 if none) */
  brokerClockSkewMs: number;
};

/** Compute freshness summary from a map of latest candle times — no DB access needed. */
function computeFreshness(
  latestByPair: Record<string, number>,
  now: number,
  brokerClockSkewMs: number,
): CandelFreshnessSummary {
  const stalePairs: string[] = [];
  let newestTime = 0;

  for (const [pair, t] of Object.entries(latestByPair)) {
    // Use server time as reference for "newest" even when candle is ahead
    const effectiveTime = Math.min(t, now);
    if (effectiveTime > newestTime) newestTime = effectiveTime;
    const timeframe = pair.split("/")[1] ?? "";
    const threshold = STALE_THRESHOLD_MS[timeframe];
    if (threshold !== undefined && now - effectiveTime > threshold) {
      stalePairs.push(pair);
    }
  }

  return {
    serverNowMs: now,
    latestCandleTime: latestByPair,
    newestCandleAgeMs: newestTime > 0 ? now - newestTime : -1,
    stalePairs,
    brokerClockSkewDetected: brokerClockSkewMs > SKEW_SILENT_MS,
    brokerClockSkewMs,
  };
}

/**
 * T3-02: مزامنة شموع OHLCV من الخدمة المحلية لـ MT5 — دفعة بحد أقصى 1000 شمعة.
 *
 * Deduplication logic (read-only, no trading):
 *   - For each candle keyed by (userId, symbol, timeframe, time):
 *     a) If no existing row → insert.
 *     b) If existing row with identical OHLC → skip (no write).
 *        الشموع المغلقة يجب أن تكون متطابقة عادةً — لا داعي للكتابة.
 *     c) If existing row with different OHLC → patch (MT5 history revision) + log to auditEvents.
 *        الشمعة الأخيرة (غير المغلقة) قد تُعدَّل بشكل طبيعي حتى تُغلق.
 *
 * Uses the by_userId_symbol_timeframe_time compound index — no collect() on large tables.
 *
 * Stage 4B additions:
 *   - Extended OHLC validation (price > 0, high >= low, OHLC within high/low, time not future)
 *   - Freshness summary (latestCandleTime, newestCandleAgeMs, stalePairs) in return value
 *   - Single auditEvent summary for invalid candles (not one per candle)
 */
export const syncReadOnlyCandlesFromLocalService = mutation({
  args: {
    connected: v.boolean(),
    candles: v.array(v.any()),
    symbols: v.optional(v.array(v.string())),
    timeframes: v.optional(v.array(v.string())),
    read_only_mode: v.optional(v.boolean()),
    error: v.optional(v.string()),
    syncRunId: v.optional(v.string()),
    chunkIndex: v.optional(v.number()),
    totalChunks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireIdentifiedUser(identity);
    const now = Date.now();
    const runId = args.syncRunId ?? `mt5-candles-${now}`;

    if (args.candles.length > MAX_CANDLES_PER_MUTATION) {
      throw new ConvexError("عدد الشموع كبير جدًا، يجب إرسالها على دفعات بحد أقصى 1000 شمعة");
    }

    await _upsertMonitoringStatus(ctx, {
      userId,
      service: "mt5-local-candles-readonly",
      status: args.connected ? "candles_sync_received" : "offline_or_inner_error",
      message:
        args.error ??
        (args.connected
          ? "شموع OHLCV محلية للقراءة فقط"
          : "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل"),
      checkedAt: now,
      syncRunId: runId,
    });

    if (!args.connected) {
      if (isFinalChunk(args.chunkIndex, args.totalChunks)) {
        await enforceGovernanceReadOnly(ctx, userId, now);
        await ctx.db.insert("auditEvents", {
          userId,
          action: "mt5_local_readonly_candles_disconnected",
          entity: "mt5LocalService",
          message: args.error ?? "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
          createdAt: now,
          source: SOURCE_LOCAL,
          syncRunId: runId,
        });
      }
      return { ok: false as const, connected: false as const };
    }

    let inserted = 0;
    let skippedIdentical = 0;
    let patchedRevisions = 0;
    let skippedInvalid = 0;
    let clockSkewAccepted = 0;   // candles accepted despite being ahead of server time

    // Track latest candle time per "SYMBOL/TIMEFRAME" for freshness summary
    const latestByPair: Record<string, number> = {};

    // Collect reasons for truly invalid candles (one summary audit, not one per candle)
    const invalidReasons: string[] = [];

    // Maximum observed skew for flagged-but-accepted candles
    let maxSkewMs = 0;

    for (const row of args.candles) {
      if (!row || typeof row !== "object") {
        skippedInvalid += 1;
        invalidReasons.push("candle is not an object");
        continue;
      }
      const c = row as Record<string, unknown>;

      const symbol = typeof c.symbol === "string" ? c.symbol.trim() : "";
      const timeframe = typeof c.timeframe === "string" ? c.timeframe.trim() : "";
      const open = readNumeric(c.open);
      const high = readNumeric(c.high);
      const low = readNumeric(c.low);
      const close = readNumeric(c.close);

      // time arrives as epoch-ms from Python service (ts * 1000)
      const timeRaw = readNumeric(c.time);

      // Reject if required fields are missing
      if (
        !symbol ||
        !timeframe ||
        open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined ||
        timeRaw === undefined ||
        !Number.isFinite(timeRaw)
      ) {
        skippedInvalid += 1;
        invalidReasons.push(`missing fields: sym=${symbol || "?"} tf=${timeframe || "?"}`);
        continue;
      }

      // Normalise to ms — Python sends ts*1000, but guard against bare seconds
      const timeMs = timeRaw > 10_000_000_000 ? Math.floor(timeRaw) : Math.floor(timeRaw * 1000);

      // --- Broker clock skew handling —————————————————————————————————————
      // MT5 broker servers may run ahead of UTC due to timezone offsets or NTP drift.
      // We apply a 3-tier policy:
      //   ≤ 2 min ahead  → accept silently (normal NTP drift)
      //   2 min – 12 h   → accept + flag as brokerClockSkewDetected (server timezone offset)
      //   > 12 h ahead   → reject as obviously impossible future candle
      const skewMs = timeMs - now;
      if (skewMs > SKEW_WARN_MS) {
        skippedInvalid += 1;
        invalidReasons.push(`impossible future candle (>${Math.round(SKEW_WARN_MS / 3600000)}h): ${symbol}/${timeframe}@${timeMs}`);
        continue;
      }
      if (skewMs > SKEW_SILENT_MS) {
        // Broker time is ahead by 2 min–12 h — accept but track the skew
        clockSkewAccepted += 1;
        if (skewMs > maxSkewMs) maxSkewMs = skewMs;
      }
      // ————————————————————————————————————————————————————————————————————

      // Reject if any price <= 0
      if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
        skippedInvalid += 1;
        invalidReasons.push(`price <= 0: ${symbol}/${timeframe}@${timeMs}`);
        continue;
      }

      // Reject if high < low (impossible candle body)
      if (high < low) {
        skippedInvalid += 1;
        invalidReasons.push(`high < low: ${symbol}/${timeframe}@${timeMs}`);
        continue;
      }

      // Reject if open or close fall outside [low, high]
      if (open < low || open > high || close < low || close > high) {
        skippedInvalid += 1;
        invalidReasons.push(`open/close outside high/low: ${symbol}/${timeframe}@${timeMs}`);
        continue;
      }

      // Track latest valid candle time per pair for freshness
      const pairKey = `${symbol}/${timeframe}`;
      if ((latestByPair[pairKey] ?? 0) < timeMs) {
        latestByPair[pairKey] = timeMs;
      }

      const tickVolume = readNumeric(c.tick_volume !== undefined ? c.tick_volume : c.tickVolume);
      const spreadVal = readNumeric(c.spread);
      const realVolume = readNumeric(c.real_volume !== undefined ? c.real_volume : c.realVolume);

      // T3-02 dedup: indexed lookup by (userId, symbol, timeframe, time)
      const existing = await ctx.db
        .query("mt5Candles")
        .withIndex("by_userId_symbol_timeframe_time", (q) =>
          q
            .eq("userId", userId)
            .eq("symbol", symbol)
            .eq("timeframe", timeframe)
            .eq("time", timeMs),
        )
        .first();

      if (existing) {
        // Case (b): identical OHLC — الشموع المغلقة يجب أن تكون متطابقة، لا كتابة
        if (
          existing.open === open &&
          existing.high === high &&
          existing.low === low &&
          existing.close === close
        ) {
          skippedIdentical += 1;
          continue;
        }

        // Case (c): OHLC differs — الشمعة الأخيرة قد تُعدَّل حتى تُغلق (MT5 history revision)
        await ctx.db.patch(existing._id, {
          open,
          high,
          low,
          close,
          tickVolume: tickVolume !== undefined ? tickVolume : existing.tickVolume,
          spread: spreadVal !== undefined ? spreadVal : existing.spread,
          realVolume: realVolume !== undefined ? realVolume : existing.realVolume,
          capturedAt: now,
          syncRunId: runId,
        });
        await ctx.db.insert("auditEvents", {
          userId,
          action: "mt5_candle_ohlc_revision",
          entity: "mt5Candles",
          entityId: `${symbol}/${timeframe}/${timeMs}`,
          message: `تعديل OHLC تاريخي للشمعة ${symbol}/${timeframe}@${timeMs} — مراجعة بيانات MT5`,
          createdAt: now,
          source: SOURCE_LOCAL,
          syncRunId: runId,
        });
        patchedRevisions += 1;
        continue;
      }

      // Case (a): new candle — insert
      await ctx.db.insert("mt5Candles", {
        userId,
        symbol,
        timeframe,
        time: timeMs,
        open,
        high,
        low,
        close,
        tickVolume,
        spread: spreadVal !== undefined ? Math.floor(spreadVal) : undefined,
        realVolume,
        source: SOURCE_LOCAL,
        syncRunId: runId,
        capturedAt: now,
      });
      inserted += 1;
    }

    if (isFinalChunk(args.chunkIndex, args.totalChunks)) {
      await enforceGovernanceReadOnly(ctx, userId, now);

      // One summary audit event only if there is something worth logging
      if (skippedInvalid > 0 || clockSkewAccepted > 0) {
        const skewNote = clockSkewAccepted > 0
          ? ` | توقيت الوسيط متقدم: قُبل ${clockSkewAccepted} شمعة مع فارق توقيت بحد أقصى ${Math.round(maxSkewMs / 1000)}ث`
          : "";
        const rejectNote = invalidReasons.length > 0
          ? ` | أسباب الرفض (${invalidReasons.length}): ${invalidReasons.slice(0, 5).join("; ")}` +
            (invalidReasons.length > 5 ? ` … +${invalidReasons.length - 5} more` : "")
          : "";
        const auditMsg =
          `شموع OHLCV — جديد: ${inserted}، مكرر متجاهل: ${skippedIdentical}، ` +
          `مراجعة: ${patchedRevisions}، غير صالح: ${skippedInvalid}.` +
          skewNote + rejectNote + " قراءة فقط.";

        await ctx.db.insert("auditEvents", {
          userId,
          action: "mt5_local_readonly_candles_sync",
          entity: "mt5LocalService",
          message: auditMsg,
          createdAt: now,
          source: SOURCE_LOCAL,
          syncRunId: runId,
        });
      } else {
        // Normal path: insert a compact audit event without rejection details
        await ctx.db.insert("auditEvents", {
          userId,
          action: "mt5_local_readonly_candles_sync",
          entity: "mt5LocalService",
          message:
            `شموع OHLCV — جديد: ${inserted}، مكرر متجاهل: ${skippedIdentical}، ` +
            `مراجعة: ${patchedRevisions}. قراءة فقط.`,
          createdAt: now,
          source: SOURCE_LOCAL,
          syncRunId: runId,
        });
      }
    }

    // Compute freshness summary for the pairs seen in this batch
    const freshness = computeFreshness(latestByPair, now, maxSkewMs);

    return {
      ok: true as const,
      connected: true as const,
      inserted: {
        candles: inserted,
        skippedIdentical,
        patchedRevisions,
        skippedInvalid,
        syncRunId: runId,
      },
      dataQuality: {
        totalReceived: args.candles.length,
        totalValid: args.candles.length - skippedInvalid,
        skippedInvalid,
        clockSkewAccepted,
        invalidReasonsSample: invalidReasons.slice(0, 5),
      },
      freshness,
    };
  },
});

/**
 * Stage 4B: استعلام حداثة الشموع — يعيد آخر وقت شمعة لكل زوج (symbol/timeframe).
 * يستخدم فهرس by_userId_symbol_timeframe بدون collect() على الجدول كله.
 * Freshness query — returns latest candle time per (symbol, timeframe) pair using indexes.
 */
export const getLatestCandleFreshness = query({
  args: {
    symbols: v.array(v.string()),
    timeframes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireIdentifiedUser(identity);
    const now = Date.now();

    const latestByPair: Record<string, number> = {};

    for (const symbol of args.symbols) {
      for (const timeframe of args.timeframes) {
        // Use index to get only the latest candle for this (userId, symbol, timeframe) — no full scan
        const latest = await ctx.db
          .query("mt5Candles")
          .withIndex("by_userId_symbol_timeframe", (q) =>
            q.eq("userId", userId).eq("symbol", symbol).eq("timeframe", timeframe),
          )
          .order("desc")
          .first();

        if (latest) {
          latestByPair[`${symbol}/${timeframe}`] = latest.time;
        }
      }
    }

    // Reuse shared freshness computation — no skew context from a query, pass 0
    const freshness = computeFreshness(latestByPair, now, 0);

    return {
      ok: true as const,
      checkedAt: now,
      ...freshness,
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
