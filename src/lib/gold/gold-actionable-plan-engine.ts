/**
 * gold-actionable-plan-engine.ts — Gold Actionable Trade Recommendation v1
 * ─────────────────────────────────────────────────────────────────────────────
 * بدلاً من عرض "ممنوع" أو "محظور" فقط، يقترح النظام خطة عملية بديلة
 * مبنية على التحليل الفني والسياق الحالي.
 *
 * ⚠️ لا order_send — لا تنفيذ — لا تغيير للحوكمة — قرار عرض فقط.
 * ⚠️ Hard Blocks تمنع دائماً — Soft Blocks تقترح تجربة أو انتظاراً.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionablePlanType =
  | "EXECUTE_NOW"             // شروط التنفيذ المباشر مكتملة
  | "EXPERIMENTAL_EXECUTION"  // Hard Blocks سليمة — Soft Blocks مقبولة في EXPERIMENTAL
  | "WAIT_FOR_CANDLE_CLOSE"   // الشمعة لم تُغلق أو bias يعاكس الاتجاه
  | "WAIT_FOR_CONFIRMATION"   // الزخم ضعيف أو النطاق غير محسوم
  | "PENDING_LIMIT"           // السعر في مكان غير مناسب — اقتراح Limit
  | "PENDING_STOP"            // اقتراح أمر Stop عند كسر مستوى
  | "NO_TRADE"                // لا توجد فرصة منطقية
  | "HARD_BLOCKED";           // بلوكات تقنية صارمة — لا بديل حتى تُصلح

export type ActionablePlan = {
  planType:             ActionablePlanType;
  title:                string;
  summary:              string;
  reason:               string;
  activationConditions: string[];
  whyNotNow:            string | null;

  // Plan data (من selectedGoldPlan / effectivePreview)
  direction:   "BUY" | "SELL" | null;
  entryType:   "MARKET" | "LIMIT" | "STOP" | null;
  entry:       number | null;
  stopLoss:    number | null;
  takeProfit:  number | null;
  lot:         number | null;
  rrRatio:     number | null;
  riskUsd:     number | null;

  canExecuteNow: boolean; // true = الزر الحالي (تجربة/مباشر) يعمل
  isPendingOnly: boolean; // true = مقترح للعرض فقط — لا MT5 الآن
};

export type ActionablePlanInput = {
  // Gate state
  hardBlocksInEffect:      number;
  softBlocksInEffect:      number;
  canOpenGoldExperimental: boolean;
  executionPolicy:         "STRICT" | "EXPERIMENTAL";
  recommendationStatus:    string;

  // Analysis
  analysisStatus:  string;
  direction?:      "bullish" | "bearish";

  // Market structure
  marketTrendState?: "BULLISH" | "BEARISH" | "RANGE" | "TRANSITION";
  rangeDetected?:    boolean;

  // Candlestick
  candlestickBias?:    "BUY" | "SELL" | "NEUTRAL";
  candlestickQuality?: "STRONG" | "NORMAL" | "WEAK" | "SUSPICIOUS";
  latestCandleClosed?: boolean;

  // Price position
  pricePosition?: "PREMIUM" | "DISCOUNT" | "MID" | "UNKNOWN";

  // Momentum indicators
  rsi14?:       number;
  momentumBias?: string;  // "BULLISH" | "BEARISH" | "NEUTRAL"

  // Selected plan data
  planEntry?:     number | null;
  planSL?:        number | null;
  planTP?:        number | null;   // TP2 (main target)
  planLot?:       number | null;
  planRR?:        number | null;   // rr2
  planRiskUsd?:   number | null;
  planDirection?: "BUY" | "SELL" | "WAIT";
  planEntryType?: "MARKET" | "LIMIT" | "STOP" | "WAIT";

  softBlockReasons: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMomentumWeak(input: ActionablePlanInput): boolean {
  const dir = input.direction;
  if (!dir) return false;

  // Momentum bias check (from indicators.momentumBias)
  if (input.momentumBias) {
    const mb = input.momentumBias.toUpperCase();
    if (dir === "bullish" && mb === "BEARISH") return true;
    if (dir === "bearish" && mb === "BULLISH") return true;
  }

  // RSI neutral zone or opposing
  if (input.rsi14 !== undefined) {
    if (dir === "bullish" && input.rsi14 < 45) return true;
    if (dir === "bearish" && input.rsi14 > 55) return true;
    if (input.rsi14 >= 45 && input.rsi14 <= 55) return true; // neutral RSI
  }

  return false;
}

function isCandleConflict(input: ActionablePlanInput): boolean {
  if (!input.candlestickBias || !input.direction) return false;
  const dirBuy = input.direction === "bullish";
  const cs     = input.candlestickBias;
  if (dirBuy  && cs === "SELL") return true;
  if (!dirBuy && cs === "BUY")  return true;
  return false;
}

function isRange(input: ActionablePlanInput): boolean {
  return input.marketTrendState === "RANGE" || (input.rangeDetected === true);
}

function planData(input: ActionablePlanInput) {
  return {
    direction:  (input.planDirection === "BUY" || input.planDirection === "SELL")
                  ? input.planDirection
                  : input.direction === "bullish" ? "BUY" : input.direction === "bearish" ? "SELL" : null,
    entryType:  (input.planEntryType === "MARKET" || input.planEntryType === "LIMIT" || input.planEntryType === "STOP")
                  ? input.planEntryType
                  : "MARKET",
    entry:      input.planEntry ?? null,
    stopLoss:   input.planSL   ?? null,
    takeProfit: input.planTP   ?? null,
    lot:        input.planLot  ?? null,
    rrRatio:    input.planRR   ?? null,
    riskUsd:    input.planRiskUsd ?? null,
  } as const;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildActionablePlan(input: ActionablePlanInput): ActionablePlan {
  const dir    = input.direction;
  const dirAr  = dir === "bullish" ? "شراء ↑" : dir === "bearish" ? "بيع ↓" : "محايد";
  const pd     = planData(input);

  // ── 1. Hard Blocked ────────────────────────────────────────────────────────
  if (input.hardBlocksInEffect > 0) {
    return {
      planType:    "HARD_BLOCKED",
      title:       "ممنوع تقنيًا — أصلح المشكلات أولاً",
      summary:     `توجد ${input.hardBlocksInEffect} عوائق تقنية تمنع التنفيذ في كلا وضعي STRICT و EXPERIMENTAL. لا يمكن اقتراح أي خطة حتى تُحل.`,
      reason:      "Hard Blocks تمنع دائماً — Kill Switch أو بيانات قديمة أو سبريد مرتفع أو SL/TP غير محدد.",
      activationConditions: ["أصلح العوائق التقنية أدناه ثم أعد التحليل"],
      whyNotNow:   `${input.hardBlocksInEffect} عائق تقني مباشر`,
      ...pd,
      canExecuteNow: false,
      isPendingOnly: false,
    };
  }

  // ── 2. No Opportunity ──────────────────────────────────────────────────────
  if (input.analysisStatus !== "opportunity") {
    const reason =
      input.analysisStatus === "insufficient_data" ? "البيانات غير كافية — زامن الشموع وتأكد من اتصال MT5" :
      input.analysisStatus === "stale_data"         ? "البيانات قديمة — تحقق من آخر tick وأعد التحليل" :
      input.analysisStatus === "wait"               ? "السوق في انتظار — لا إشارة تقنية واضحة حالياً" :
      "التحليل رفض الإشارة — تعارض الأطر أو ضعف الإشارة";
    return {
      planType:    "NO_TRADE",
      title:       "لا توجد فرصة تداول حالياً",
      summary:     reason,
      reason:      "لم يُرصَد سيناريو تداول منطقي في البيانات الحالية.",
      activationConditions: ["انتظر إشارة تقنية واضحة", "تأكد من مزامنة الشموع مع MT5"],
      whyNotNow:   reason,
      direction:   null, entryType: null,
      entry: null, stopLoss: null, takeProfit: null,
      lot: null, rrRatio: null, riskUsd: null,
      canExecuteNow: false,
      isPendingOnly: false,
    };
  }

  // ── 3. EXECUTE_NOW — بوابة التنفيذ مفتوحة ────────────────────────────────
  if (input.recommendationStatus === "APPROVED") {
    return {
      planType:    "EXECUTE_NOW",
      title:       `خطة دخول مباشر — ${dirAr}`,
      summary:     "جميع شروط التنفيذ مكتملة. الخطة المهنية جاهزة — راجع وأكد يدوياً.",
      reason:      "درجة A أو A+ مع توافق الفريمات وسبريد مقبول وبوابة التنفيذ مفتوحة.",
      activationConditions: ["اضغط زر تنفيذ عبر MT5", "راجع Entry / SL / TP", "أكد checkbox التنفيذ"],
      whyNotNow:   null,
      ...pd,
      canExecuteNow: true,
      isPendingOnly: false,
    };
  }

  // ── 4. EXPERIMENTAL_EXECUTION — hard blocks سليمة، soft blocks فقط ────────
  if (input.canOpenGoldExperimental && input.softBlocksInEffect > 0) {
    const softList = input.softBlockReasons.slice(0, 3).join(" | ");
    return {
      planType:    "EXPERIMENTAL_EXECUTION",
      title:       `خطة تجربة محكومة — ${dirAr}`,
      summary:     `هذه ليست صفقة قوية، لكنها صالحة للاختبار لأن الشروط الفنية الأساسية سليمة. الجودة ضعيفة بسبب: ${softList || "حارس التنفيذ أصدر soft block"}.`,
      reason:      "Hard Blocks سليمة — Soft Blocks مقبولة في وضع EXPERIMENTAL.",
      activationConditions: [
        "اضغط زر 'تنفيذ تجربة MT5' أدناه",
        "لوت مخفّض للتجارب (من Risk Manager)",
        "راجع الشروط الفنية الأساسية: SL/TP/RR",
      ],
      whyNotNow:   `الجودة التحليلية ضعيفة: ${softList}`,
      ...pd,
      canExecuteNow: true,
      isPendingOnly: false,
    };
  }

  // ── 5. Market context decisions ────────────────────────────────────────────

  const inRange = isRange(input);
  const candleConflict = isCandleConflict(input);
  const momentumWeak = isMomentumWeak(input);

  // ── 5a. RANGE market ────────────────────────────────────────────────────────
  if (inRange) {
    // Selling from discount or buying from premium inside range = bad
    const badPricePosition =
      (dir === "bearish" && input.pricePosition === "DISCOUNT") ||
      (dir === "bullish" && input.pricePosition === "PREMIUM");

    if (badPricePosition) {
      const isDiscountSell = dir === "bearish" && input.pricePosition === "DISCOUNT";
      return {
        planType:    "PENDING_LIMIT",
        title:       isDiscountSell
          ? "Sell Limit مقترح — انتظر ارتداداً أعلى"
          : "Buy Limit مقترح — انتظر ارتداداً أدنى",
        summary:     isDiscountSell
          ? "السعر في منطقة Discount — البيع من هنا خطر. الخطة العملية: Sell Limit من منطقة Resistance/Premium أعلى، أو انتظار ارتداد السعر."
          : "السعر في منطقة Premium — الشراء من هنا خطر. الخطة العملية: Buy Limit من منطقة Support/Discount أدنى، أو انتظار تصحيح السعر.",
        reason:      `السوق في نطاق (RANGE) والسعر في منطقة ${input.pricePosition} — الدخول السوقي الآن غير مناسب.`,
        activationConditions: [
          isDiscountSell
            ? "انتظر ارتداد السعر لأعلى النطاق أو منطقة Resistance"
            : "انتظر تصحيح السعر لأسفل النطاق أو منطقة Support",
          "ضع Limit Order عند المستوى المحدد مع نفس SL/TP",
          "راقب الشمعة الأولى عند المستوى قبل التنفيذ",
        ],
        whyNotNow:   `دخول سوقي ${dirAr} من منطقة ${input.pricePosition} داخل نطاق — نسبة RR غير مناسبة.`,
        ...pd,
        entryType:   "LIMIT",
        canExecuteNow: false,
        isPendingOnly: true,
      };
    }

    // Inside range, not at extreme
    return {
      planType:    "WAIT_FOR_CONFIRMATION",
      title:       "انتظار كسر النطاق — لا دخول سوقي",
      summary:     "السوق في نطاق أفقي. الخطة العملية: انتظار كسر واضح أعلى أو أسفل النطاق مع إغلاق شمعة خارجه.",
      reason:      "تداول داخل النطاق بدون كسر مؤكد له احتمال عالٍ للارتداد.",
      activationConditions: [
        `انتظر إغلاق شمعة ${dirAr} خارج النطاق`,
        "تحقق من حجم الكسر وقوة الشمعة",
        "أعد التحليل بعد إغلاق شمعة H1",
      ],
      whyNotNow:   "السوق في نطاق — الدخول السوقي بدون كسر مؤكد يفتقر لتوجيه واضح.",
      ...pd,
      canExecuteNow: false,
      isPendingOnly: false,
    };
  }

  // ── 5b. Candlestick conflicts with direction ────────────────────────────────
  if (candleConflict) {
    const antiDir = dir === "bullish" ? "بيعية" : "شرائية";
    return {
      planType:    "WAIT_FOR_CANDLE_CLOSE",
      title:       `انتظار شمعة ${dir === "bullish" ? "صاعدة" : "هابطة"} مؤكدة`,
      summary:     `التحليل يميل لـ ${dirAr} لكن آخر شمعة أصدرت bias ${antiDir}. الخطة العملية: انتظار إغلاق شمعة تؤكد الاتجاه.`,
      reason:      `Candlestick bias يعاكس الاتجاه المقترح — الدخول الآن ضد الزخم الفوري.`,
      activationConditions: [
        `انتظر إغلاق شمعة H1 ${dir === "bullish" ? "صاعدة" : "هابطة"} قوية`,
        "تحقق من أن الشمعة تغلق في نفس اتجاه التحليل",
        "أعد التحليل مباشرة بعد الإغلاق",
      ],
      whyNotNow:   `آخر شمعة ${antiDir} — الدخول ضد bias الشمعة يرفع احتمالية Stop Loss المبكر.`,
      ...pd,
      canExecuteNow: false,
      isPendingOnly: false,
    };
  }

  // ── 5c. Candle quality weak + not closed ────────────────────────────────────
  if (
    (input.candlestickQuality === "WEAK" || input.candlestickQuality === "SUSPICIOUS") &&
    input.latestCandleClosed === false
  ) {
    return {
      planType:    "WAIT_FOR_CANDLE_CLOSE",
      title:       "انتظار إغلاق شمعة قوية",
      summary:     `جودة الشمعة الحالية ${input.candlestickQuality === "WEAK" ? "ضعيفة" : "مشبوهة"} والشمعة لم تُغلق. الخطة العملية: انتظار إغلاق لتأكيد الإشارة.`,
      reason:      "الدخول على شمعة لم تُغلق أو ذات جودة منخفضة يرفع احتمالية الفشل.",
      activationConditions: [
        "انتظر إغلاق الشمعة الحالية",
        "تأكد أن الشمعة تغلق قوية في اتجاه التحليل",
        "أعد التحليل بعد الإغلاق",
      ],
      whyNotNow:   `جودة الشمعة: ${input.candlestickQuality} — الشمعة مفتوحة.`,
      ...pd,
      canExecuteNow: false,
      isPendingOnly: false,
    };
  }

  // ── 5d. Weak momentum ──────────────────────────────────────────────────────
  if (momentumWeak) {
    const rsiNote = input.rsi14 !== undefined ? ` (RSI: ${input.rsi14.toFixed(0)})` : "";
    return {
      planType:    "WAIT_FOR_CONFIRMATION",
      title:       `انتظار تأكيد الزخم — ${dirAr}`,
      summary:     `التحليل يميل لـ ${dirAr}، لكن الزخم ضعيف حالياً${rsiNote}. الخطة العملية: انتظار تقاطع RSI أو MACD أو كسر قمة/قاع صغيرة.`,
      reason:      `الزخم لا يدعم الاتجاه بقوة — الدخول المبكر دون تأكيد يرفع مخاطر Stop Loss.`,
      activationConditions: [
        dir === "bullish"
          ? "انتظر RSI > 55 أو تقاطع MACD صاعد أو كسر قمة صغيرة"
          : "انتظر RSI < 45 أو تقاطع MACD هابط أو كسر قاع صغير",
        "أعد التحليل بعد إغلاق الشمعة التالية",
        "تحقق من توافق الفريمات الأعلى",
      ],
      whyNotNow:   `الزخم ضعيف${rsiNote} — الدخول دون تأكيد يفتقر لدعم تقني كافٍ.`,
      ...pd,
      canExecuteNow: false,
      isPendingOnly: false,
    };
  }

  // ── 5e. Has soft blocks + STRICT policy ────────────────────────────────────
  if (input.softBlocksInEffect > 0) {
    const softList = input.softBlockReasons.slice(0, 2).join(" — ") || "حارس جودة التنفيذ: soft block";
    return {
      planType:    "WAIT_FOR_CONFIRMATION",
      title:       `قابل للتجربة في EXPERIMENTAL — ${dirAr}`,
      summary:     `التحليل يميل لـ ${dirAr} لكن جودته محدودة: ${softList}. فعّل سياسة EXPERIMENTAL للتجربة، أو انتظر إشارة أقوى.`,
      reason:      "Soft Blocks تمنع الاعتماد الكامل في STRICT، لكنها لا تمنع التجربة المحكومة.",
      activationConditions: [
        "فعّل سياسة EXPERIMENTAL من الإعدادات",
        "أو انتظر تحسّن جودة الإشارة (درجة A/A+)",
      ],
      whyNotNow:   softList,
      ...pd,
      canExecuteNow: false,
      isPendingOnly: false,
    };
  }

  // ── 6. Fallback: CANDIDATE/WATCH recommendation ────────────────────────────
  const statusAr =
    input.recommendationStatus === "CANDIDATE" ? "مرشّح" :
    input.recommendationStatus === "WATCH"     ? "مراقبة" :
    input.recommendationStatus === "EXPERIMENTAL" ? "تجربة محكومة" : "متابعة";
  return {
    planType:    "WAIT_FOR_CONFIRMATION",
    title:       `${statusAr} — ${dirAr} — يحتاج تأكيد`,
    summary:     `الإشارة الحالية غير مكتملة الشروط للتنفيذ المباشر. الخطة العملية: انتظر تأكيداً إضافياً أو راقب إغلاق الشمعة التالية.`,
    reason:      `توصية النظام: ${statusAr} — الشروط لم تصل لمستوى EXECUTE_NOW.`,
    activationConditions: [
      "انتظر تحسّن درجة الإشارة إلى A أو A+",
      "تحقق من توافق الفريمات وقوة الزخم",
      "أعد التحليل بعد إغلاق شمعة H1",
    ],
    whyNotNow:   `توصية النظام ${statusAr} — لم تستوفِ شروط EXECUTE_NOW بعد.`,
    ...pd,
    canExecuteNow: false,
    isPendingOnly: false,
  };
}
