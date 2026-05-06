/**
 * news-protection-committee.ts — B6.2
 * News Protection Committee engine.
 * No trading execution — no order_send — read-only analysis.
 *
 * Evaluates Finnhub news events against the current symbol to produce:
 * PASS / WATCH / WARN / BLOCK
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type NewsMatchType =
  | "DIRECT"        // symbol is literally in finalAffectedSymbols
  | "USER_OVERRIDE" // user explicitly added symbol in review
  | "MACRO_USD"     // USD-pair symbol + news affects USD/GLOBAL
  | "MACRO_RISK"    // XAUUSD + news has GLOBAL_RISK/OIL/WAR/GOLD
  | "FOREX_GENERAL";// category=forex + symbol is major pair + generic FOREX tag

export type NewsItemVerdict = "BLOCK" | "WARN" | "WATCH" | "PASS";

export type NewsCommitteeItem = {
  headline:              string;
  source?:               string;
  category:              string;
  publishedAt:           number;
  autoImpact:            string;
  autoAffectedSymbols:   string[];
  finalImpact:           string;
  finalDecision:         string;
  finalAffectedSymbols:  string[];
  userImpactOverride?:   string;
  userAffectedSymbolsOverride?: string[];
  relationshipType?:     string;
  userDirectionBias?:    string;
  userNote?:             string;
  hasHumanReview:        boolean;
};

export type MatchedNewsEvent = {
  headline:         string;
  source?:          string;
  category:         string;
  publishedAt:      number;
  finalImpact:      string;
  finalDecision:    string;
  affectedSymbols:  string[];
  relationshipType?: string;
  userNote?:        string;
  ageMinutes:       number;
  matchType:        NewsMatchType;
  itemVerdict:      NewsItemVerdict;
};

export type NewsCommitteeResult = {
  committee:         "NEWS_PROTECTION_B6_2";
  verdict:           "PASS" | "WATCH" | "WARN" | "BLOCK";
  score:             number;
  symbol:            string;
  matchedNewsCount:  number;
  highImpactCount:   number;
  blockingNewsCount: number;
  reasons:           string[];
  warnings:          string[];
  blockers:          string[];
  matchedEvents:     MatchedNewsEvent[];
};

// ─── Major forex pairs for FOREX_GENERAL matching ────────────────────────────

const MAJOR_FOREX_PAIRS = new Set([
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "XAUUSD",
]);

// ─── Symbol matching ──────────────────────────────────────────────────────────

function matchSymbol(
  symbol: string,
  item: NewsCommitteeItem,
): { matches: boolean; matchType: NewsMatchType } {
  const fa = item.finalAffectedSymbols;
  const ua = item.userAffectedSymbolsOverride ?? [];

  // 1. User explicitly added symbol in override (tracked separately from auto)
  if (ua.includes(symbol)) {
    return { matches: true, matchType: "USER_OVERRIDE" };
  }

  // 2. DIRECT: symbol is literally in finalAffectedSymbols
  if (fa.includes(symbol)) {
    return { matches: true, matchType: "DIRECT" };
  }

  // 3. MACRO_USD: any USD pair + news affects USD or GLOBAL
  const isUSDPair = symbol.includes("USD");
  if (isUSDPair && (fa.includes("USD") || fa.includes("GLOBAL"))) {
    return { matches: true, matchType: "MACRO_USD" };
  }

  // 4. MACRO_RISK: XAUUSD + global risk news
  if (
    symbol === "XAUUSD" &&
    fa.some((s) => ["GOLD", "XAUUSD", "GLOBAL_RISK", "OIL", "COMMODITIES", "WAR"].includes(s))
  ) {
    return { matches: true, matchType: "MACRO_RISK" };
  }

  // 5. FOREX_GENERAL: forex category + major pair + generic FOREX tag
  if (item.category === "forex" && MAJOR_FOREX_PAIRS.has(symbol) && fa.includes("FOREX")) {
    return { matches: true, matchType: "FOREX_GENERAL" };
  }

  return { matches: false, matchType: "DIRECT" };
}

// ─── Per-item verdict (time + impact + match type) ────────────────────────────

function getItemVerdict(
  item: NewsCommitteeItem,
  ageMinutes: number,
  matchType: NewsMatchType,
): NewsItemVerdict {
  const impact   = item.finalImpact;
  const decision = item.finalDecision;
  const rel      = item.relationshipType;

  // Human BLOCK_REVIEW stays active up to 24h
  if (decision === "BLOCK_REVIEW" && ageMinutes < 24 * 60) {
    // Only DIRECT / USER_OVERRIDE → BLOCK; indirect matches → WARN
    return matchType === "DIRECT" || matchType === "USER_OVERRIDE" ? "BLOCK" : "WARN";
  }

  // FOREX_GENERAL is capped at WATCH regardless of impact (no user override)
  if (matchType === "FOREX_GENERAL") {
    if ((impact === "HIGH" || impact === "BLOCK") && ageMinutes < 6 * 60) return "WATCH";
    if (impact === "MEDIUM" && ageMinutes < 24 * 60) return "WATCH";
    return "PASS";
  }

  // HIGH / BLOCK impact — time-scaled
  if (impact === "HIGH" || impact === "BLOCK") {
    if (ageMinutes < 60)     return "BLOCK";
    if (ageMinutes < 6 * 60) return "WARN";
    if (ageMinutes < 24 * 60 && item.hasHumanReview) return "WARN";
    return "PASS"; // too old
  }

  // MEDIUM impact
  if (impact === "MEDIUM") {
    if (ageMinutes < 24 * 60) return "WATCH";
    return "PASS";
  }

  // LOW / NONE — only watch if user flagged GLOBAL_RISK / MACRO
  if (impact === "LOW" || impact === "NONE") {
    if (
      (rel === "GLOBAL_RISK" || rel === "MACRO") &&
      (matchType === "MACRO_RISK" || matchType === "MACRO_USD") &&
      ageMinutes < 6 * 60
    ) {
      return "WATCH";
    }
    return "PASS";
  }

  return "PASS";
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function analyzeNewsProtectionCommittee(
  items:  NewsCommitteeItem[],
  symbol: string,
  now:    number,
): NewsCommitteeResult {
  const reasons:  string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const matchedEvents: MatchedNewsEvent[] = [];

  let watchCount = 0;

  for (const item of items) {
    const ageMinutes = (now - item.publishedAt) / 60000;

    // Skip extremely old news (shouldn't happen with sinceMs filter, but guard)
    if (ageMinutes > 25 * 60) continue;

    const { matches, matchType } = matchSymbol(symbol, item);
    if (!matches) continue;

    const itemVerdict = getItemVerdict(item, ageMinutes, matchType);
    if (itemVerdict === "PASS") continue; // no threat

    const ageLabel = ageMinutes < 60
      ? `${Math.round(ageMinutes)} دق`
      : `${(ageMinutes / 60).toFixed(1)} س`;
    const headline60 = item.headline.length > 60
      ? item.headline.slice(0, 60) + "…"
      : item.headline;

    matchedEvents.push({
      headline:        item.headline,
      source:          item.source,
      category:        item.category,
      publishedAt:     item.publishedAt,
      finalImpact:     item.finalImpact,
      finalDecision:   item.finalDecision,
      affectedSymbols: item.finalAffectedSymbols,
      relationshipType: item.relationshipType,
      userNote:        item.userNote,
      ageMinutes:      Math.round(ageMinutes),
      matchType,
      itemVerdict,
    });

    const humanTag = item.hasHumanReview ? " [مراجعة بشرية]" : "";
    const label = `(${matchType}, ${item.finalImpact}, ${ageLabel}${humanTag})`;

    if (itemVerdict === "BLOCK") {
      blockers.push(`${headline60} ${label}`);
    } else if (itemVerdict === "WARN") {
      warnings.push(`${headline60} ${label}`);
    } else {
      watchCount++;
      reasons.push(`مراقبة: ${headline60} ${label}`);
    }
  }

  // ── Overall verdict ────────────────────────────────────────────────────────
  let verdict: NewsCommitteeResult["verdict"];
  if (blockers.length > 0) verdict = "BLOCK";
  else if (warnings.length > 0) verdict = "WARN";
  else if (watchCount > 0) verdict = "WATCH";
  else verdict = "PASS";

  if (verdict === "PASS") {
    reasons.unshift(`لا أخبار مؤثرة على ${symbol} في آخر 24 ساعة ✓`);
  }

  // ── Score ──────────────────────────────────────────────────────────────────
  let score = 90;
  score -= blockers.length * 30;
  score -= warnings.length * 15;
  score -= watchCount * 8;
  score = Math.max(5, Math.min(92, score));

  const highImpactCount   = matchedEvents.filter((e) => e.finalImpact === "HIGH" || e.finalImpact === "BLOCK").length;
  const blockingNewsCount = blockers.length;

  return {
    committee:  "NEWS_PROTECTION_B6_2",
    verdict,
    score,
    symbol,
    matchedNewsCount:  matchedEvents.length,
    highImpactCount,
    blockingNewsCount,
    reasons:  reasons.slice(0, 6),
    warnings: warnings.slice(0, 4),
    blockers: blockers.slice(0, 3),
    matchedEvents: matchedEvents.slice(0, 5),
  };
}
