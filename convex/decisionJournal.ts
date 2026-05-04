/**
 * convex/decisionJournal.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Decision Journal — Queries (A10) + Mutations (A13, A15)
 *
 * ⚠️ قواعد هذا الملف:
 *  • userId يُستخرج دائماً من ctx.auth — لا يُمرَّر من الواجهة أبداً.
 *  • كل query مقيّدة بـ userId للمستخدم الحالي فقط (Multi-Tenant).
 *  • ممنوع delete — ممنوع patch حر — ممنوع تنفيذ تداول.
 *  • لا order_send — لا order_close — لا order_modify.
 *  • لا أسرار، لا مفاتيح API.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ConvexError, v } from "convex/values";
import { MutationCtx, QueryCtx, mutation, query } from "./_generated/server";

const AUTH_MSG = "يجب تسجيل الدخول لعرض سجل القرارات";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ─── Helper ───────────────────────────────────────────────────────────────────

async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !identity.subject) throw new ConvexError(AUTH_MSG);
  return identity.subject;
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

// ─── createDecisionAuditEvent (A13) ──────────────────────────────────────────
// Append-only — لا delete — لا update — لا تنفيذ تداول

export const createDecisionAuditEvent = mutation({
  args: {
    decisionId:  v.string(),
    eventType:   v.union(
      v.literal("CREATED"),
      v.literal("STATUS_CHANGED"),
      v.literal("REVIEWED"),
      v.literal("EXPIRED"),
      v.literal("BLOCKED"),
      v.literal("HELD"),
      v.literal("NOTE_ADDED"),
      v.literal("SYSTEM_REVIEW"),
      v.literal("RISK_RECHECK"),
      v.literal("DATA_REFRESHED"),
    ),
    fromStatus:  v.optional(v.string()),
    toStatus:    v.optional(v.string()),
    message:     v.string(),
    triggeredBy: v.string(),
  },
  handler: async (ctx, args) => {
    // ── 1. استخراج userId من Clerk — ليس من args ──────────────────────────
    const userId = await requireUserId(ctx);

    // ── 2. التحقق من وجود القرار وملكيته ──────────────────────────────────
    const decision = await ctx.db
      .query("decisionRuns")
      .withIndex("by_decisionId", (q) => q.eq("decisionId", args.decisionId))
      .first();
    if (!decision || decision.userId !== userId) {
      throw new ConvexError("القرار غير موجود أو لا تملك صلاحية الوصول إليه");
    }

    // ── 3. Append-only insert — لا delete — لا update — لا order_send ──────
    await ctx.db.insert("decisionAuditEvents", {
      decisionId:  args.decisionId,
      userId,
      eventType:   args.eventType,
      fromStatus:  args.fromStatus,
      toStatus:    args.toStatus,
      message:     args.message,
      triggeredBy: args.triggeredBy,
      createdAt:   Date.now(),
    });
  },
});

// ─── saveAnalysisDecision (A15) ───────────────────────────────────────────────
// Pipeline كامل لحفظ قرار تحليل في 5 جداول — لا تنفيذ تداول — لا order_send
// Backend only — لا ربط بالواجهة في A15

export const saveAnalysisDecision = mutation({
  args: {
    // ── decisionRun الأساسي ─────────────────────────────────────────────────
    platform:          v.string(),
    symbol:            v.string(),
    timeframe:         v.string(),
    status:            v.string(),
    finalDecision:     v.string(),
    grade:             v.string(),
    probability:       v.number(),
    entryPrice:        v.number(),
    invalidationPrice: v.number(),
    reason:            v.string(),
    source:            v.optional(v.string()),

    // ── نتائج اللجان ────────────────────────────────────────────────────────
    committees: v.array(
      v.object({
        committeeId:   v.string(),
        committeeName: v.string(),
        verdict:       v.string(),
        score:         v.number(),
        summary:       v.string(),
        reasons:       v.array(v.string()),
      }),
    ),

    // ── لقطة المخاطرة — اختيارية ────────────────────────────────────────────
    risk: v.optional(
      v.object({
        riskUsd:         v.number(),
        riskPercent:     v.number(),
        estimatedLot:    v.number(),
        stopLoss:        v.number(),
        takeProfit1:     v.number(),
        takeProfit2:     v.optional(v.number()),
        takeProfit3:     v.optional(v.number()),
        rewardRiskRatio: v.number(),
        marginSafe:      v.boolean(),
      }),
    ),

    // ── جدول المراجعة — اختياري ─────────────────────────────────────────────
    review: v.optional(
      v.object({
        criticalTimeframe: v.string(),
        nextReviewAt:      v.number(),
        expiresAt:         v.number(),
        reviewReason:      v.string(),
        monitoringMode:    v.string(),
      }),
    ),
  },

  handler: async (ctx, args) => {
    // ── 1. Auth — userId من Clerk server-side فقط ──────────────────────────
    const userId = await requireUserId(ctx);
    const now    = Date.now();

    // ── 2. منع التكرار — نفس symbol+timeframe+finalDecision خلال 15 دقيقة ───
    const fifteenMinAgo = now - 15 * 60 * 1000;
    const recentBySymbol = await ctx.db
      .query("decisionRuns")
      .withIndex("by_userId_symbol", (q) =>
        q.eq("userId", userId).eq("symbol", args.symbol),
      )
      .order("desc")
      .take(20);
    const recentDuplicate = recentBySymbol.find(
      (r) =>
        r.timeframe === args.timeframe &&
        r.finalDecision === args.finalDecision &&
        r.createdAt >= fifteenMinAgo,
    );
    if (recentDuplicate) {
      return { decisionId: recentDuplicate.decisionId, duplicate: true };
    }

    // ── 2.5. توليد decisionId فريد داخلياً — crypto.randomUUID لـ 122-bit entropy ─
    const decisionId = `dj-${now}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

    // ── 3. حفظ decisionRun الرئيسي ─────────────────────────────────────────
    // readOnly: true دائماً — لا تنفيذ تداول — للتحليل فقط
    await ctx.db.insert("decisionRuns", {
      decisionId,
      platform:          args.platform,
      symbol:            args.symbol,
      timeframe:         args.timeframe,
      status:            args.status,
      finalDecision:     args.finalDecision,
      grade:             args.grade,
      probability:       args.probability,
      entryPrice:        args.entryPrice,
      invalidationPrice: args.invalidationPrice,
      reason:            args.reason,
      userId,
      createdAt: now,
      updatedAt: now,
      readOnly:  true,
      source:    args.source ?? "decision-journal-v1",
    });

    // ── 4. حفظ نتائج اللجان ─────────────────────────────────────────────────
    if (args.committees.length === 0) {
      throw new ConvexError("يجب أن يحتوي القرار على لجنة واحدة على الأقل");
    }
    if (args.committees.length > 20) {
      throw new ConvexError("عدد اللجان يتجاوز الحد المسموح (20 كحد أقصى)");
    }
    for (const c of args.committees) {
      await ctx.db.insert("committeeResults", {
        decisionId,
        userId,
        committeeId:   c.committeeId,
        committeeName: c.committeeName,
        verdict:       c.verdict,
        score:         c.score,
        summary:       c.summary,
        reasons:       c.reasons,
        createdAt:     now,
      });
    }

    // ── 5. حفظ لقطة المخاطرة — إن وُجدت ───────────────────────────────────
    if (args.risk) {
      await ctx.db.insert("decisionRiskSnapshots", {
        decisionId,
        userId,
        riskUsd:         args.risk.riskUsd,
        riskPercent:     args.risk.riskPercent,
        estimatedLot:    args.risk.estimatedLot,
        stopLoss:        args.risk.stopLoss,
        takeProfit1:     args.risk.takeProfit1,
        takeProfit2:     args.risk.takeProfit2,
        takeProfit3:     args.risk.takeProfit3,
        rewardRiskRatio: args.risk.rewardRiskRatio,
        marginSafe:      args.risk.marginSafe,
        createdAt:       now,
      });
    }

    // ── 6. حفظ جدول المراجعة — إن وُجد ────────────────────────────────────
    if (args.review) {
      await ctx.db.insert("decisionReviewSchedules", {
        decisionId,
        userId,
        criticalTimeframe: args.review.criticalTimeframe,
        nextReviewAt:      args.review.nextReviewAt,
        expiresAt:         args.review.expiresAt,
        reviewReason:      args.review.reviewReason,
        monitoringMode:    args.review.monitoringMode,
        createdAt:         now,
        updatedAt:         now,
      });
    }

    // ── 7. Audit event تلقائي — CREATED ────────────────────────────────────
    await ctx.db.insert("decisionAuditEvents", {
      decisionId,
      userId,
      eventType:   "CREATED",
      message:     "تم حفظ قرار التحليل في سجل القرارات",
      triggeredBy: "system",
      createdAt:   now,
    });

    // ── 8. إرجاع decisionId للمستدعي ───────────────────────────────────────
    return { decisionId, duplicate: false };
  },
});
