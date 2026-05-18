/**
 * gold-recommendation-engine.ts — Gold Recommendation Engine v1
 * ─────────────────────────────────────────────────────────────────────────────
 * دالة pure تحوّل مخرجات اللجان + الحارس + إعدادات التنفيذ
 * إلى توصية نظام موحدة قابلة للعرض في /gold.
 *
 * ⚠️ لا تنفيذ تداول — لا order_send — قراءة وعرض فقط.
 * ⚠️ لا تُغيِّر منطق زر التنفيذ ولا شروط الحوكمة.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Status & Direction ───────────────────────────────────────────────────────

export type RecommendationStatus =
  | "NO_TRADE"
  | "WATCH"
  | "CANDIDATE"
  | "EXPERIMENTAL"
  | "APPROVED"
  | "BLOCKED";

export type RecommendationDirection = "BUY" | "SELL" | "NEUTRAL";

// ─── Input ────────────────────────────────────────────────────────────────────

export type GoldRecommendationInput = {
  // من AnalysisResult
  analysisStatus: string;
  direction?: "bullish" | "bearish";
  riskUsd: number;
  riskPercentOfEquity?: number;

  // من DecisionSummary
  grade: string;
  probability: number;
  finalDecision: string;
  anyBlock: boolean;
  criticalBlockCount: number;
  committees: Array<{
    committeeId: string;
    committeeName: string;
    verdict: "PASS" | "WARN" | "BLOCK";
    score: number;
    summary: string;
  }>;

  // من PriceActionExecutionGuard
  guardStatus: "PASS" | "WARN" | "BLOCK";
  guardBlockers: string[];
  guardWarnings: string[];

  // من TradeOrderPreview
  rrRatio?: number;
  estimatedLot?: number;
  previewAllowed: boolean;

  // من DemoExecutionSettings
  executionMode: string;
  killSwitchEnabled: boolean;

  // بوابة التنفيذ المحسوبة (=== canOpenGoldModal)
  executionGateOpen: boolean;
};

// ─── Output ───────────────────────────────────────────────────────────────────

export type GoldRecommendation = {
  recommendationStatus: RecommendationStatus;
  direction: RecommendationDirection;
  confidencePercent: number;
  grade: string;
  title: string;
  summary: string;
  reasons: string[];
  warnings: string[];
  blockers: string[];
  executionAllowed: boolean;
  executionModeLabel: string;
  riskSummary: string;
  nextAction: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RELEVANT_COMMITTEE_IDS = new Set([
  "trend",
  "momentum",
  "market-structure",
  "multi-timeframe-consensus",
  "entry-quality",
  "market-state-data-quality",
  "news-protection",
]);

function resolveStatus(input: GoldRecommendationInput): RecommendationStatus {
  // BLOCKED — أعلى أولوية
  if (
    input.criticalBlockCount > 0 ||
    input.finalDecision === "BLOCK" ||
    input.guardStatus === "BLOCK"
  ) {
    return "BLOCKED";
  }

  // NO_TRADE — لا فرصة مكتشفة
  if (input.analysisStatus !== "opportunity") {
    return "NO_TRADE";
  }

  // إشارة موجودة (opportunity) — تقييم الجودة
  if (input.grade === "C" || input.grade === "D" || input.probability < 45) {
    return "WATCH";
  }

  if (input.anyBlock || input.grade === "B") {
    return "CANDIDATE";
  }

  // درجة A أو A+ بلا blocks
  if (input.executionGateOpen) {
    return "APPROVED";
  }

  return "EXPERIMENTAL";
}

function resolveDirection(input: GoldRecommendationInput): RecommendationDirection {
  if (input.direction === "bullish") return "BUY";
  if (input.direction === "bearish") return "SELL";
  return "NEUTRAL";
}

function resolveTitle(
  status: RecommendationStatus,
  direction: RecommendationDirection,
): string {
  switch (status) {
    case "APPROVED":
      return direction === "BUY"
        ? "توصية النظام: شراء XAUUSD ✓"
        : direction === "SELL"
          ? "توصية النظام: بيع XAUUSD ✓"
          : "توصية النظام: جاهز للمراجعة";
    case "EXPERIMENTAL":
      return direction === "BUY"
        ? "إشارة شراء — تجربة محكومة"
        : direction === "SELL"
          ? "إشارة بيع — تجربة محكومة"
          : "إشارة — تجربة محكومة";
    case "CANDIDATE":
      return direction === "BUY"
        ? "مرشّح للشراء — مراجعة مطلوبة"
        : direction === "SELL"
          ? "مرشّح للبيع — مراجعة مطلوبة"
          : "مرشّح — مراجعة مطلوبة";
    case "WATCH":
      return direction === "BUY"
        ? "مراقبة — ميل صعودي"
        : direction === "SELL"
          ? "مراقبة — ميل هبوطي"
          : "مراقبة — لا اتجاه واضح";
    case "NO_TRADE":
      return "لا توجد فرصة حالياً";
    case "BLOCKED":
      return "محظور — لا يجوز التنفيذ";
  }
}

function resolveSummary(
  status: RecommendationStatus,
  input: GoldRecommendationInput,
  direction: RecommendationDirection,
): string {
  switch (status) {
    case "BLOCKED":
      return `القرار محظور — ${input.criticalBlockCount > 0 ? "لجنة حرجة أصدرت BLOCK" : "حارس الجودة رفض الإشارة"} — يُرجى مراجعة أسباب المنع.`;
    case "NO_TRADE": {
      const stMap: Record<string, string> = {
        wait:              "لا إشارة تقنية واضحة — السوق في طور الانتظار.",
        insufficient_data: "البيانات غير كافية لإصدار توصية — زامن الشموع.",
        stale_data:        "البيانات قديمة — لا يمكن إصدار توصية موثوقة.",
        rejected:          "التحليل رفض الإشارة بسبب تعارض الأطر أو ضعف الإشارة.",
      };
      return stMap[input.analysisStatus] ?? "لا توجد إشارة حالياً.";
    }
    case "WATCH":
      return `الإشارة ضعيفة — درجة ${input.grade} | احتمال ${input.probability}% — تحتاج لتحسّن الشروط قبل الدراسة الجدية.`;
    case "CANDIDATE":
      return `إشارة ${direction === "BUY" ? "شراء" : direction === "SELL" ? "بيع" : "محايدة"} — درجة ${input.grade} | احتمال ${input.probability}% — توجد ${input.committees.filter(c => c.verdict === "BLOCK" || c.verdict === "WARN").length} لجان تحتاج مراجعة قبل التنفيذ.`;
    case "EXPERIMENTAL":
      return `إشارة ${direction === "BUY" ? "شراء" : "بيع"} — درجة ${input.grade} | احتمال ${input.probability}% — التحليل جيد لكن شروط التنفيذ غير مكتملة بعد.`;
    case "APPROVED":
      return `إشارة ${direction === "BUY" ? "شراء" : "بيع"} قوية — درجة ${input.grade} | احتمال ${input.probability}% — جميع شروط البوابة مكتملة. التنفيذ يتطلب مراجعتك اليدوية.`;
  }
}

function resolveReasons(input: GoldRecommendationInput): string[] {
  const reasons: string[] = [];

  for (const c of input.committees) {
    if (!RELEVANT_COMMITTEE_IDS.has(c.committeeId)) continue;
    if (c.verdict === "PASS" || c.verdict === "WARN") {
      reasons.push(`${c.committeeName}: ${c.summary}`);
    }
  }

  if (input.rrRatio !== undefined) {
    reasons.push(`نسبة R/R: ${input.rrRatio.toFixed(2)}:1`);
  }

  return reasons.slice(0, 8);
}

function resolveWarnings(input: GoldRecommendationInput): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const w of input.guardWarnings) {
    if (!seen.has(w)) { seen.add(w); result.push(w); }
  }

  for (const c of input.committees) {
    if (c.verdict === "WARN" && !RELEVANT_COMMITTEE_IDS.has(c.committeeId)) {
      const text = `${c.committeeName}: ${c.summary}`;
      if (!seen.has(text)) { seen.add(text); result.push(text); }
    }
  }

  return result.slice(0, 6);
}

function resolveBlockers(input: GoldRecommendationInput): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const b of input.guardBlockers) {
    if (!seen.has(b)) { seen.add(b); result.push(b); }
  }

  for (const c of input.committees) {
    if (c.verdict === "BLOCK") {
      const text = `${c.committeeName}: ${c.summary}`;
      if (!seen.has(text)) { seen.add(text); result.push(text); }
    }
  }

  return result.slice(0, 6);
}

function resolveExecutionModeLabel(
  mode: string,
  killSwitch: boolean,
  gateOpen: boolean,
): string {
  if (killSwitch)             return "Kill Switch مفعّل — التنفيذ موقوف";
  if (mode === "READ_ONLY")   return "مغلق — التنفيذ محظور من الإعدادات";
  if (gateOpen)               return "جاهز للمراجعة النهائية";
  if (mode === "DEMO_ARMED")  return "MT5 مفعّل — بانتظار استيفاء شروط البوابة";
  if (mode === "DEMO_PREVIEW") return "معاينة — جاهز للمراجعة";
  return "—";
}

function resolveRiskSummary(input: GoldRecommendationInput): string {
  const parts: string[] = [];
  if (input.riskUsd > 0) parts.push(`خطر: $${input.riskUsd}`);
  if (input.rrRatio !== undefined) parts.push(`R/R: ${input.rrRatio.toFixed(2)}:1`);
  if (input.estimatedLot !== undefined && input.estimatedLot > 0) {
    parts.push(`لوت: ${input.estimatedLot.toFixed(2)}`);
  }
  if (input.riskPercentOfEquity !== undefined) {
    parts.push(`${input.riskPercentOfEquity.toFixed(1)}% من الرصيد`);
  }
  return parts.length > 0 ? parts.join(" | ") : "—";
}

function resolveNextAction(
  status: RecommendationStatus,
  input: GoldRecommendationInput,
): string {
  switch (status) {
    case "BLOCKED":
      return "راجع أسباب المنع أدناه — أصلح المشكلة قبل إعادة التحليل.";
    case "NO_TRADE":
      if (input.analysisStatus === "insufficient_data" || input.analysisStatus === "stale_data") {
        return "زامن الشموع وتأكد من اتصال MT5 ثم أعد التحليل.";
      }
      return "انتظر إشارة تقنية أوضح — تحقق من تطابق الفريمات.";
    case "WATCH":
      return "راقب السوق — انتظر تحسّن درجة الإشارة قبل الدراسة الجدية.";
    case "CANDIDATE":
      return "راجع نتائج اللجان — أصلح التحذيرات ثم أعد التحليل للترقي.";
    case "EXPERIMENTAL":
      return input.killSwitchEnabled
        ? "أوقف Kill Switch من الإعدادات — ثم تحقق من شروط البوابة."
        : input.executionMode === "READ_ONLY"
          ? "فعّل وضع التنفيذ من الإعدادات للمتابعة."
          : "أكمل شروط البوابة (السبريد / LTP / RR) ثم سيُتاح زر التنفيذ.";
    case "APPROVED":
      return "اضغط زر 'تنفيذ عبر MT5' أدناه — راجع الخطة وأكّد يدوياً.";
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildGoldRecommendation(
  input: GoldRecommendationInput,
): GoldRecommendation {
  const status    = resolveStatus(input);
  const direction = resolveDirection(input);

  return {
    recommendationStatus: status,
    direction,
    confidencePercent:   Math.round(input.probability),
    grade:               input.grade,
    title:               resolveTitle(status, direction),
    summary:             resolveSummary(status, input, direction),
    reasons:             resolveReasons(input),
    warnings:            resolveWarnings(input),
    blockers:            resolveBlockers(input),
    executionAllowed:    input.executionGateOpen,
    executionModeLabel:  resolveExecutionModeLabel(
      input.executionMode,
      input.killSwitchEnabled,
      input.executionGateOpen,
    ),
    riskSummary: resolveRiskSummary(input),
    nextAction:  resolveNextAction(status, input),
  };
}
