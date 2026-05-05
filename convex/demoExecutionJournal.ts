/**
 * demoExecutionJournal.ts — A27
 * سجل محاولات التنفيذ التجريبي لـ MT5 Demo.
 * Append-only — لا delete — لا update.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";

async function requireUserId(ctx: MutationCtx | QueryCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("غير مصرح — يرجى تسجيل الدخول");
  return identity.subject;
}

// ─── Mutation: recordDemoExecutionAttempt ─────────────────────────────────────

export const recordDemoExecutionAttempt = mutation({
  args: {
    platform:        v.string(),
    accountMode:     v.string(),
    decisionId:      v.optional(v.string()),
    symbol:          v.string(),
    orderType:       v.string(),
    direction:       v.optional(v.string()),
    requestedLot:    v.optional(v.number()),
    status:          v.string(),
    ok:              v.boolean(),
    accepted:        v.optional(v.boolean()),
    ticket:          v.optional(v.number()),
    retcode:         v.optional(v.number()),
    retcodeText:     v.optional(v.string()),
    errorMessage:    v.optional(v.string()),
    marginRequired:  v.optional(v.number()),
    marginFree:      v.optional(v.number()),
    marginFreeAfter: v.optional(v.number()),
    fillingMode:     v.optional(v.string()),
    fillingRetries:  v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await ctx.db.insert("demoExecutionAttempts", {
      userId,
      platform:        args.platform,
      accountMode:     args.accountMode,
      decisionId:      args.decisionId,
      symbol:          args.symbol,
      orderType:       args.orderType,
      direction:       args.direction,
      requestedLot:    args.requestedLot,
      status:          args.status,
      ok:              args.ok,
      accepted:        args.accepted,
      ticket:          args.ticket,
      retcode:         args.retcode,
      retcodeText:     args.retcodeText,
      errorMessage:    args.errorMessage,
      marginRequired:  args.marginRequired,
      marginFree:      args.marginFree,
      marginFreeAfter: args.marginFreeAfter,
      fillingMode:     args.fillingMode,
      fillingRetries:  args.fillingRetries,
      createdAt:       Date.now(),
    });
  },
});

// ─── Query: listMyDemoExecutionAttempts ───────────────────────────────────────

export const listMyDemoExecutionAttempts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = Math.min(args.limit ?? 20, 50);
    return await ctx.db
      .query("demoExecutionAttempts")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});
