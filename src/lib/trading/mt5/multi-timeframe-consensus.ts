/**
 * multi-timeframe-consensus.ts — B5
 * Multi-Timeframe Consensus Engine.
 * No trading execution — no order_send — read-only analysis.
 *
 * Hierarchy: D1 (توجه يومي) > H4 (سياق) > H1 (هيكل) > M30 (تأكيد) > M15 (توقيت)
 */

// --- Types --------------------------------------------------------------------

export type TFBias = "bullish" | "bearish" | "neutral" | "unknown";

export type TimeframeSummary = {
  timeframe:   string;
  trendBias:   TFBias;
  available:   boolean;
  candleCount: number | undefined;
  isEntry:     boolean;          // true = this is the entry (trading) timeframe
};

export type MultiTimeframeConsensus = {
  timeframeSummaries:    TimeframeSummary[];
  dominantTimeframe:     string | null;
  higherTimeframeBias:   "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  entryTimeframeBias:    TFBias;
  alignmentScore:        number;    // 0–100
  verdict:               "PASS" | "WARN" | "BLOCK";
  bias:                  "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  reasons:               string[];
  warnings:              string[];
  blockers:              string[];
};

// --- Minimal indicator input (decoupled from route type) ----------------------

type TFIndicator = {
  status:       string;          // "ok" | "insufficient_data" | "error"
  trendBias?:   string;          // "bullish" | "bearish" | undefined
  candleCount?: number;
};

// --- Constants ----------------------------------------------------------------

// Weights: higher timeframe = more weight in alignment score
const TF_WEIGHTS: Record<string, number> = {
  D1:  50,
  H4:  40,
  H1:  30,
  M30: 20,
  M15: 10,
};

const HIGHER_TFS  = ["D1", "H4", "H1"] as const;   // توجه يومي + سياق + هيكل
const CONTEXT_TFS = ["D1", "H4", "H1", "M30", "M15"] as const;

// --- Helpers ------------------------------------------------------------------

function extractBias(ind: TFIndicator | undefined): TFBias {
  if (!ind || ind.status !== "ok") return "unknown";
  if (ind.trendBias === "bullish") return "bullish";
  if (ind.trendBias === "bearish") return "bearish";
  return "neutral";
}

function biasLabel(b: TFBias): string {
  if (b === "bullish") return "↑ صاعد";
  if (b === "bearish") return "↓ هابط";
  if (b === "neutral") return "↔ محايد";
  return "غير متاح";
}

function biasOpposesEntry(tfBias: TFBias, entryBias: TFBias): boolean {
  return (
    (tfBias === "bullish" && entryBias === "bearish") ||
    (tfBias === "bearish" && entryBias === "bullish")
  );
}

function biasConfirmsEntry(tfBias: TFBias, entryBias: TFBias): boolean {
  return tfBias !== "unknown" && tfBias !== "neutral" && tfBias === entryBias;
}

// --- Main entry point ---------------------------------------------------------

export function analyzeMultiTimeframeConsensus(
  indicators:      Record<string, TFIndicator>,
  entryTimeframe:  string,
): MultiTimeframeConsensus {
  const reasons:  string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  // -- 1. Build timeframe summaries -----------------------------------------
  const timeframeSummaries: TimeframeSummary[] = CONTEXT_TFS.map((tf) => {
    const ind  = indicators[tf];
    const bias = extractBias(ind);
    return {
      timeframe:   tf,
      trendBias:   bias,
      available:   ind?.status === "ok",
      candleCount: ind?.candleCount,
      isEntry:     tf === entryTimeframe,
    };
  });

  // -- 2. Entry TF bias ------------------------------------------------------
  const entryTFBias: TFBias = extractBias(indicators[entryTimeframe]);

  // -- 3. Higher TF bias (D1 dominates, then H4, then H1) ------------------
  const d1Bias = extractBias(indicators["D1"]);
  const h4Bias = extractBias(indicators["H4"]);
  const h1Bias = extractBias(indicators["H1"]);
  const d1Available = d1Bias !== "unknown";
  const h4Available = h4Bias !== "unknown";
  const h1Available = h1Bias !== "unknown";

  let higherTimeframeBias: MultiTimeframeConsensus["higherTimeframeBias"];
  if (!d1Available && !h4Available && !h1Available) {
    higherTimeframeBias = "unknown";
  } else if (d1Available) {
    // D1 is the primary context; flag mixed if H4 contradicts
    if (h4Available && h4Bias !== "neutral" && d1Bias !== "neutral" && h4Bias !== d1Bias) {
      higherTimeframeBias = "mixed";
    } else {
      higherTimeframeBias = d1Bias as "bullish" | "bearish" | "neutral";
    }
  } else if (h4Available && h1Available) {
    if (h4Bias === h1Bias)                                    higherTimeframeBias = h4Bias as "bullish" | "bearish" | "neutral";
    else if (h4Bias !== "neutral" && h1Bias !== "neutral")    higherTimeframeBias = "mixed";
    else if (h4Bias !== "neutral")                            higherTimeframeBias = h4Bias as "bullish" | "bearish";
    else                                                       higherTimeframeBias = h1Bias as "bullish" | "bearish" | "neutral";
  } else {
    const avail = h4Available ? h4Bias : h1Bias;
    higherTimeframeBias = avail as "bullish" | "bearish" | "neutral";
  }

  // -- 4. Dominant timeframe -------------------------------------------------
  let dominantTimeframe: string | null = null;
  for (const tf of CONTEXT_TFS) {
    const b = extractBias(indicators[tf]);
    if (b !== "neutral" && b !== "unknown") {
      dominantTimeframe = tf;
      break;
    }
  }

  // -- 5. Alignment score (weighted) ----------------------------------------
  let agreeWeight    = 0;
  let totalAvailable = 0;

  for (const tf of CONTEXT_TFS) {
    const w    = TF_WEIGHTS[tf] ?? 10;
    const bias = extractBias(indicators[tf]);
    if (bias === "unknown") continue;  // unavailable TF doesn't count
    totalAvailable += w;
    if (entryTFBias !== "unknown" && biasConfirmsEntry(bias, entryTFBias)) {
      agreeWeight += w;
    }
  }

  const alignmentScore = totalAvailable > 0 && entryTFBias !== "unknown"
    ? Math.round(agreeWeight / totalAvailable * 100)
    : 0;

  // -- 6. Verdict ------------------------------------------------------------
  const d1Opposes  = d1Available && biasOpposesEntry(d1Bias, entryTFBias);
  const d1Confirms = d1Available && biasConfirmsEntry(d1Bias, entryTFBias);
  const h4Opposes  = h4Available && biasOpposesEntry(h4Bias, entryTFBias);
  const h1Opposes  = h1Available && biasOpposesEntry(h1Bias, entryTFBias);
  const h4Confirms = h4Available && biasConfirmsEntry(h4Bias, entryTFBias);
  const h1Confirms = h1Available && biasConfirmsEntry(h1Bias, entryTFBias);

  let verdict: MultiTimeframeConsensus["verdict"];

  if (entryTFBias === "unknown") {
    verdict = "WARN";
    warnings.push("اتجاه فريم الدخول غير متاح — لا يمكن حساب توافق الفريمات");
  } else if (d1Opposes && h4Opposes) {
    // D1 + H4 both opposing: strongest block signal
    verdict = "BLOCK";
    blockers.push(
      `D1 (${biasLabel(d1Bias)}) و H4 (${biasLabel(h4Bias)}) كلاهما يعارضان الاتجاه (${biasLabel(entryTFBias)})`,
    );
  } else if (h4Opposes && h1Opposes) {
    verdict = "BLOCK";
    blockers.push(
      `H4 (${biasLabel(h4Bias)}) و H1 (${biasLabel(h1Bias)}) كلاهما يعارضان اتجاه الدخول (${biasLabel(entryTFBias)})`,
    );
  } else if (h4Opposes && !h1Available) {
    verdict = "BLOCK";
    blockers.push(
      `H4 (${biasLabel(h4Bias)}) يعارض الدخول و H1 غير متاح للتأكيد`,
    );
  } else if (d1Opposes) {
    verdict = "WARN";
    warnings.push(`D1 (${biasLabel(d1Bias)}) يعارض الدخول — توجه اليومي عكس الاتجاه`);
  } else if (h4Opposes) {
    verdict = "WARN";
    warnings.push(`H4 (${biasLabel(h4Bias)}) يعارض الدخول — مراجعة السياق العام مطلوبة`);
  } else if (h1Opposes && !h4Available) {
    verdict = "WARN";
    warnings.push(`H1 (${biasLabel(h1Bias)}) يعارض الدخول و H4 غير متاح`);
  } else if (
    (!d1Available || d1Bias === "neutral") &&
    (!h4Available || h4Bias === "neutral") &&
    (!h1Available || h1Bias === "neutral")
  ) {
    verdict = "WARN";
    warnings.push("D1 و H4 و H1 محايدان — السياق العام غير واضح لاتجاه الدخول");
  } else if (d1Confirms && h4Confirms && h1Confirms) {
    verdict = "PASS";
    reasons.push(`D1 (${biasLabel(d1Bias)}) و H4 (${biasLabel(h4Bias)}) و H1 (${biasLabel(h1Bias)}) يؤكدان الاتجاه ✓`);
  } else if (d1Confirms && h4Confirms) {
    verdict = "PASS";
    reasons.push(`D1 (${biasLabel(d1Bias)}) و H4 (${biasLabel(h4Bias)}) يؤكدان الاتجاه ✓`);
    if (h1Bias === "neutral") warnings.push("H1 محايد");
  } else if (h4Confirms && h1Confirms) {
    verdict = "PASS";
    reasons.push(`H4 (${biasLabel(h4Bias)}) و H1 (${biasLabel(h1Bias)}) يؤكدان الاتجاه ✓`);
    if (d1Available && d1Bias === "neutral") warnings.push("D1 محايد — التوجه اليومي غير حاسم");
  } else if (h4Confirms) {
    verdict = "PASS";
    reasons.push(`H4 (${biasLabel(h4Bias)}) يدعم الاتجاه ✓`);
    if (h1Bias === "neutral") warnings.push("H1 محايد — دعم H4 وحده");
  } else if (h1Confirms && !h4Available) {
    verdict = "PASS";
    reasons.push(`H1 (${biasLabel(h1Bias)}) يدعم الاتجاه (H4 غير متاح) ✓`);
  } else {
    verdict = "WARN";
    warnings.push("الفريمات العليا لا تؤكد ولا تعارض — توافق غير كافٍ");
  }

  // -- 7. Additional reasons -------------------------------------------------
  const m30Bias = extractBias(indicators["M30"]);
  if (m30Bias !== "unknown") {
    if (biasConfirmsEntry(m30Bias, entryTFBias)) {
      reasons.push(`M30 (${biasLabel(m30Bias)}) يدعم الدخول ✓`);
    } else if (biasOpposesEntry(m30Bias, entryTFBias)) {
      warnings.push(`M30 (${biasLabel(m30Bias)}) يعارض الدخول`);
    }
  }

  reasons.push(
    `درجة التوافق: ${alignmentScore}% | الفريم المتحكم: ${dominantTimeframe ?? "غير محدد"}`,
  );

  // -- 8. Overall bias -------------------------------------------------------
  let bias: MultiTimeframeConsensus["bias"];
  if (higherTimeframeBias === "bullish") bias = "BULLISH";
  else if (higherTimeframeBias === "bearish") bias = "BEARISH";
  else if (higherTimeframeBias === "mixed") bias = "MIXED";
  else bias = "NEUTRAL";

  return {
    timeframeSummaries,
    dominantTimeframe,
    higherTimeframeBias,
    entryTimeframeBias: entryTFBias,
    alignmentScore,
    verdict,
    bias,
    reasons:  reasons.slice(0, 6),
    warnings: warnings.slice(0, 4),
    blockers: blockers.slice(0, 3),
  };
}
