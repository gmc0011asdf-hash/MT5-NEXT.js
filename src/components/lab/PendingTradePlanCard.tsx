"use client";

/**
 * PendingTradePlanCard — Gold Pending Trade Plans v1
 * ─────────────────────────────────────────────────────────────────────────────
 * عرض خطط الصفقات المستقبلية المحتملة (Pending).
 * ⚠️ لا إرسال تلقائي — لا order_send إلا بتأكيد يدوي checkbox.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type PendingPlanType = "SELL_LIMIT" | "BUY_LIMIT" | "SELL_STOP" | "BUY_STOP";
export type PendingPlanStatus = "WATCHING" | "READY_TO_SEND" | "CANCELED" | "EXPIRED";

export type PendingTradePlan = {
  id:               string;
  pendingType:      PendingPlanType;
  status:           PendingPlanStatus;
  symbol:           string;
  timeframe?:       string;
  direction?:       string;
  triggerPrice:     number;
  stopLoss:         number;
  takeProfit1?:     number;
  takeProfit2?:     number;
  takeProfit3?:     number;
  lot?:             number;
  riskUsd?:         number;
  conditionText?:   string;
  reason?:          string;
  targetPreference?: string;
  createdAt:        number;
};

const TYPE_LABEL: Record<PendingPlanType, string> = {
  SELL_LIMIT: "بيع محدد (Sell Limit)",
  BUY_LIMIT:  "شراء محدد (Buy Limit)",
  SELL_STOP:  "بيع عند كسر (Sell Stop)",
  BUY_STOP:   "شراء عند كسر (Buy Stop)",
};

const TYPE_COLOR: Record<PendingPlanType, string> = {
  SELL_LIMIT: "border-red-500/30 bg-red-500/5",
  BUY_LIMIT:  "border-emerald-500/30 bg-emerald-500/5",
  SELL_STOP:  "border-orange-500/30 bg-orange-500/5",
  BUY_STOP:   "border-sky-500/30 bg-sky-500/5",
};

function fmt(v: number | undefined, d = 5): string {
  return v != null ? v.toFixed(d) : "—";
}

export function PendingTradePlanCard({
  plan,
  onCancel,
}: {
  plan:      PendingTradePlan;
  onCancel?: (id: string) => void;
}) {
  const isSell = plan.pendingType.startsWith("SELL");
  const dirCls = isSell ? "text-red-300" : "text-emerald-300";

  return (
    <div dir="rtl" className={`rounded-xl border ${TYPE_COLOR[plan.pendingType]} p-4 space-y-3`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            أمر معلّق محتمل
          </span>
          <p className={`text-sm font-bold mt-0.5 ${dirCls}`}>
            {TYPE_LABEL[plan.pendingType]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300/80">
            {plan.status === "WATCHING" ? "◎ مراقبة" :
             plan.status === "READY_TO_SEND" ? "✓ جاهز" :
             plan.status === "CANCELED" ? "✗ ملغي" : "منتهي"}
          </span>
          {onCancel && plan.status === "WATCHING" && (
            <button
              type="button"
              onClick={() => onCancel(plan.id)}
              className="rounded border border-zinc-500/20 bg-zinc-800/30 px-1.5 py-0.5 text-[9px] text-zinc-400/70 hover:text-red-400/80 transition-colors"
            >
              إلغاء
            </button>
          )}
        </div>
      </div>

      {/* Price levels */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="rounded border border-border/20 bg-background/20 px-2 py-1.5">
          <span className="text-[9px] text-muted-foreground">سعر الدخول</span>
          <p className={`text-sm font-mono font-bold ${dirCls}`}>{fmt(plan.triggerPrice)}</p>
        </div>
        <div className="rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5">
          <span className="text-[9px] text-muted-foreground">وقف الخسارة</span>
          <p className="text-sm font-mono text-red-300">{fmt(plan.stopLoss)}</p>
        </div>
        {plan.takeProfit1 != null && (
          <div className="rounded border border-emerald-500/15 bg-emerald-500/5 px-2 py-1.5">
            <span className="text-[9px] text-muted-foreground">TP1</span>
            <p className="text-sm font-mono text-emerald-300/80">{fmt(plan.takeProfit1)}</p>
          </div>
        )}
        {plan.takeProfit2 != null && (
          <div className="rounded border border-emerald-500/20 bg-emerald-500/8 px-2 py-1.5">
            <span className="text-[9px] text-muted-foreground">TP2 ✓</span>
            <p className="text-sm font-mono font-bold text-emerald-200">{fmt(plan.takeProfit2)}</p>
          </div>
        )}
      </div>

      {/* Risk */}
      {(plan.lot || plan.riskUsd) && (
        <div className="flex flex-wrap gap-3 text-[11px]">
          {plan.lot != null && (
            <span className="text-muted-foreground">لوت: <span className="font-mono font-bold text-foreground/80">{plan.lot.toFixed(2)}</span></span>
          )}
          {plan.riskUsd != null && (
            <span className="text-muted-foreground">خطر: <span className="font-mono text-foreground/80">${plan.riskUsd.toFixed(2)}</span></span>
          )}
        </div>
      )}

      {/* Condition */}
      {plan.conditionText && (
        <div className="rounded-md border border-amber-500/15 bg-amber-500/5 px-3 py-2">
          <p className="text-[10px] text-muted-foreground mb-0.5">الشرط:</p>
          <p className="text-xs text-amber-300/80 leading-relaxed">{plan.conditionText}</p>
        </div>
      )}

      {/* Pending-only notice */}
      <div className="rounded border border-cyan-500/15 bg-cyan-500/5 px-3 py-1.5">
        <p className="text-[10px] text-cyan-300/70">
          ⓘ الأمر المعلّق مقترح للعرض فقط — إرسال الأوامر المعلقة إلى MT5 سيُضاف في مرحلة لاحقة.
        </p>
      </div>

      <p className="text-[9px] text-muted-foreground/40 italic border-t border-border/20 pt-2">
        خطة مستقبلية محتملة — تحليل استرشادي — ليس توصية مالية.
      </p>
    </div>
  );
}
