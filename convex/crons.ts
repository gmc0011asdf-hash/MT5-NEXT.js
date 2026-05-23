/**
 * crons.ts — Fix-2
 * Scheduled cleanup jobs to prevent unbounded table growth.
 * All deletions are batched (BATCH_SIZE rows per transaction).
 * If more rows remain, the job reschedules itself immediately.
 * No trading execution — read/delete only.
 */

import { cronJobs } from "convex/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const BATCH_SIZE = 200;
const HOUR_MS    = 60 * 60 * 1000;
const DAY_MS     = 24 * HOUR_MS;

// ─── mt5MarketTicks — global, high-churn ─────────────────────────────────────
// Keeps last 48 h. Runs every hour.

export const cleanupMarketTicks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 48 * HOUR_MS;
    const batch = await ctx.db
      .query("mt5MarketTicks")
      .withIndex("by_capturedAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.capturedAt < cutoff) {
        await ctx.db.delete(doc._id);
        deleted++;
      } else {
        break; // index sorted asc — no older docs remain
      }
    }
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupMarketTicks, {});
    }
    return { deleted };
  },
});

// ─── mt5Candles — per user, grows with every sync ────────────────────────────
// Keeps last 60 days. Runs daily at 03:00 UTC.
// Uses default _creationTime ascending order (no capturedAt index on this table).

export const cleanupCandles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 60 * DAY_MS;
    const batch = await ctx.db
      .query("mt5Candles")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc._creationTime < cutoff) {
        await ctx.db.delete(doc._id);
        deleted++;
      } else {
        break;
      }
    }
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupCandles, {});
    }
    return { deleted };
  },
});

// ─── mt5AccountSnapshots — per user ──────────────────────────────────────────
// Keeps last 30 days. Runs daily at 03:00 UTC.

export const cleanupAccountSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * DAY_MS;
    const batch = await ctx.db
      .query("mt5AccountSnapshots")
      .withIndex("by_capturedAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.capturedAt < cutoff) {
        await ctx.db.delete(doc._id);
        deleted++;
      } else {
        break;
      }
    }
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupAccountSnapshots, {});
    }
    return { deleted };
  },
});

// ─── auditEvents — per user, every action creates an entry ───────────────────
// Keeps last 30 days. Runs daily at 04:00 UTC.

export const cleanupAuditEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * DAY_MS;
    const batch = await ctx.db
      .query("auditEvents")
      .withIndex("by_createdAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.createdAt < cutoff) {
        await ctx.db.delete(doc._id);
        deleted++;
      } else {
        break;
      }
    }
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupAuditEvents, {});
    }
    return { deleted };
  },
});

// ─── technicalIndicatorSnapshots — per user, per analysis run ────────────────
// Keeps last 7 days. Runs daily at 04:00 UTC.

export const cleanupIndicatorSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 7 * DAY_MS;
    const batch = await ctx.db
      .query("technicalIndicatorSnapshots")
      .withIndex("by_createdAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.createdAt < cutoff) {
        await ctx.db.delete(doc._id);
        deleted++;
      } else {
        break;
      }
    }
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupIndicatorSnapshots, {});
    }
    return { deleted };
  },
});

// ─── newsEvents — global, grows with every news fetch ────────────────────────
// Keeps last 90 days. Runs daily at 05:00 UTC.

export const cleanupNewsEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 90 * DAY_MS;
    const batch = await ctx.db
      .query("newsEvents")
      .withIndex("by_publishedAt")
      .order("asc")
      .take(BATCH_SIZE);
    let deleted = 0;
    for (const doc of batch) {
      if (doc.publishedAt < cutoff) {
        await ctx.db.delete(doc._id);
        deleted++;
      } else {
        break;
      }
    }
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupNewsEvents, {});
    }
    return { deleted };
  },
});

// ─── Cron schedule ────────────────────────────────────────────────────────────

const crons = cronJobs();

// Market ticks — high churn, clean every hour
crons.interval(
  "cleanup market ticks",
  { hours: 1 },
  internal.crons.cleanupMarketTicks,
  {},
);

// Candle history — keep 60 days, run at 03:00 UTC
crons.cron(
  "cleanup candles",
  "0 3 * * *",
  internal.crons.cleanupCandles,
  {},
);

// Account snapshots — keep 30 days, run at 03:30 UTC
crons.cron(
  "cleanup account snapshots",
  "30 3 * * *",
  internal.crons.cleanupAccountSnapshots,
  {},
);

// Audit events — keep 30 days, run at 04:00 UTC
crons.cron(
  "cleanup audit events",
  "0 4 * * *",
  internal.crons.cleanupAuditEvents,
  {},
);

// Indicator snapshots — keep 7 days, run at 04:30 UTC
crons.cron(
  "cleanup indicator snapshots",
  "30 4 * * *",
  internal.crons.cleanupIndicatorSnapshots,
  {},
);

// News events — keep 90 days, run at 05:00 UTC
crons.cron(
  "cleanup news events",
  "0 5 * * *",
  internal.crons.cleanupNewsEvents,
  {},
);

export default crons;
