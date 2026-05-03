/**
 * convex/decisionJournal.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Decision Journal — Read-only Queries (A10)
 *
 * ⚠️ قواعد هذا الملف:
 *  • queries فقط — لا mutations، لا insert، لا update، لا delete.
 *  • userId يُستخرج دائماً من ctx.auth — لا يُمرَّر من الواجهة أبداً.
 *  • كل query مقيّدة بـ userId للمستخدم الحالي فقط (Multi-Tenant).
 *  • لا تنفيذ تداول — ملف قراءة بحتة.
 *  • لا أسرار، لا مفاتيح API.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";

const AUTH_MSG = "يجب تسجيل الدخول لعرض سجل القرارات";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ─── Helper ───────────────────────────────────────────────────────────────────

async function requireUserId(
  ctx: { auth: { getUserIdentity: () => Promise<unknown> } },
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity !== "object" || !("subject" in identity)) {
    throw new ConvexError(AUTH_MSG);
  }
  const subject = (identity as { subject: string }).subject;
  if (!subject) throw new ConvexError(AUTH_MSG);
  return subject;
}

function clampLimit(limit: number | undefined): number {
  const n = limit ?? DEFAULT_LIMIT;
  return Math.min(Math.max(1, n), MAX_LIMIT);
}

// ─── listMyDecisions ──────────────────────────────────────────────────────────

export const listMyDecisions = query({
  args: {
    limit:    v.optional(v.number()),
    status:   v.optional(v.string()),
    platform: v.optional(v.string()),
    symbol:   v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = clampLimit(args.limit);

    if (args.status !== undefined) {
      const status = args.status;
      return ctx.db
        .query("decisionRuns")
        .withIndex("by_userId_status", (q) =>
          q.eq("userId", userId).eq("status", status),
        )
        .order("desc")
        .take(limit);
    }

    if (args.platform !== undefined) {
      const platform = args.platform;
      return ctx.db
        .query("decisionRuns")
        .withIndex("by_userId_platform", (q) =>
          q.eq("userId", userId).eq("platform", platform),
        )
        .order("desc")
        .take(limit);
    }

    if (args.symbol !== undefined) {
      const symbol = args.symbol;
      return ctx.db
        .query("decisionRuns")
        .withIndex("by_userId_symbol", (q) =>
          q.eq("userId", userId).eq("symbol", symbol),
        )
        .order("desc")
        .take(limit);
    }

    return ctx.db
      .query("decisionRuns")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

// ─── getDecisionById ──────────────────────────────────────────────────────────

export const getDecisionById = query({
  args: {
    decisionId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db
      .query("decisionRuns")
      .withIndex("by_decisionId", (q) => q.eq("decisionId", args.decisionId))
      .first();
    if (!row || row.userId !== userId) return null;
    return row;
  },
});

// ─── listCommitteesByDecision ─────────────────────────────────────────────────

export const listCommitteesByDecision = query({
  args: {
    decisionId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("committeeResults")
      .withIndex("by_decisionId", (q) => q.eq("decisionId", args.decisionId))
      .collect();
    return rows.filter((r) => r.userId === userId);
  },
});

// ─── getRiskSnapshotByDecision ────────────────────────────────────────────────

export const getRiskSnapshotByDecision = query({
  args: {
    decisionId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("decisionRiskSnapshots")
      .withIndex("by_decisionId", (q) => q.eq("decisionId", args.decisionId))
      .collect();
    return rows.find((r) => r.userId === userId) ?? null;
  },
});

// ─── getReviewScheduleByDecision ──────────────────────────────────────────────

export const getReviewScheduleByDecision = query({
  args: {
    decisionId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("decisionReviewSchedules")
      .withIndex("by_decisionId", (q) => q.eq("decisionId", args.decisionId))
      .collect();
    return rows.find((r) => r.userId === userId) ?? null;
  },
});

// ─── listAuditEventsByDecision ────────────────────────────────────────────────

export const listAuditEventsByDecision = query({
  args: {
    decisionId: v.string(),
    limit:      v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = clampLimit(args.limit);
    const rows = await ctx.db
      .query("decisionAuditEvents")
      .withIndex("by_decisionId", (q) => q.eq("decisionId", args.decisionId))
      .order("desc")
      .collect();
    return rows.filter((r) => r.userId === userId).slice(0, limit);
  },
});
