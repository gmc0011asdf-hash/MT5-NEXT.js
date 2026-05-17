/**
 * newsIngestion.ts — B6.1
 * Finnhub news ingestion: fetch, store, deduplicate.
 * لا order_send — لا تنفيذ تداول — قراءة أخبار فقط.
 *
 * API key: process.env.FINNHUB_API_KEY (Convex environment variable — لا تُخزَّن في الكود)
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery, query, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireAuth(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("غير مصرح — يرجى تسجيل الدخول");
  return identity.subject;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const CATEGORIES   = ["general", "crypto", "forex"] as const;

const MARKET_MAP: Record<string, string> = {
  general: "GLOBAL",
  crypto:  "CRYPTO",
  forex:   "MT5",
};

const HIGH_IMPACT_KEYWORDS = [
  "fed", "fomc", "cpi", "inflation", "interest rate", "nfp", "nonfarm",
  "jobs report", "powell", "yellen", "war", "oil", "hack", "exploit",
  "liquidation", "etf", "sec", "lawsuit", "delisting", "rate hike",
  "rate cut", "recession", "default", "bankruptcy",
];

const MEDIUM_IMPACT_KEYWORDS = [
  "bank", "gdp", "trade", "earnings", "merger", "acquisition",
  "revenue", "profit", "loss", "quarterly", "annual", "forecast",
];

// ─── Impact detection ─────────────────────────────────────────────────────────

function detectImpact(headline: string, summary: string): string {
  const text = `${headline} ${summary}`.toLowerCase();
  if (HIGH_IMPACT_KEYWORDS.some((kw) => text.includes(kw))) return "HIGH";
  if (MEDIUM_IMPACT_KEYWORDS.some((kw) => text.includes(kw))) return "MEDIUM";
  return "LOW";
}

// ─── Affected symbols detection ───────────────────────────────────────────────

function detectAffectedSymbols(category: string, headline: string, summary: string): string[] {
  const text = `${headline} ${summary}`.toLowerCase();
  const symbols: string[] = [];

  if (category === "crypto") {
    if (text.includes("btc") || text.includes("bitcoin"))    symbols.push("BTCUSDT");
    if (text.includes("eth") || text.includes("ethereum"))   symbols.push("ETHUSDT");
    if (text.includes("bnb") || text.includes("solana"))     symbols.push("CRYPTO_ALT");
    return symbols.length > 0 ? symbols : ["CRYPTO"];
  }

  if (category === "forex") {
    if (text.includes("euro") || text.includes(" eur"))      symbols.push("EURUSD");
    if (text.includes("pound") || text.includes("sterling") || text.includes("gbp")) symbols.push("GBPUSD");
    if (text.includes("gold") || text.includes("xau"))       symbols.push("XAUUSD");
    if (text.includes("yen") || text.includes("jpy"))        symbols.push("USDJPY");
    if (text.includes("franc") || text.includes("chf"))      symbols.push("USDCHF");
    if (text.includes("dollar") || text.includes("usd"))     symbols.push("USD");
    return symbols.length > 0 ? symbols : ["FOREX"];
  }

  // general
  if (text.includes("fed") || text.includes("fomc") || text.includes("dollar") || text.includes("usd")) {
    symbols.push("USD");
  }
  if (text.includes("gold") || text.includes("xau"))        symbols.push("XAUUSD");
  if (text.includes("oil") || text.includes("crude"))       symbols.push("OIL");
  if (text.includes("bitcoin") || text.includes("crypto"))  symbols.push("CRYPTO");
  if (text.includes("war") || text.includes("geopolit"))    symbols.push("GLOBAL_RISK");

  return symbols.length > 0 ? symbols : ["GLOBAL"];
}

// ─── Internal query: check duplicate ─────────────────────────────────────────

export const getByProviderId = internalQuery({
  args: { provider: v.string(), providerEventId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("newsEvents")
      .withIndex("by_provider_id", (q) =>
        q.eq("provider", args.provider).eq("providerEventId", args.providerEventId),
      )
      .first();
  },
});

// ─── Internal mutation: insert news event ─────────────────────────────────────

export const insertNewsEvent = internalMutation({
  args: {
    provider:        v.string(),
    providerEventId: v.string(),
    category:        v.string(),
    market:          v.string(),
    headline:        v.string(),
    summary:         v.optional(v.string()),
    source:          v.optional(v.string()),
    url:             v.optional(v.string()),
    image:           v.optional(v.string()),
    related:         v.optional(v.string()),
    publishedAt:     v.number(),
    impact:          v.string(),
    affectedSymbols: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for existing event (dedup)
    const existing = await ctx.db
      .query("newsEvents")
      .withIndex("by_provider_id", (q) =>
        q.eq("provider", args.provider).eq("providerEventId", args.providerEventId),
      )
      .first();
    if (existing) return null; // already exists — skip

    return await ctx.db.insert("newsEvents", {
      ...args,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// ─── Public action: fetch Finnhub news (manual trigger) ───────────────────────

export const fetchFinnhubNews = action({
  args: {},
  handler: async (ctx): Promise<{
    ok:        boolean;
    inserted:  number;
    skipped:   number;
    errors:    string[];
    categories: Record<string, number>;
  }> => {
    // Auth check — only authenticated users can trigger
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("غير مصرح — يرجى تسجيل الدخول");

    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      return { ok: false, inserted: 0, skipped: 0, errors: ["FINNHUB_API_KEY غير مضبوط في متغيرات البيئة"], categories: {} };
    }

    let totalInserted = 0;
    let totalSkipped  = 0;
    const errors: string[] = [];
    const categoryCounts: Record<string, number> = {};

    for (const category of CATEGORIES) {
      try {
        const url = `${FINNHUB_BASE}/news?category=${category}`;
        const res = await fetch(url, {
          headers: { "X-Finnhub-Token": apiKey },
          cache:   "no-store",
        });

        if (!res.ok) {
          errors.push(`Finnhub ${category}: HTTP ${res.status}`);
          continue;
        }

        type FinnhubArticle = {
          id:       number;
          datetime: number;
          headline: string;
          summary:  string;
          source:   string;
          url:      string;
          image?:   string;
          related?: string;
          category: string;
        };

        const articles = (await res.json()) as FinnhubArticle[];
        if (!Array.isArray(articles)) {
          errors.push(`Finnhub ${category}: استجابة غير متوقعة`);
          continue;
        }

        let categoryInserted = 0;

        for (const article of articles.slice(0, 30)) {
          if (!article.id || !article.headline) continue;

          const providerEventId = String(article.id);
          const publishedAt     = article.datetime * 1000; // seconds → ms
          const impact          = detectImpact(article.headline, article.summary ?? "");
          const affectedSymbols = detectAffectedSymbols(category, article.headline, article.summary ?? "");

          const result = await ctx.runMutation(internal.newsIngestion.insertNewsEvent, {
            provider:        "finnhub",
            providerEventId,
            category,
            market:          MARKET_MAP[category] ?? "GLOBAL",
            headline:        article.headline,
            summary:         article.summary   || undefined,
            source:          article.source    || undefined,
            url:             article.url       || undefined,
            image:           article.image     || undefined,
            related:         article.related   || undefined,
            publishedAt,
            impact,
            affectedSymbols,
          });

          if (result !== null) {
            totalInserted++;
            categoryInserted++;
          } else {
            totalSkipped++;
          }
        }

        categoryCounts[category] = categoryInserted;
      } catch (err) {
        errors.push(`Finnhub ${category}: ${err instanceof Error ? err.message : "خطأ غير معروف"}`);
      }
    }

    return {
      ok:         errors.length < CATEGORIES.length, // ok if at least one category succeeded
      inserted:   totalInserted,
      skipped:    totalSkipped,
      errors,
      categories: categoryCounts,
    };
  },
});

// ─── Public query: list recent news ──────────────────────────────────────────

export const listRecentNews = query({
  args: {
    limit:    v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const limit = Math.min(args.limit ?? 10, 50);

    if (args.category) {
      return await ctx.db
        .query("newsEvents")
        .withIndex("by_category_publishedAt", (q) => q.eq("category", args.category!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("newsEvents")
      .withIndex("by_publishedAt")
      .order("desc")
      .take(limit);
  },
});

// ─── Public query: news counts by category ───────────────────────────────────

export const getNewsCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const LIMIT = 500; // approximate — no collect() on large tables

    const [general, crypto, forex] = await Promise.all([
      ctx.db
        .query("newsEvents")
        .withIndex("by_category_publishedAt", (q) => q.eq("category", "general"))
        .order("desc")
        .take(LIMIT),
      ctx.db
        .query("newsEvents")
        .withIndex("by_category_publishedAt", (q) => q.eq("category", "crypto"))
        .order("desc")
        .take(LIMIT),
      ctx.db
        .query("newsEvents")
        .withIndex("by_category_publishedAt", (q) => q.eq("category", "forex"))
        .order("desc")
        .take(LIMIT),
    ]);

    const latestAny = await ctx.db
      .query("newsEvents")
      .withIndex("by_publishedAt")
      .order("desc")
      .first();

    return {
      general:   general.length,
      crypto:    crypto.length,
      forex:     forex.length,
      total:     general.length + crypto.length + forex.length,
      latestAt:  latestAny?.createdAt ?? null,
    };
  },
});
