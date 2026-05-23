import type { RegimeClassification } from "./gold-regime-classifier";

/**
 * GOLD_PROFILE — ثوابت مركز الذهب المؤسسي
 * preferredTimeframes: هرم MTF المؤسسي للذهب
 *   M15 → إشارة الدخول   (threshold 30 دقيقة)
 *   H1  → تأكيد قصير     (threshold 2 ساعة)
 *   H4  → سياق متوسط     (threshold 8 ساعات)
 *   D1  → توجه كلي       (threshold 36 ساعة) — يعمل حتى أثناء إغلاق السوق
 */
export const GOLD_PROFILE = {
  symbol: "XAUUSD",
  modeName: "Gold Institutional Mode",
  preferredTimeframes: ["M15", "H1", "H4", "D1"] as const,
  /** حدود الجِدَّة لكل فريم زمني (بالميلي ثانية) */
  staleThresholdMs: {
    M15: 30 * 60 * 1000,
    H1:  2  * 60 * 60 * 1000,
    H4:  8  * 60 * 60 * 1000,
    D1:  36 * 60 * 60 * 1000,
  } as const,
  /** نقاط وقف الخسارة المقترحة لكل فريم (استرشادية — ليست توصية) */
  suggestedStopPoints: {
    M15: 200,
    H1:  400,
    H4:  800,
    D1:  2000,
  } as const,
  maxSpreadPoints: 30,
  defaultDecision: "WAIT" as const,
} as const;

export type GoldDecision = "WAIT" | "BLOCK";

export interface GoldDecisionResult {
  decision: GoldDecision;
  reasons: string[];
  nextAction: string;
}

export interface GoldConnectionState {
  mt5Connected: boolean;
  readOnly: boolean;
  xauusdFound: boolean;
  spread: number | null;
  lastPrice: number | null;
  symbolCount: number;
}

/**
 * runGoldDecisionEngine — v1
 * قراءة فقط — لا توصيات شراء/بيع — لا تنفيذ تداول.
 * BLOCK: اتصال مفقود / رمز مفقود / سبريد مرتفع / جودة شموع منعدمة.
 * WAIT : الحالة الافتراضية لجميع حالات السوق في هذه المرحلة.
 */
export function runGoldDecisionEngine(
  state: GoldConnectionState,
  regime?: RegimeClassification,
): GoldDecisionResult {
  const reasons: string[] = [];

  // ── اتصال MT5 ───────────────────────────────────────────────────────────────
  if (!state.mt5Connected) {
    reasons.push("MT5 غير متصل — لا يمكن تحليل السوق");
    return {
      decision: "BLOCK",
      reasons,
      nextAction: "تحقق من تشغيل MetaTrader 5 وخدمة الجسر على المنفذ 8010",
    };
  }

  // ── وجود XAUUSD ─────────────────────────────────────────────────────────────
  if (!state.xauusdFound) {
    reasons.push("XAUUSD غير موجود في قائمة الرموز المتاحة");
    return {
      decision: "BLOCK",
      reasons,
      nextAction: "أضف XAUUSD إلى Market Watch في MetaTrader 5 ثم أعد التحميل",
    };
  }

  // ── السبريد ──────────────────────────────────────────────────────────────────
  if (state.spread !== null && state.spread > GOLD_PROFILE.maxSpreadPoints) {
    reasons.push(
      `السبريد (${state.spread} نقطة) يتجاوز الحد الأقصى المقبول (${GOLD_PROFILE.maxSpreadPoints} نقطة)`,
    );
    return {
      decision: "BLOCK",
      reasons,
      nextAction: "انتظر انخفاض السبريد قبل التحليل — عادةً يرتفع السبريد في أوقات انخفاض السيولة",
    };
  }

  // ── الأسباب الإيجابية ────────────────────────────────────────────────────────
  reasons.push("MT5 متصل ويعمل بوضع القراءة فقط");
  reasons.push("XAUUSD متاح في Market Watch");

  if (!state.readOnly) {
    reasons.push("⚠️ وضع القراءة فقط غير مفعّل في استجابة الجسر — تحقق من إعدادات الخدمة");
  }

  if (state.symbolCount > 0) {
    reasons.push(`${state.symbolCount} رمز مرئي في Market Watch`);
  }

  // ── دمج نتيجة تصنيف السوق ──────────────────────────────────────────────────
  if (regime) {
    switch (regime.regime) {
      case "LowQuality":
        if (regime.extremelyLowQuality) {
          reasons.push(`جودة الشموع منعدمة — ${regime.reason}`);
          return {
            decision: "BLOCK",
            reasons,
            nextAction:
              "انتظر تحسن جودة بيانات السوق — قد يكون السوق مغلقاً أو السيولة منخفضة جداً",
          };
        }
        reasons.push(`⚠️ جودة الشموع منخفضة — ${regime.reason}`);
        break;
      case "DataMissing":
        reasons.push(`⚠️ بيانات غير كافية — ${regime.reason}`);
        break;
      case "NewsRiskPlaceholder":
        reasons.push("⚠️ تحقق من التقويم الاقتصادي — XAUUSD حساس لأخبار الاقتصاد الكلي");
        break;
      case "Trend":
        reasons.push(`نظام السوق: اتجاه مبدئي — ${regime.confidence} confidence`);
        break;
      case "Range":
        reasons.push(`نظام السوق: نطاق — ${regime.confidence} confidence`);
        break;
      default:
        break;
    }
  }

  return {
    decision: "WAIT",
    reasons,
    nextAction:
      "النظام جاهز للتحليل — اختر إطاراً زمنياً وابدأ التحليل في لوحة التحكم أدناه",
  };
}
