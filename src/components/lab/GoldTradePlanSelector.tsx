"use client";

/**
 * GoldTradePlanSelector — Gold Trade Plans Engine v2
 * اختيار خطة تداول → عرض Execution Preview + تحليل احترافي.
 * لا order_send — لا تنفيذ تلقائي — معاينة فقط.
 */

import { useState } from "react";
import type {
  GoldTradePlansResult,
  TradePlan,
  PlanType,
  ProposalStatus,
  ExecutionPreview,
  ExecutionPreviewStatus,
} from "@/lib/gold/gold-trade-plans-engine";

// ─── buildExecutionPreview ────────────────────────────────────────────────────

function buildExecutionPreview(plan: TradePlan): ExecutionPreview | null {
  if (
    plan.direction === "WAIT" ||
    plan.entry == null || plan.stopLoss == null ||
    plan.takeProfit1 == null || plan.takeProfit2 == null || plan.takeProfit3 == null ||
    plan.estimatedLot == null ||
    plan.rr1 == null || plan.rr2 == null || plan.rr3 == null
  ) return null;

  const status: ExecutionPreviewStatus =
    plan.proposalStatus === "EXECUTION_READY" ? "READY"  :
    plan.proposalStatus === "REVIEW"          ? "REVIEW" : "BLOCKED";

  return {
    symbol:           "XAUUSD",
    direction:        plan.direction,
    entryType:        plan.entryType,
    lot:              plan.estimatedLot,
    entry:            plan.entry,
    stopLoss:         plan.stopLoss,
    tp1:              plan.takeProfit1,
    tp2:              plan.takeProfit2,
    tp3:              plan.takeProfit3,
    rr1:              plan.rr1,
    rr2:              plan.rr2,
    rr3:              plan.rr3,
    riskUsd:          plan.suggestedRiskUsd,
    partialClosePlan: plan.partialClosePlan,
    status,
    statusReasons:    plan.proposalStatus === "BLOCKED" ? plan.blockers : plan.warnings,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const PREVIEW_CFG: Record<ExecutionPreviewStatus, { label: string; badgeClass: string; borderClass: string; bgClass: string }> = {
  READY:   { label: "جاهز للمراجعة النهائية", badgeClass: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", borderClass: "border-emerald-500/20", bgClass: "bg-emerald-500/5" },
  REVIEW:  { label: "للمراجعة — فحص مطلوب",   badgeClass: "text-amber-300 bg-amber-500/10 border-amber-500/30",     borderClass: "border-amber-500/20",  bgClass: "bg-amber-500/5" },
  BLOCKED: { label: "محظور — لا يجوز التنفيذ", badgeClass: "text-red-300 bg-red-500/10 border-red-500/30",           borderClass: "border-red-500/20",    bgClass: "bg-red-500/5" },
};

const PLAN_LABELS: Record<PlanType, { ar: string; short: string; btnBase: string; btnSel: string; riskPct: string }> = {
  CONSERVATIVE: { ar: "المحافظة",  short: "Conservative", btnBase: "border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/10",      btnSel: "border-sky-400/60 bg-sky-500/20 text-sky-200",         riskPct: "0.25%" },
  BALANCED:     { ar: "المتوازنة", short: "Balanced",     btnBase: "border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/10", btnSel: "border-amber-400/60 bg-amber-500/20 text-amber-200",   riskPct: "0.50%" },
  AGGRESSIVE:   { ar: "الهجومية",  short: "Aggressive",   btnBase: "border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/10", btnSel: "border-violet-400/60 bg-violet-500/20 text-violet-200", riskPct: "1.00%" },
  WAIT:         { ar: "انتظار",    short: "Wait",         btnBase: "border-zinc-500/30",                                                   btnSel: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",      riskPct: "—" },
};

const STATUS_BADGE: Record<ProposalStatus, string> = {
  EXECUTION_READY: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  REVIEW:          "text-amber-300 bg-amber-500/10 border-amber-500/20",
  BLOCKED:         "text-red-300 bg-red-500/10 border-red-500/20",
  WAIT:            "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  EXECUTION_READY: "جاهز",
  REVIEW:          "مراجعة",
  BLOCKED:         "محظور",
  WAIT:            "انتظار",
};

const TIMING_LABEL: Record<"NOW" | "WAIT" | "MONITOR", string> = {
  NOW:     "الآن ✓",
  WAIT:    "انتظار",
  MONITOR: "مراقبة",
};

function fmt(n: number | null | undefined, d = 2): string {
  return n != null ? n.toFixed(d) : "—";
}

function PriceRow({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between py-[3px] border-b border-border/10 last:border-0">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono tabular-nums ${cls || "text-foreground/85"}`}>{value}</span>
    </div>
  );
}

// ─── Execution Preview panel ──────────────────────────────────────────────────

function ExecutionPreviewPanel({ preview }: { preview: ExecutionPreview }) {
  const cfg       = PREVIEW_CFG[preview.status];
  const dirLabel  = preview.direction === "BUY" ? "↑ شراء" : "↓ بيع";
  const dirCls    = preview.direction === "BUY" ? "text-emerald-300 font-bold" : "text-red-300 font-bold";
  const entryNote =
    preview.entryType === "LIMIT"  ? "LIMIT — انتظار وصول السعر" :
    preview.entryType === "MARKET" ? "MARKET — بالسوق" : "—";

  return (
    <div className={`rounded-xl border ${cfg.borderClass} ${cfg.bgClass} p-4 space-y-4`} dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-foreground/90">معاينة التنفيذ — MT5 Order Preview</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">لا يُرسل أمر — معاينة فقط</p>
        </div>
        <span className={`inline-flex items-center rounded border px-2.5 py-0.5 text-xs font-semibold ${cfg.badgeClass}`}>
          {cfg.label}
        </span>
      </div>

      {/* Core fields */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-0">
        <div>
          <PriceRow label="الرمز"    value={preview.symbol} />
          <PriceRow label="الاتجاه" value={dirLabel} cls={dirCls} />
          <PriceRow label="نوع الأمر" value={entryNote} />
          <PriceRow label="الدخول"  value={fmt(preview.entry)} />
          <PriceRow label="وقف"     value={fmt(preview.stopLoss)} cls="text-red-300" />
          <PriceRow label="اللوت"   value={fmt(preview.lot, 2)} />
          <PriceRow label="المخاطرة" value={`$${fmt(preview.riskUsd)}`} />
        </div>
        <div>
          <PriceRow label="TP1 (30%)" value={fmt(preview.tp1)} cls="text-emerald-300/80" />
          <PriceRow label="TP2 (30%)" value={fmt(preview.tp2)} cls="text-emerald-300/90" />
          <PriceRow label="TP3 (40%)" value={fmt(preview.tp3)} cls="text-emerald-400" />
          <PriceRow label="RR1" value={`${fmt(preview.rr1, 1)}:1`} />
          <PriceRow label="RR2" value={`${fmt(preview.rr2, 1)}:1`} />
          <PriceRow label="RR3" value={`${fmt(preview.rr3, 1)}:1`} />
        </div>
      </div>

      {/* Partial close */}
      <div className="rounded-md border border-border/20 bg-background/20 px-3 py-2">
        <p className="text-[10px] text-muted-foreground mb-1.5">خطة الإغلاق الجزئي</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "عند TP1", pct: preview.partialClosePlan.tp1Pct },
            { label: "عند TP2", pct: preview.partialClosePlan.tp2Pct },
            { label: "عند TP3", pct: preview.partialClosePlan.tp3Pct },
          ].map(({ label, pct }) => (
            <div key={label} className="rounded bg-card/50 border border-border/20 px-2 py-1.5">
              <p className="text-[10px] font-bold text-foreground/85">{pct}%</p>
              <p className="text-[9px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Status reasons */}
      {preview.statusReasons.length > 0 && (
        <div className={`rounded-md border px-3 py-2 space-y-1 ${
          preview.status === "BLOCKED" ? "border-red-500/20 bg-red-500/5" : "border-amber-500/20 bg-amber-500/5"
        }`}>
          <p className={`text-[10px] font-medium ${preview.status === "BLOCKED" ? "text-red-300/80" : "text-amber-300/80"}`}>
            {preview.status === "BLOCKED" ? "أسباب المنع" : "ملاحظات للمراجعة"}
          </p>
          {preview.statusReasons.map((r, i) => (
            <p key={i} className={`text-[10px] leading-relaxed flex gap-1.5 ${preview.status === "BLOCKED" ? "text-red-300/70" : "text-amber-300/70"}`}>
              <span className="shrink-0 mt-0.5">•</span>{r}
            </p>
          ))}
        </div>
      )}

      <p className="text-[9px] text-muted-foreground/40 italic border-t border-border/20 pt-2">
        معاينة فقط — لا يتم إرسال أمر — استخدم زر "تنفيذ عبر MT5" أدناه بعد المراجعة النهائية.
      </p>
    </div>
  );
}

// ─── Professional analysis panel ─────────────────────────────────────────────

function ProfessionalAnalysis({ plan }: { plan: TradePlan }) {
  const { professional: pro } = plan;
  const timingCls =
    pro.timingAssessment === "NOW"     ? "text-emerald-300 font-semibold" :
    pro.timingAssessment === "MONITOR" ? "text-amber-300"                 : "text-zinc-400";

  return (
    <div className="rounded-xl border border-border/20 bg-card/30 p-4 space-y-3" dir="rtl">
      <p className="text-xs font-bold text-foreground/85">التحليل الاحترافي — الخطة المختارة</p>

      <div className="space-y-2 text-[11px] leading-relaxed">
        <div className="flex gap-2">
          <span className="text-amber-400/70 font-medium shrink-0 w-24">لماذا هذه الخطة؟</span>
          <span className="text-foreground/75">{pro.whyThisPlan}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-emerald-400/70 font-medium shrink-0 w-24">متى تدخل؟</span>
          <span className="text-foreground/75">{pro.whenToEnter}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-red-400/70 font-medium shrink-0 w-24">متى لا تدخل؟</span>
          <span className="text-foreground/75">{pro.whenNotToEnter}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground font-medium shrink-0 w-24">التوقيت</span>
          <span className={timingCls}>{TIMING_LABEL[pro.timingAssessment]}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-sky-400/70 font-medium shrink-0 w-24">فريم الدخول</span>
          <span className="text-foreground/75 font-mono">{pro.executionTimeframe}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-violet-400/70 font-medium shrink-0 w-24">فريم الإدارة</span>
          <span className="text-foreground/75 font-mono">{pro.managementTimeframe}</span>
        </div>
        {pro.mtfSupportingFrames.length > 0 && (
          <div className="flex gap-2">
            <span className="text-emerald-400/70 font-medium shrink-0 w-24">داعمة</span>
            <span className="text-emerald-300/70">{pro.mtfSupportingFrames.join(" , ")}</span>
          </div>
        )}
        {pro.mtfConflictingFrames.length > 0 && (
          <div className="flex gap-2">
            <span className="text-red-400/70 font-medium shrink-0 w-24">متعارضة</span>
            <span className="text-red-300/70">{pro.mtfConflictingFrames.join(" , ")}</span>
          </div>
        )}
        {plan.manualLotNote && (
          <div className="flex gap-2">
            <span className="text-amber-400/60 font-medium shrink-0 w-24">مقارنة اللوت</span>
            <span className="text-amber-300/60">{plan.manualLotNote}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="text-muted-foreground font-medium shrink-0 w-24">سبب اللوت</span>
          <span className="text-foreground/60 text-[10px]">{plan.lotReason}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GoldTradePlanSelector({
  plans,
  onSelectPlan,
}: {
  plans:          GoldTradePlansResult;
  onSelectPlan?:  (plan: TradePlan | null) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const { plans: tradePlans, bestPlanIdx } = plans;
  if (tradePlans.length === 1 && tradePlans[0].planType === "WAIT") return null;

  const selectedPlan    = selectedIdx != null ? tradePlans[selectedIdx] : null;
  const execPreview     = selectedPlan ? buildExecutionPreview(selectedPlan) : null;

  return (
    <div className="space-y-3" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground/90">اختر خطة للمراجعة</p>
        {selectedPlan && (
          <button type="button" onClick={() => { setSelectedIdx(null); onSelectPlan?.(null); }}
            className="text-[10px] text-muted-foreground hover:text-foreground/60">
            إلغاء الاختيار ✕
          </button>
        )}
      </div>

      {/* Plan selection buttons */}
      <div className="grid grid-cols-3 gap-2">
        {tradePlans.map((plan, i) => {
          const pl         = PLAN_LABELS[plan.planType];
          const isSelected = selectedIdx === i;
          const isBest     = i === bestPlanIdx;

          return (
            <button
              key={plan.planType}
              type="button"
              disabled={plan.proposalStatus === "WAIT"}
              onClick={() => {
                const newIdx = isSelected ? null : i;
                setSelectedIdx(newIdx);
                onSelectPlan?.(newIdx != null ? tradePlans[newIdx] : null);
              }}
              className={`
                relative rounded-lg border px-3 py-2.5 text-right transition-all
                ${isSelected ? pl.btnSel : `text-foreground/70 bg-card/30 ${pl.btnBase}`}
                ${plan.proposalStatus === "WAIT" ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              {isBest && !isSelected && (
                <span className="absolute -top-2 right-2 text-[8px] text-amber-400/80 font-bold">★</span>
              )}
              <p className="text-xs font-bold">{pl.ar}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{pl.short} · {pl.riskPct}</p>
              <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                <span className={`text-[9px] border rounded px-1.5 py-0.5 ${STATUS_BADGE[plan.proposalStatus]}`}>
                  {STATUS_LABEL[plan.proposalStatus]}
                </span>
                {plan.professional.timingAssessment === "NOW" && (
                  <span className="text-[8px] text-emerald-400/70">الآن</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected plan detail */}
      {selectedPlan && selectedPlan.proposalStatus !== "WAIT" && selectedPlan.entry != null && (
        <div className="rounded-xl border border-border/30 bg-card/40 p-4 space-y-3" dir="rtl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-foreground/90">
              الخطة المختارة: {PLAN_LABELS[selectedPlan.planType].ar}
            </p>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] border rounded px-2 py-0.5 ${STATUS_BADGE[selectedPlan.proposalStatus]}`}>
                {STATUS_LABEL[selectedPlan.proposalStatus]}
              </span>
            </div>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-2 gap-x-6">
            <div>
              <PriceRow label="الدخول"    value={fmt(selectedPlan.entry)} />
              <PriceRow label="وقف"       value={fmt(selectedPlan.stopLoss)} cls="text-red-300" />
              <PriceRow label="TP1 (30%)" value={fmt(selectedPlan.takeProfit1)} cls="text-emerald-300/80" />
            </div>
            <div>
              <PriceRow label="TP2 (30%)" value={fmt(selectedPlan.takeProfit2)} cls="text-emerald-300/90" />
              <PriceRow label="TP3 (40%)" value={fmt(selectedPlan.takeProfit3)} cls="text-emerald-400" />
              <PriceRow label="R/R (TP2)" value={`${fmt(selectedPlan.rr2, 1)}:1`} />
            </div>
          </div>

          {/* Risk summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-background/20 border border-border/20 px-2 py-1.5">
              <p className="text-[10px] font-bold text-foreground/85">${fmt(selectedPlan.suggestedRiskUsd)}</p>
              <p className="text-[9px] text-muted-foreground">مخاطرة مقترحة</p>
            </div>
            <div className="rounded bg-background/20 border border-border/20 px-2 py-1.5">
              <p className="text-[10px] font-bold text-foreground/85">
                {selectedPlan.riskPercent != null ? `${selectedPlan.riskPercent.toFixed(2)}%` : "—"}
              </p>
              <p className="text-[9px] text-muted-foreground">% من الحساب</p>
            </div>
            <div className="rounded bg-background/20 border border-border/20 px-2 py-1.5">
              <p className="text-[10px] font-bold text-foreground/85">{fmt(selectedPlan.estimatedLot, 2)}</p>
              <p className="text-[9px] text-muted-foreground">اللوت</p>
            </div>
          </div>

          {/* Warnings / Blockers */}
          {selectedPlan.blockers.length > 0 && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 space-y-0.5">
              <p className="text-[10px] font-medium text-red-300/80 mb-1">أسباب المنع</p>
              {selectedPlan.blockers.map((b, i) => (
                <p key={i} className="text-[10px] text-red-300/70 flex gap-1.5"><span>•</span>{b}</p>
              ))}
            </div>
          )}
          {selectedPlan.warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 space-y-0.5">
              <p className="text-[10px] font-medium text-amber-300/80 mb-1">تحذيرات</p>
              {selectedPlan.warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-300/70 flex gap-1.5"><span>•</span>{w}</p>
              ))}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground/80 leading-relaxed border-t border-border/20 pt-2">
            <span className="text-amber-400/70 font-medium">الخطوة التالية: </span>
            {selectedPlan.nextAction}
          </p>
        </div>
      )}

      {/* BLOCKED plan selected */}
      {selectedPlan?.proposalStatus === "BLOCKED" && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3" dir="rtl">
          <p className="text-xs font-semibold text-red-300/80">الخطة محظورة</p>
          <p className="text-[10px] text-red-300/60 mt-1">{selectedPlan.nextAction}</p>
          {selectedPlan.blockers.map((b, i) => (
            <p key={i} className="text-[10px] text-red-300/60 flex gap-1.5 mt-0.5"><span>•</span>{b}</p>
          ))}
        </div>
      )}

      {/* Professional analysis */}
      {selectedPlan && (
        <ProfessionalAnalysis plan={selectedPlan} />
      )}

      {/* Execution Preview */}
      {execPreview && (
        <ExecutionPreviewPanel preview={execPreview} />
      )}
    </div>
  );
}
