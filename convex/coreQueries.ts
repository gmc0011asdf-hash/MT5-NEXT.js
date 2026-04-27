import { query } from "./_generated/server";

async function requireUserId(ctx: { auth: { getUserIdentity: () => Promise<unknown> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity !== "object" || !("subject" in identity)) {
    return null;
  }
  const subject = (identity as { subject: string }).subject;
  return subject ?? null;
}

export const getMyLatestAccountSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("mt5AccountSnapshots")
      .withIndex("by_userId_capturedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
  },
});

export const getLatestMarketTicks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("mt5MarketTicks")
      .withIndex("by_capturedAt")
      .order("desc")
      .take(12);
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

export const getMyOpenPositions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("mt5OpenPositions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 20);
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
