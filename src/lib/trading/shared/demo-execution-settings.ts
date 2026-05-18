/**
 * demo-execution-settings.ts — A25
 * ─────────────────────────────────────────────────────────────────────────────
 * إعدادات وضع التنفيذ التجريبي لـ MT5 Demo Guard.
 *
 * ⚠️ لا تنفيذ تداول — لا order_send — لا secrets في هذا الملف.
 * هذه الإعدادات تُخزَّن في localStorage فقط — لا Convex — لا schema change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Execution Mode ───────────────────────────────────────────────────────────

export type ExecutionMode = "READ_ONLY" | "DEMO_PREVIEW" | "DEMO_ARMED";

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  READ_ONLY:    "تنفيذ MT5 مغلق من الإعدادات",
  DEMO_PREVIEW: "معاينة تنفيذ المنصة — جاهز للمراجعة",
  DEMO_ARMED:   "MT5 مفعّل — جاهز للمراجعة النهائية",
};

export const EXECUTION_BUTTON_TEXT: Record<ExecutionMode, string> = {
  READ_ONLY:    "تنفيذ MT5 مغلق من إعدادات النظام",
  DEMO_PREVIEW: "جاهز للمراجعة — بانتظار تفعيل التنفيذ",
  DEMO_ARMED:   "تنفيذ عبر MT5 — بانتظار المراجعة النهائية",
};

// ─── System Execution Mode — يعكس وضع النظام الحاكم لا نوع الحساب ────────────

export type SystemExecutionMode =
  | "READ_ONLY"
  | "EXECUTION_LOCKED"
  | "READY_FOR_REVIEW"
  | "BLOCKED_BY_GOVERNANCE";

export const SYSTEM_EXECUTION_MODE_LABELS: Record<SystemExecutionMode, string> = {
  READ_ONLY:            "مغلق — التنفيذ محظور",
  EXECUTION_LOCKED:     "مقفل — Kill Switch أو READ_ONLY",
  READY_FOR_REVIEW:     "جاهز للمراجعة النهائية",
  BLOCKED_BY_GOVERNANCE: "محظور — قواعد الحوكمة",
};

export function resolveSystemExecutionMode(
  executionMode: ExecutionMode,
  killSwitchOn: boolean,
  governanceBlock: boolean,
): SystemExecutionMode {
  if (governanceBlock)                             return "BLOCKED_BY_GOVERNANCE";
  if (killSwitchOn || executionMode === "READ_ONLY") return "EXECUTION_LOCKED";
  if (executionMode === "DEMO_PREVIEW")            return "READY_FOR_REVIEW";
  return "READY_FOR_REVIEW";
}

// ─── Settings Type ────────────────────────────────────────────────────────────

export type DemoExecutionSettings = {
  executionMode:           ExecutionMode;
  killSwitchEnabled:       boolean;
  isConfirmedDemo:         boolean;  // يجب تأكيده يدوياً — لا يمكن اكتشافه تلقائياً
  maxRiskUsdPerTrade:      number;
  maxTradesPerDay:         number;
  maxOpenPositions:        number;
  allowedExecutionSymbols: string;   // فاصلة بين الرموز — فارغ = كل الرموز مسموحة
  minRewardRiskRatio:      number;
  maxSpreadPoints:         number;
};

export const DEFAULT_DEMO_SETTINGS: DemoExecutionSettings = {
  executionMode:           "READ_ONLY",
  killSwitchEnabled:       true,
  isConfirmedDemo:         false,
  maxRiskUsdPerTrade:      50,
  maxTradesPerDay:         3,
  maxOpenPositions:        2,
  allowedExecutionSymbols: "",
  minRewardRiskRatio:      1.5,
  maxSpreadPoints:         30,
};

// ─── Eligibility Result ───────────────────────────────────────────────────────

export type ExecutionEligibility = {
  eligible:        boolean;
  blockedReasons:  string[];
  executionMode:   ExecutionMode;
  killSwitchOn:    boolean;
  isDemoConfirmed: boolean;
  symbolAllowed:   boolean;
  rrOk:            boolean;
  spreadOk:        boolean;
  riskOk:          boolean;
  buttonText:      string;
};

// ─── Execution Request Contract — A26.1 ──────────────────────────────────────
// عقد طلب التنفيذ التجريبي — Preview فقط — لا order_send — لا تنفيذ تداول

export type ExecutionRequestPreview = {
  platform:                   "MT5";
  accountMode:                "DEMO_ONLY";  // internal API contract — not user-facing
  systemMode:                 SystemExecutionMode;
  symbol:                     string;
  orderType:                  string;             // e.g. "BUY_MARKET_PREVIEW"
  direction:                  "bullish" | "bearish" | null;
  entryPrice:                 number | undefined;
  stopLoss:                   number | undefined;
  takeProfit:                 number | undefined;
  estimatedLot:               number | undefined;
  riskUsd:                    number;
  rrRatio:                    number | undefined;
  currentBid:                 number | undefined;
  currentAsk:                 number | undefined;
  spreadPoints:               number | undefined;
  decisionId?:                string;
  generatedAt:                number;
  requiresManualConfirmation: true;
  executionEnabled:           false;
};

// ─── localStorage helpers ─────────────────────────────────────────────────────

export const DEMO_SETTINGS_KEY = "mt5-demo-exec-settings-v1";

export function loadDemoSettings(): DemoExecutionSettings {
  if (typeof window === "undefined") return { ...DEFAULT_DEMO_SETTINGS };
  try {
    const raw = localStorage.getItem(DEMO_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_DEMO_SETTINGS };
    return {
      ...DEFAULT_DEMO_SETTINGS,
      ...(JSON.parse(raw) as Partial<DemoExecutionSettings>),
    };
  } catch {
    return { ...DEFAULT_DEMO_SETTINGS };
  }
}

export function saveDemoSettings(s: DemoExecutionSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DEMO_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // quota exceeded — silent fail
  }
}
