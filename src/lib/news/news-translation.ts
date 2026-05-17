/**
 * news-translation.ts — B6.1.3
 * Type contract for the translation provider abstraction.
 * Actual translation happens server-side in convex/newsTranslation.ts.
 * No API keys stored here — keys come from process.env only.
 */

export type TranslationProvider = "openai" | "google" | "none";

export type AutoTranslateResult =
  | {
      ok:                  true;
      provider:            TranslationProvider;
      translatedHeadline:  string;
      translatedSummary:   string | null;
    }
  | {
      ok:      false;
      reason:  "no_provider" | "api_error" | "parse_error";
      message: string;
    };

// Message shown when no provider is configured
export const NO_PROVIDER_MESSAGE =
  "الترجمة الآلية غير مفعلة — أضف OPENAI_API_KEY أو GOOGLE_TRANSLATE_API_KEY في متغيرات البيئة Convex.";
