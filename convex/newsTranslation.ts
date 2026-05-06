/**
 * newsTranslation.ts — B6.1.3
 * Auto-translation action for Finnhub news events.
 * لا order_send — لا تنفيذ تداول — ترجمة فقط.
 *
 * Providers (from process.env — never hardcoded):
 *   OPENAI_API_KEY → gpt-4o-mini
 *   GOOGLE_TRANSLATE_API_KEY → Google Translate v2
 *   Neither → returns no_provider error
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// ─── Impact helper (duplicated intentionally — can't cross-import in Convex) ──

function impactToDecision(impact: string): string {
  if (impact === "BLOCK") return "BLOCK_REVIEW";
  if (impact === "HIGH")  return "WARN";
  if (impact === "MEDIUM") return "WATCH";
  return "PASS";
}

// ─── Internal query: get news event ──────────────────────────────────────────

export const getNewsEventById = internalQuery({
  args: { id: v.id("newsEvents") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

// ─── Internal mutation: save translation only ────────────────────────────────

export const saveTranslationOnly = internalMutation({
  args: {
    newsEventId:         v.id("newsEvents"),
    userId:              v.string(),
    translatedHeadline:  v.string(),
    translatedSummary:   v.optional(v.string()),
    autoImpact:          v.string(),
    autoSymbols:         v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("newsReviews")
      .withIndex("by_news_user", (q) =>
        q.eq("newsEventId", args.newsEventId).eq("userId", args.userId),
      )
      .first();

    const now = Date.now();

    if (existing) {
      // Patch ONLY the translation fields — never touch userImpactOverride/assessment
      await ctx.db.patch(existing._id, {
        translatedHeadline: args.translatedHeadline,
        translatedSummary:  args.translatedSummary,
        updatedAt: now,
      });
      return { id: existing._id, created: false };
    }

    // Create a new review record with translation and auto-computed defaults
    const id = await ctx.db.insert("newsReviews", {
      newsEventId:          args.newsEventId,
      userId:               args.userId,
      translatedHeadline:   args.translatedHeadline,
      translatedSummary:    args.translatedSummary,
      finalImpact:          args.autoImpact,
      finalAffectedSymbols: args.autoSymbols,
      finalDecision:        impactToDecision(args.autoImpact),
      reviewedAt:           now,
      createdAt:            now,
      updatedAt:            now,
    });
    return { id, created: true };
  },
});

// ─── OpenAI translation ───────────────────────────────────────────────────────

async function translateWithOpenAI(
  apiKey:   string,
  headline: string,
  summary:  string | null,
): Promise<{ headline: string; summary: string | null }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role:    "system",
          content: `You are a professional financial news translator (English → Arabic).
Return ONLY valid JSON: {"headline":"...","summary":"..." or null}.
Rules:
- Translate naturally to Modern Standard Arabic.
- Keep ticker symbols, brand names, and acronyms (Fed, FOMC, CPI, ETF, NFP, GDP, SEC, BTC, ETH) as-is or use standard Arabic equivalents.
- Keep numbers and dates unchanged.`,
        },
        {
          role:    "user",
          content: JSON.stringify({ headline, summary: summary ?? null }),
        },
      ],
      temperature:     0.2,
      max_tokens:      600,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = data.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { headline?: string; summary?: string | null };

  return {
    headline: parsed.headline ?? headline,
    summary:  parsed.summary  ?? null,
  };
}

// ─── Google Translate translation ─────────────────────────────────────────────

async function translateWithGoogle(
  apiKey:   string,
  headline: string,
  summary:  string | null,
): Promise<{ headline: string; summary: string | null }> {
  const texts = summary ? [headline, summary] : [headline];

  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ q: texts, target: "ar", format: "text" }),
    },
  );

  if (!res.ok) throw new Error(`Google Translate ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    data: { translations: Array<{ translatedText: string }> };
  };
  const t = data.data.translations;

  return {
    headline: t[0]?.translatedText ?? headline,
    summary:  summary ? (t[1]?.translatedText ?? null) : null,
  };
}

// ─── Public action: auto-translate a news event ───────────────────────────────

export const autoTranslateNews = action({
  args: { newsEventId: v.id("newsEvents") },
  handler: async (ctx, args): Promise<{
    ok:                  boolean;
    provider?:           string;
    translatedHeadline?: string;
    translatedSummary?:  string | null;
    reason?:             string;
    message?:            string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("غير مصرح — يرجى تسجيل الدخول");

    // ── Select translation provider ────────────────────────────────────────
    const openaiKey  = process.env.OPENAI_API_KEY;
    const googleKey  = process.env.GOOGLE_TRANSLATE_API_KEY;

    if (!openaiKey && !googleKey) {
      return {
        ok:      false,
        reason:  "no_provider",
        message: "الترجمة الآلية غير مفعلة — أضف OPENAI_API_KEY أو GOOGLE_TRANSLATE_API_KEY في متغيرات بيئة Convex.",
      };
    }

    // ── Fetch the news event ────────────────────────────────────────────────
    const newsEvent = await ctx.runQuery(internal.newsTranslation.getNewsEventById, {
      id: args.newsEventId,
    });
    if (!newsEvent) {
      return { ok: false, reason: "api_error", message: "الخبر غير موجود في قاعدة البيانات." };
    }

    // ── Translate ──────────────────────────────────────────────────────────
    let result: { headline: string; summary: string | null };
    let provider: string;

    try {
      if (openaiKey) {
        result   = await translateWithOpenAI(openaiKey, newsEvent.headline, newsEvent.summary ?? null);
        provider = "openai";
      } else {
        result   = await translateWithGoogle(googleKey!, newsEvent.headline, newsEvent.summary ?? null);
        provider = "google";
      }
    } catch (err) {
      return {
        ok:      false,
        reason:  "api_error",
        message: `فشل الاتصال بمزود الترجمة: ${err instanceof Error ? err.message : "خطأ غير معروف"}`,
      };
    }

    // ── Save to newsReviews (translation only, preserve user assessment) ───
    await ctx.runMutation(internal.newsTranslation.saveTranslationOnly, {
      newsEventId:        args.newsEventId,
      userId:             identity.subject,
      translatedHeadline: result.headline,
      translatedSummary:  result.summary ?? undefined,
      autoImpact:         newsEvent.impact,
      autoSymbols:        newsEvent.affectedSymbols,
    });

    return {
      ok:                 true,
      provider,
      translatedHeadline: result.headline,
      translatedSummary:  result.summary,
    };
  },
});
