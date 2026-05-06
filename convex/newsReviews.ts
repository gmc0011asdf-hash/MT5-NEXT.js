/**
 * newsReviews.ts — B6.1.1
 * Human review and translation layer for Finnhub news.
 * لا order_send — لا تنفيذ تداول — مراجعة بشرية فقط.
 *
 * Translation: manual only — no external API key stored.
 * Future: OPENAI_API_KEY or Google Translate can be added later
 *         via process.env.OPENAI_API_KEY without changing this contract.
 */

import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireUserId(ctx: MutationCtx | QueryCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("غير مصرح — يرجى تسجيل الدخول");
  return identity.subject;
}

// ─── Impact hierarchy ─────────────────────────────────────────────────────────

const IMPACT_RANK: Record<string, number> = {
  NONE:   0,
  LOW:    1,
  MEDIUM: 2,
  HIGH:   3,
  BLOCK:  4,
};

function higherImpact(a: string, b: string): string {
  return (IMPACT_RANK[a] ?? 0) >= (IMPACT_RANK[b] ?? 0) ? a : b;
}

function impactToDecision(impact: string): string {
  if (impact === "BLOCK")  return "BLOCK_REVIEW";
  if (impact === "HIGH")   return "WARN";
  if (impact === "MEDIUM") return "WATCH";
  return "PASS"; // LOW or NONE
}

function mergeSymbols(auto: string[], user: string[] | undefined): string[] {
  if (!user || user.length === 0) return [...new Set(auto)];
  return [...new Set([...auto, ...user])];
}

// ─── Query: list news with optional user review ───────────────────────────────

export const listNewsWithReviews = query({
  args: {
    limit:    v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit  = Math.min(args.limit ?? 20, 50);

    // Fetch latest news events
    let news;
    if (args.category) {
      news = await ctx.db
        .query("newsEvents")
        .withIndex("by_category_publishedAt", (q) => q.eq("category", args.category!))
        .order("desc")
        .take(limit);
    } else {
      news = await ctx.db
        .query("newsEvents")
        .withIndex("by_publishedAt")
        .order("desc")
        .take(limit);
    }

    // Attach existing review for this user (one review per user per news item)
    const withReviews = await Promise.all(
      news.map(async (item) => {
        const review = await ctx.db
          .query("newsReviews")
          .withIndex("by_news_user", (q) =>
            q.eq("newsEventId", item._id).eq("userId", userId),
          )
          .first();
        return { ...item, review: review ?? null };
      }),
    );

    return withReviews;
  },
});

// ─── Mutation: upsert news review ─────────────────────────────────────────────

export const upsertNewsReview = mutation({
  args: {
    newsEventId:                  v.id("newsEvents"),
    translatedHeadline:           v.optional(v.string()),
    translatedSummary:            v.optional(v.string()),
    userImpactOverride:           v.optional(v.string()),
    userAffectedSymbolsOverride:  v.optional(v.array(v.string())),
    relationshipType:             v.optional(v.string()),
    userDirectionBias:            v.optional(v.string()),
    userConfidence:               v.optional(v.number()),
    userNote:                     v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    // Fetch the original news event to get autoImpact and affectedSymbols
    const newsEvent = await ctx.db.get(args.newsEventId);
    if (!newsEvent) throw new Error("الخبر غير موجود");

    // Compute finalImpact = max(auto, user override)
    const autoImpact = newsEvent.impact ?? "LOW";
    const finalImpact = args.userImpactOverride
      ? higherImpact(autoImpact, args.userImpactOverride)
      : autoImpact;

    // Compute finalAffectedSymbols = merge auto + user
    const finalAffectedSymbols = mergeSymbols(
      newsEvent.affectedSymbols,
      args.userAffectedSymbolsOverride,
    );

    // Compute finalDecision
    const finalDecision = impactToDecision(finalImpact);

    const now = Date.now();

    // Check for existing review
    const existing = await ctx.db
      .query("newsReviews")
      .withIndex("by_news_user", (q) =>
        q.eq("newsEventId", args.newsEventId).eq("userId", userId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        translatedHeadline:          args.translatedHeadline,
        translatedSummary:           args.translatedSummary,
        userImpactOverride:          args.userImpactOverride,
        userAffectedSymbolsOverride: args.userAffectedSymbolsOverride,
        relationshipType:            args.relationshipType,
        userDirectionBias:           args.userDirectionBias,
        userConfidence:              args.userConfidence,
        userNote:                    args.userNote,
        finalImpact,
        finalAffectedSymbols,
        finalDecision,
        reviewedAt: now,
        updatedAt:  now,
      });
      return { id: existing._id, updated: true };
    }

    const id = await ctx.db.insert("newsReviews", {
      newsEventId:                 args.newsEventId,
      userId,
      translatedHeadline:          args.translatedHeadline,
      translatedSummary:           args.translatedSummary,
      userImpactOverride:          args.userImpactOverride,
      userAffectedSymbolsOverride: args.userAffectedSymbolsOverride,
      relationshipType:            args.relationshipType,
      userDirectionBias:           args.userDirectionBias,
      userConfidence:              args.userConfidence,
      userNote:                    args.userNote,
      finalImpact,
      finalAffectedSymbols,
      finalDecision,
      reviewedAt: now,
      createdAt:  now,
      updatedAt:  now,
    });
    return { id, updated: false };
  },
});

// ─── Query: get reviewed news for B6.2 (future use) ──────────────────────────

export const listHighImpactReviews = query({
  args: {
    finalDecision: v.optional(v.string()),
    limit:         v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const limit = Math.min(args.limit ?? 20, 50);

    if (args.finalDecision) {
      return await ctx.db
        .query("newsReviews")
        .withIndex("by_finalDecision", (q) => q.eq("finalDecision", args.finalDecision!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("newsReviews")
      .withIndex("by_user_reviewedAt", (q) => q.eq("userId", "")) // placeholder — use auth
      .order("desc")
      .take(limit);
  },
});

// ─── Query: get my reviews ────────────────────────────────────────────────────

export const listMyReviews = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit  = Math.min(args.limit ?? 20, 50);
    return await ctx.db
      .query("newsReviews")
      .withIndex("by_user_reviewedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});
