/**
 * crons.ts — Fix-2 (محدَّث: تقليل فترات الاحتفاظ لتناسب الخطة المجانية)
 *
 * فترات الاحتفاظ المُحسَّنة للخطة المجانية:
 *   mt5MarketTicks           → 2 ساعة  (كانت 48 ساعة)
 *   mt5Candles               → 7 أيام   (كانت 60 يوم)
 *   mt5AccountSnapshots      → 7 أيام   (كانت 30 يوم)
 *   auditEvents              → 7 أيام   (كانت 30 يوم)
 *   technicalIndicatorSnaps  → 1 يوم    (كانت 7 أيام)
 *   newsEvents               → 14 يوم   (كانت 90 يوم)
 *   goldAnalysisSnapshots    → 30 يوم   (جديد)
 *   demoExecutionAttempts    → 30 يوم   (جديد)
 *   mt5TradeHistoryDeals     → 90 يوم   (جديد)
 *   mt5OpenPositions         → 7 أيام   (جديد)
 *   labSignalSnapshots       → 30 يوم   (جديد)
 *   committeeReports         → 30 يوم   (جديد)
 *
 * للترقية: عدّل ثوابت _KEEP_MS فقط — لا تغيير في منطق الكود.
 * لا تنفيذ تداول — قراءة/حذف فقط.
 */

import { cronJobs } from "convex/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const BATCH_SIZE = 200;
const HOUR_MS    = 60 * 60 * 1000;
const DAY_MS     = 24 * HOUR_MS;

// ── فترات الاحتفاظ — عدّل هنا فقط عند الترقية ──────────────────────────────
const TICKS_KEEP_MS          = 2   * HOUR_MS;   // ↑ إلى 48h عند الترقية
const CANDLES_KEEP_MS        = 7   * DAY_MS;    // ↑ إلى 60d عند الترقية
const SNAPSHOTS_KEEP_MS      = 7   * DAY_MS;    // ↑ إلى 30d عند الترقية
const AUDIT_KEEP_MS          = 7   * DAY_MS;    // ↑ إلى 30d عند الترقية
const INDICATORS_KEEP_MS     = 1   * DAY_MS;    // ↑ إلى 7d عند الترقية
const NEWS_KEEP_MS           = 14  * DAY_MS;    // ↑ إلى 90d عند الترقية
const GOLD_ANALYSIS_KEEP_MS  = 30  * DAY_MS;
const DEMO_EXEC_KEEP_MS      = 30  * DAY_MS;
const HISTORY_DEALS_KEEP_MS  = 90  * DAY_MS;
const POSITIONS_KEEP_MS      = 7   * DAY_MS;
const LAB_SIGNALS_KEEP_MS    = 30  * DAY_MS;
const COMMITTEE_KEEP_MS      = 30  * DAY_MS;

// ─── helper مشترك ────────────────────────────────────────────────────────────

async function batchDelete<T extends { _id: string; [k: string]: unknown }>(
  docs: T[],
  cutoff: number,
  timeField: keyof T,
  ctx: { db: { delete: (id: string) => Promise<void> }; scheduler: { runAfter: (ms: number, fn: unknown, args: unknown) => Promise<void> } },
  reschedule: () => Promise<void>,
): Promise<number> {
  let deleted = 0;
  for (const doc of docs) {
    if ((doc[timeField] as number) < cutoff) {
      await ctx.db.delete(doc._id as string);
      deleted++;
    } else {
      break;
    }
  }
  if (deleted === BATCH_SIZE) await reschedule();
  return deleted;
}

// ─── mt5MarketTicks ───────────────────────────────────────────────────────────

export const cleanupMarketTicks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TICKS_KEEP_MS;
    const batch = await ctx.db
      .query("mt5MarketTicks")
      .withIndex("by_capturedAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.capturedAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupMarketTicks, {});
    return { deleted };
  },
});

// ─── mt5Candles ──────────────────────────────────────────────────────────────

export const cleanupCandles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - CANDLES_KEEP_MS;
    const batch = await ctx.db.query("mt5Candles").order("asc").take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc._creationTime < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupCandles, {});
    return { deleted };
  },
});

// ─── mt5AccountSnapshots ─────────────────────────────────────────────────────

export const cleanupAccountSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SNAPSHOTS_KEEP_MS;
    const batch = await ctx.db
      .query("mt5AccountSnapshots")
      .withIndex("by_capturedAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.capturedAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupAccountSnapshots, {});
    return { deleted };
  },
});

// ─── auditEvents ─────────────────────────────────────────────────────────────

export const cleanupAuditEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - AUDIT_KEEP_MS;
    const batch = await ctx.db
      .query("auditEvents")
      .withIndex("by_createdAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.createdAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupAuditEvents, {});
    return { deleted };
  },
});

// ─── technicalIndicatorSnapshots ─────────────────────────────────────────────

export const cleanupIndicatorSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - INDICATORS_KEEP_MS;
    const batch = await ctx.db
      .query("technicalIndicatorSnapshots")
      .withIndex("by_createdAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.createdAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupIndicatorSnapshots, {});
    return { deleted };
  },
});

// ─── newsEvents ───────────────────────────────────────────────────────────────

export const cleanupNewsEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NEWS_KEEP_MS;
    const batch = await ctx.db
      .query("newsEvents")
      .withIndex("by_publishedAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.publishedAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupNewsEvents, {});
    return { deleted };
  },
});

// ─── goldAnalysisSnapshots — جديد ────────────────────────────────────────────

export const cleanupGoldAnalysis = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - GOLD_ANALYSIS_KEEP_MS;
    const batch = await ctx.db
      .query("goldAnalysisSnapshots")
      .withIndex("by_userId_createdAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.createdAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupGoldAnalysis, {});
    return { deleted };
  },
});

// ─── demoExecutionAttempts — جديد ────────────────────────────────────────────

export const cleanupDemoExecutions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DEMO_EXEC_KEEP_MS;
    const batch = await ctx.db
      .query("demoExecutionAttempts")
      .withIndex("by_user_createdAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.createdAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupDemoExecutions, {});
    return { deleted };
  },
});

// ─── mt5TradeHistoryDeals — جديد ─────────────────────────────────────────────

export const cleanupTradeHistory = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - HISTORY_DEALS_KEEP_MS;
    const batch = await ctx.db
      .query("mt5TradeHistoryDeals")
      .withIndex("by_time")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.time < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupTradeHistory, {});
    return { deleted };
  },
});

// ─── mt5OpenPositions — جديد ─────────────────────────────────────────────────

export const cleanupOpenPositions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - POSITIONS_KEEP_MS;
    const batch = await ctx.db
      .query("mt5OpenPositions")
      .withIndex("by_capturedAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.capturedAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupOpenPositions, {});
    return { deleted };
  },
});

// ─── labSignalSnapshots — جديد ───────────────────────────────────────────────

export const cleanupLabSignals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - LAB_SIGNALS_KEEP_MS;
    const batch = await ctx.db
      .query("labSignalSnapshots")
      .withIndex("by_createdAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.createdAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupLabSignals, {});
    return { deleted };
  },
});

// ─── committeeReports — جديد ─────────────────────────────────────────────────

export const cleanupCommitteeReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - COMMITTEE_KEEP_MS;
    const batch = await ctx.db
      .query("committeeReports")
      .withIndex("by_createdAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.createdAt < cutoff) { await ctx.db.delete(doc._id); deleted++; }
      else break;
    }
    if (deleted === BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.crons.cleanupCommitteeReports, {});
    return { deleted };
  },
});

// ─── purgeAllHighChurnData — تشغيل يدوي من Dashboard لتفريغ فوري ─────────────
// شغّل هذه الدالة مرة واحدة من Convex Dashboard → Functions → Run
// تحذف كل بيانات الجداول كثيرة الحركة — لا تمس الاستراتيجيات أو القرارات.

export const purgeAllHighChurnData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "mt5MarketTicks",
      "mt5Candles",
      "mt5AccountSnapshots",
      "auditEvents",
      "technicalIndicatorSnapshots",
      "newsEvents",
      "goldAnalysisSnapshots",
      "demoExecutionAttempts",
      "mt5TradeHistoryDeals",
      "mt5OpenPositions",
      "labSignalSnapshots",
      "committeeReports",
      "protectionEvents",
      "monitoringStatus",
      "mt5Symbols",
      "testEvents",
    ] as const;

    const summary: Record<string, number> = {};

    for (const table of tables) {
      let count = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await (ctx.db.query(table) as any).take(500);
        if (batch.length === 0) break;
        for (const doc of batch) {
          await ctx.db.delete(doc._id);
          count++;
        }
        if (batch.length < 500) break;
      }
      summary[table] = count;
    }

    return summary;
  },
});

// ─── Cron schedule ────────────────────────────────────────────────────────────

const crons = cronJobs();

// Market ticks — high churn, clean every 30 min (كانت كل ساعة)
crons.interval(
  "cleanup market ticks",
  { minutes: 30 },
  internal.crons.cleanupMarketTicks,
  {},
);

// Candle history — run at 03:00 UTC
crons.cron("cleanup candles",           "0 3 * * *",  internal.crons.cleanupCandles,           {});
crons.cron("cleanup account snapshots", "30 3 * * *", internal.crons.cleanupAccountSnapshots,  {});
crons.cron("cleanup audit events",      "0 4 * * *",  internal.crons.cleanupAuditEvents,       {});
crons.cron("cleanup indicator snaps",   "30 4 * * *", internal.crons.cleanupIndicatorSnapshots,{});
crons.cron("cleanup news events",       "0 5 * * *",  internal.crons.cleanupNewsEvents,        {});
crons.cron("cleanup gold analysis",     "30 5 * * *", internal.crons.cleanupGoldAnalysis,      {});
crons.cron("cleanup demo executions",   "0 6 * * *",  internal.crons.cleanupDemoExecutions,    {});
crons.cron("cleanup trade history",     "30 6 * * *", internal.crons.cleanupTradeHistory,      {});
crons.cron("cleanup open positions",    "0 7 * * *",  internal.crons.cleanupOpenPositions,     {});
crons.cron("cleanup lab signals",       "30 7 * * *", internal.crons.cleanupLabSignals,        {});
crons.cron("cleanup committee reports", "0 8 * * *",  internal.crons.cleanupCommitteeReports,  {});

export default crons;
