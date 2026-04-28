import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

export const SOURCE_MT5_LOCAL = "mt5-local-readonly" as const;
export const SOURCE_MT5_LOCAL_CATALOG = "mt5-local-catalog" as const;
export const SOURCE_MT5_MARKET_WATCH_VISIBLE = "mt5-market-watch-visible" as const;

async function requireUserId(ctx: { auth: { getUserIdentity: () => Promise<unknown> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity !== "object" || !("subject" in identity)) {
    return null;
  }
  const subject = (identity as { subject: string }).subject;
  return subject ?? null;
}

function pickLatestAccountSnapshot(
  rows: Doc<"mt5AccountSnapshots">[],
): Doc<"mt5AccountSnapshots"> | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.capturedAt - a.capturedAt);
  const local = sorted.find((r) => r.source === SOURCE_MT5_LOCAL);
  return local ?? sorted[0] ?? null;
}

function resolveLocalOpenPositions(
  rows: Doc<"mt5OpenPositions">[],
): Doc<"mt5OpenPositions">[] {
  const locals = rows.filter((r) => r.source === SOURCE_MT5_LOCAL);
  if (locals.length === 0) {
    return [...rows].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 10);
  }

  const withRun = locals.filter((r) => r.syncRunId);
  if (withRun.length > 0) {
    const sorted = [...withRun].sort((a, b) => b.capturedAt - a.capturedAt);
    const newest = sorted[0];
    const rid = newest.syncRunId;
    if (rid) {
      return locals.filter((r) => r.syncRunId === rid);
    }
  }

  const maxCap = Math.max(...locals.map((r) => r.capturedAt));
  const batch = locals.filter((r) => r.capturedAt === maxCap);
  if (batch.length > 0) return batch;

  return [...locals].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 20);
}

export const getMyLatestAccountSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return null;
    const rows = await ctx.db
      .query("mt5AccountSnapshots")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return pickLatestAccountSnapshot(rows);
  },
});

export const getMyLatestRealMt5AccountSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return null;
    const rows = await ctx.db
      .query("mt5AccountSnapshots")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const locals = rows.filter((r) => r.source === SOURCE_MT5_LOCAL);
    if (locals.length === 0) return null;
    return [...locals].sort((a, b) => b.capturedAt - a.capturedAt)[0] ?? null;
  },
});

export const getLatestMarketTicks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query("mt5MarketTicks")
      .withIndex("by_capturedAt")
      .order("desc")
      .take(500);

    const localBySymbol = new Map<string, Doc<"mt5MarketTicks">>();
    const otherBySymbol = new Map<string, Doc<"mt5MarketTicks">>();

    for (const r of rows) {
      if (r.source === SOURCE_MT5_LOCAL) {
        const prev = localBySymbol.get(r.symbol);
        if (!prev || r.capturedAt > prev.capturedAt) localBySymbol.set(r.symbol, r);
      } else {
        const prev = otherBySymbol.get(r.symbol);
        if (!prev || r.capturedAt > prev.capturedAt) otherBySymbol.set(r.symbol, r);
      }
    }

    const symbols = new Set<string>([...localBySymbol.keys(), ...otherBySymbol.keys()]);
    const merged: Doc<"mt5MarketTicks">[] = [];
    for (const sym of symbols) {
      const loc = localBySymbol.get(sym);
      const oth = otherBySymbol.get(sym);
      merged.push(loc ?? oth!);
    }

    merged.sort((a, b) => b.capturedAt - a.capturedAt);
    return merged.slice(0, 12);
  },
});

export const getLatestRealMt5MarketTicks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("mt5MarketTicks")
      .withIndex("by_capturedAt")
      .order("desc")
      .take(1000);
    const locals = rows.filter((r) => r.source === SOURCE_MT5_LOCAL);
    const bySymbol = new Map<string, Doc<"mt5MarketTicks">>();
    for (const row of locals) {
      if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
    }
    return [...bySymbol.values()].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 12);
  },
});

export const getMyLatestSignals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("labSignalSnapshots")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(8);
  },
});

export const getMyLatestRealSignals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("labSignalSnapshots")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return rows.filter((r) => r.source === SOURCE_MT5_LOCAL).slice(0, 20);
  },
});

export const getMySignalReportSnapshots = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("labSignalSnapshots")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const getMyOpenPositions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("mt5OpenPositions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return resolveLocalOpenPositions(rows);
  },
});

export const getMyMt5ReadOnlySummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return null;

    const gov = await ctx.db
      .query("governanceState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const snapshots = await ctx.db
      .query("mt5AccountSnapshots")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const localSnapshots = snapshots.filter((s) => s.source === SOURCE_MT5_LOCAL);
    const latestAccountSnapshot =
      localSnapshots.length > 0
        ? [...localSnapshots].sort((a, b) => b.capturedAt - a.capturedAt)[0]
        : null;

    const posRows = await ctx.db
      .query("mt5OpenPositions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const resolvedPositions = resolveLocalOpenPositions(posRows);

    const openPositionsCount = resolvedPositions.length;
    const totalFloatingProfit = resolvedPositions.reduce((sum, p) => sum + p.profit, 0);

    const monitoringRows = await ctx.db
      .query("monitoringStatus")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const mt5Rows = monitoringRows
      .filter((m) => m.service === "mt5-local-readonly")
      .sort((a, b) => b.checkedAt - a.checkedAt);
    const mt5Monitoring = mt5Rows[0] ?? null;

    const hasRealMt5LocalData =
      localSnapshots.length > 0 || posRows.some((p) => p.source === SOURCE_MT5_LOCAL);

    const positionsCapturedMax =
      resolvedPositions.length === 0
        ? 0
        : Math.max(...resolvedPositions.map((p) => p.capturedAt));

    const lastSyncAt = Math.max(
      latestAccountSnapshot?.capturedAt ?? 0,
      mt5Monitoring?.checkedAt ?? 0,
      positionsCapturedMax,
      0,
    );

    return {
      latestAccountSnapshot,
      lastSyncAt: lastSyncAt > 0 ? lastSyncAt : null,
      source: hasRealMt5LocalData ? SOURCE_MT5_LOCAL : null,
      openPositionsCount,
      totalFloatingProfit,
      mt5Monitoring,
      governance: gov,
      readOnly: gov?.readOnly ?? null,
      tradingEnabled: gov?.tradingEnabled ?? null,
      hasRealMt5LocalData,
    };
  },
});

export const getMyProtectionEvents = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("protectionEvents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 15);
  },
});

export const getMyGovernanceState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("governanceState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const getMyCommitteeReports = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("committeeReports")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  },
});

export const getMyMonitoringStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("monitoringStatus")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.checkedAt - a.checkedAt);
  },
});

export const getMyAuditEvents = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("auditEvents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
  },
});

/** كتالوج الأزواج المتزامن محلياً مع إعدادات العرض الحالية للمستخدم. */
export const getMyMt5SymbolsWithSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];

    const [visibleRows, legacyRows] = await Promise.all([
      ctx.db
        .query("mt5Symbols")
        .withIndex("by_source_capturedAt", (q) => q.eq("source", SOURCE_MT5_MARKET_WATCH_VISIBLE))
        .order("desc")
        .take(25_000),
      ctx.db
        .query("mt5Symbols")
        .withIndex("by_source_capturedAt", (q) => q.eq("source", SOURCE_MT5_LOCAL_CATALOG))
        .order("desc")
        .take(25_000),
    ]);
    const catalogRows = [...visibleRows, ...legacyRows].filter(
      (row) => row.selectedInMarketWatch === true || row.source === SOURCE_MT5_MARKET_WATCH_VISIBLE,
    );

    const latestByName = new Map<string, Doc<"mt5Symbols">>();
    for (const row of catalogRows) {
      if (!latestByName.has(row.name)) {
        latestByName.set(row.name, row);
      }
    }

    const settingsRows = await ctx.db
      .query("userSymbolSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const settingsBySymbol = new Map(settingsRows.map((s) => [s.symbol, s]));

    const names = [...latestByName.keys()].sort((a, b) => a.localeCompare(b));

    return names.map((name) => {
      const catalog = latestByName.get(name)!;
      const st = settingsBySymbol.get(name);
      return {
        ...catalog,
        enabled: st?.enabled ?? false,
        showInLab: st?.showInLab ?? false,
      };
    });
  },
});

/** أزواج المختبر: مفعّلة + عرض في المختبر. */
export const getMyEnabledLabSymbols = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("userSymbolSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const [visibleRows, legacyRows] = await Promise.all([
      ctx.db
        .query("mt5Symbols")
        .withIndex("by_source_capturedAt", (q) => q.eq("source", SOURCE_MT5_MARKET_WATCH_VISIBLE))
        .order("desc")
        .take(25_000),
      ctx.db
        .query("mt5Symbols")
        .withIndex("by_source_capturedAt", (q) => q.eq("source", SOURCE_MT5_LOCAL_CATALOG))
        .order("desc")
        .take(25_000),
    ]);
    const visibleNames = new Set(
      [...visibleRows, ...legacyRows]
        .filter((r) => r.selectedInMarketWatch === true || r.source === SOURCE_MT5_MARKET_WATCH_VISIBLE)
        .map((r) => r.name),
    );
    return rows
      .filter((r) => r.enabled && r.showInLab && visibleNames.has(r.symbol))
      .map((r) => r.symbol)
      .sort((a, b) => a.localeCompare(b));
  },
});

/** المراكز النشطة من MT5 المحلي للقراءة فقط — أحدث دفعة فقط. */
export const getMyActiveMt5Positions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("mt5OpenPositions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const locals = rows.filter((r) => r.source === SOURCE_MT5_LOCAL);
    return resolveLocalOpenPositions(locals);
  },
});

/** سجل صفقات MT5 (قراءة فقط) — آخر 100 حدثاً. */
export const getMyTradeHistoryDeals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("mt5TradeHistoryDeals")
      .withIndex("by_userId_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(250);
    return rows.filter((r) => r.source === SOURCE_MT5_LOCAL).slice(0, 100);
  },
});
