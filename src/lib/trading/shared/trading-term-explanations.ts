/**
 * trading-term-explanations.ts — B3.1
 * شروحات المصطلحات التداولية بالعربية.
 * لا تنفيذ تداول — قراءة فقط — للعرض التوضيحي فقط.
 */

// ─── هيكل السوق (B1) ─────────────────────────────────────────────────────────

export const STRUCTURE_POINT_EXPLANATIONS: Record<string, string> = {
  HH: "قمة أعلى — صنع السعر قمة أعلى من السابقة، دليل على استمرار الصعود.",
  HL: "قاع أعلى — ارتد السعر من مستوى أعلى من القاع السابق، يدعم استمرار الصعود.",
  LH: "قمة أدنى — فشل السعر في تجاوز القمة السابقة، قد يدل على ضعف الصعود.",
  LL: "قاع أدنى — كسر السعر قاعاً سابقاً، قد يدعم استمرار الهبوط.",
};

export const STRUCTURE_POINT_LABEL: Record<string, string> = {
  HH: "قمة ↑↑",
  HL: "قاع ↑",
  LH: "قمة ↓",
  LL: "قاع ↓↓",
};

export const TREND_STATE_EXPLANATIONS: Record<string, string> = {
  BULLISH:    "ترند صاعد — السوق يصنع قمم وقيعان أعلى باستمرار.",
  BEARISH:    "ترند هابط — السوق يصنع قمم وقيعان أدنى باستمرار.",
  RANGE:      "نطاق سعري — السعر يتحرك بين دعم ومقاومة دون اتجاه واضح. الدخول من منتصفه أضعف.",
  TRANSITION: "مرحلة انتقال — السوق ليس واضح الاتجاه بعد وقد يكون في بداية تحول.",
};

export const BOS_EXPLANATION =
  "كسر هيكلي — السعر كسر قمة أو قاع مهم باتجاه الحركة. يُعدّ تأكيداً أقوى من مجرد شمعة.";

export const CHOCH_EXPLANATION =
  "تغير سلوك السعر (Change of Character) — أول إشارة محتملة على أن الاتجاه السابق بدأ يتغير.";

// ─── الشموع (B2) ──────────────────────────────────────────────────────────────

export const CANDLE_PATTERN_EXPLANATIONS: Record<string, string> = {
  BULLISH_ENGULFING:    "شمعة ابتلاعية صاعدة — جسم الشمعة الصاعدة ابتلع جسم الهابطة السابقة. ضغط شرائي قوي.",
  BEARISH_ENGULFING:    "شمعة ابتلاعية هابطة — جسم الشمعة الهابطة ابتلع جسم الصاعدة السابقة. ضغط بيعي قوي.",
  PIN_BAR_BULLISH:      "Pin Bar صاعد — ذيل سفلي طويل يدل أن السعر حاول الهبوط ثم رُفض بقوة.",
  PIN_BAR_BEARISH:      "Pin Bar هابط — ذيل علوي طويل يدل أن السعر حاول الصعود ثم رُفض بقوة.",
  DOJI:                 "شمعة تردد — جسم صغير جداً. لا حسم بين المشترين والبائعين.",
  STRONG_BULLISH_CLOSE: "إغلاق صاعد قوي — أغلقت الشمعة قرب قمتها. زخم شرائي مستمر.",
  STRONG_BEARISH_CLOSE: "إغلاق هابط قوي — أغلقت الشمعة قرب قاعها. زخم بيعي مستمر.",
  INSIDE_BAR:           "شمعة داخلية — الشمعة كاملة داخل نطاق السابقة. تردد وانتظار كسر واضح.",
  LIQUIDITY_SWEEP_HIGH: "سحب سيولة علوي — السعر كسر قمة مؤقتاً ثم عاد. قد يكون كسراً وهمياً.",
  LIQUIDITY_SWEEP_LOW:  "سحب سيولة سفلي — السعر كسر قاعاً مؤقتاً ثم عاد. قد يكون كسراً وهمياً.",
  FAKE_BREAKOUT_UP:     "كسر وهمي صاعد — السعر اخترق مستوى علوياً ثم فشل في الثبات. إشارة بيع محتملة.",
  FAKE_BREAKOUT_DOWN:   "كسر وهمي هابط — السعر اخترق مستوى سفلياً ثم فشل في الثبات. إشارة شراء محتملة.",
};

export const WICK_REJECTION_EXPLANATION =
  "رفض الذيل — سعر حاول الوصول لمستوى معين وتم رفضه، يظهر على شكل ذيل طويل في الشمعة.";

export const LIQUIDITY_SWEEP_EXPLANATION =
  "سحب السيولة — السعر يكسر قمة/قاع مؤقتاً لاصطياد أوامر الوقف ثم يعود. غالباً يكون كسراً وهمياً.";

export const FAKE_BREAKOUT_EXPLANATION =
  "الكسر الوهمي — السعر يخترق مستوى مهماً ثم يفشل في الثبات فوقه/تحته. يكشف ضعف الحركة.";

// ─── المناطق (B3) ────────────────────────────────────────────────────────────

export const ZONE_TYPE_EXPLANATIONS: Record<string, string> = {
  SUPPLY:              "منطقة عرض — منطقة يُحتمل وجود ضغط بيع فيها. يُفضَّل البيع قربها لا الشراء.",
  DEMAND:              "منطقة طلب — منطقة يُحتمل وجود ضغط شراء فيها. يُفضَّل الشراء قربها.",
  BULLISH_ORDER_BLOCK: "Order Block صاعد — آخر شمعة هابطة قبل اندفاع صاعد قوي. قد يعود السعر لاختبارها.",
  BEARISH_ORDER_BLOCK: "Order Block هابط — آخر شمعة صاعدة قبل اندفاع هابط قوي. قد يعود السعر لاختبارها.",
  BULLISH_FVG:         "فجوة سعرية صاعدة (FVG) — منطقة اندفاع سريع صاعد لم يحصل فيها تداول متوازن. قد يعود السعر لملئها.",
  BEARISH_FVG:         "فجوة سعرية هابطة (FVG) — منطقة اندفاع سريع هابط لم يحصل فيها تداول متوازن. قد يعود السعر لملئها.",
  SUPPORT:             "دعم — مستوى سعري يُحتمل أن يوقف الهبوط.",
  RESISTANCE:          "مقاومة — مستوى سعري يُحتمل أن يوقف الصعود.",
};

export const PREMIUM_DISCOUNT_EXPLANATIONS: Record<string, string> = {
  PREMIUM:  "منطقة مرتفعة داخل النطاق — السعر في الجزء العلوي. غالباً أفضل للبيع من الشراء.",
  DISCOUNT: "منطقة منخفضة داخل النطاق — السعر في الجزء السفلي. غالباً أفضل للشراء من البيع.",
  MID:      "منتصف النطاق — لا أفضلية واضحة. الدخول من هنا أضعف من الدخول عند الأطراف.",
  UNKNOWN:  "الموضع غير محدد — يحتاج نطاق سعري واضح.",
};

export const FVG_EXPLANATION =
  "الفجوة السعرية / Imbalance — منطقة اندفاع سريع لم يحصل فيها تداول متوازن. قد يعود السعر لاختبارها أو ملئها.";

export const ORDER_BLOCK_EXPLANATION =
  "Order Block — آخر شمعة عكسية قبل اندفاع قوي. تمثل منطقة اهتمام مؤسسي محتملة.";

// ─── ملاحظة عامة ─────────────────────────────────────────────────────────────

export const GENERAL_DISCLAIMER =
  "هذه المصطلحات لا تعني دخولاً مباشراً، بل تُستخدم كأدلة ضمن قرار اللجان.";

// ─── Getter functions ─────────────────────────────────────────────────────────

export function getStructurePointExplanation(type: "HH" | "HL" | "LH" | "LL"): string {
  return STRUCTURE_POINT_EXPLANATIONS[type] ?? type;
}

export function getZoneTypeExplanation(type: string): string {
  return ZONE_TYPE_EXPLANATIONS[type] ?? type;
}

export function getCandlePatternExplanation(type: string): string {
  return CANDLE_PATTERN_EXPLANATIONS[type] ?? type;
}

// ─── Fibonacci (B4) ──────────────────────────────────────────────────────────

export const FIBONACCI_EXPLANATIONS: Record<string, string> = {
  Fibonacci:    "أداة تقيس مناطق التصحيح والأهداف المحتملة بناءً على آخر موجة سعرية.",
  GoldenZone:   "منطقة بين 50% و61.8% من التصحيح، يستخدمها بعض المتداولين كمنطقة اهتمام، لكنها لا تكفي وحدها للدخول.",
  Retracement:  "تصحيح — رجوع السعر جزئياً بعد موجة قوية. مستويات 38.2% و50% و61.8% الأكثر متابعة.",
  Extension:    "امتداد — مستويات محتملة للأهداف بعد استمرار الحركة (127.2% و161.8% و200%).",
  SwingUnknown: "اتجاه الموجة غير واضح — Fibonacci هنا للمراقبة فقط وليس للدخول.",
  ClosestFib:   "أقرب مستوى Fibonacci للسعر الحالي، لكنه يحتاج توافقاً مع الهيكل والمناطق والشموع.",
  "50.0%":     "منتصف الموجة — أحد أهم مستويات التصحيح وأكثرها متابعة من المتداولين.",
  "61.8%":     "المستوى الذهبي — تصحيح 61.8% يُعدّ الأعمق ضمن Golden Zone.",
  "38.2%":     "تصحيح طفيف — يدعم استمرار القوة الأصلية إذا وقف السعر عنده.",
  "78.6%":     "تصحيح عميق — قد يدل على ضعف الموجة الأصلية.",
};

export function getTradingTermExplanation(term: string): string {
  const all: Record<string, string> = {
    ...STRUCTURE_POINT_EXPLANATIONS,
    ...CANDLE_PATTERN_EXPLANATIONS,
    ...ZONE_TYPE_EXPLANATIONS,
    ...PREMIUM_DISCOUNT_EXPLANATIONS,
    ...FIBONACCI_EXPLANATIONS,
    BOS:    BOS_EXPLANATION,
    CHoCH:  CHOCH_EXPLANATION,
    ...TREND_STATE_EXPLANATIONS,
  };
  return all[term] ?? term;
}
