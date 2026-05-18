"use client";

/**
 * GoldTradePlansCard — Gold Trade Plans Engine v2
 * نظرة عامة على 3 خطط تداول مع إدارة مخاطر مهنية وسياق MTF.
 * قراءة فقط — لا order_send — لا تنفيذ.
 */

import { useState } from "react";
import type {
  GoldTradePlansResult,
  TradePlan,
  ProposalStatus,
  PlanType,
} from "@/lib/gold/gold-trade-plans-engine";

// ─── Display config ───────────────────────────────────────────────────────────

const STATUS_CFG: Record<ProposalStatus, { label: string; badgeClass: string; dotClass: string }> = {
  EXECUTION_READY: { label: "جاهز",    badgeClass: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", dotClass: "bg-emerald-400" },
  REVIEW:          { label: "مراجعة",  badgeClass: "text-amber-300 bg-amber-500/10 border-amber-500/30",     dotClass: "bg-amber-400" },
  BLOCKED:         { label: "محظور",   badgeClass: "text-red-300 bg-red-500/10 border-red-500/30",           dotClass: "bg-red-400" },
  WAIT:            { label: "انتظار",  badgeClass: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",        dotClass: "bg-zinc-500" },
};

const PLAN_CFG: Record<PlanType, { ar: string; en: string; borderClass: string; riskPct: string }> = {
  CONSERVATIVE: { ar: "المحافظة",  en: "Conservative", borderClass: "border-sky-500/20",    riskPct: "0.25%" },
  BALANCED:     { ar: "المتوازنة", en: "Balanced",     borderClass: "border-amber-500/20",  riskPct: "0.50%" },
  AGGRESSIVE:   { ar: "الهجومية",  en: "Aggressive",   borderClass: "border-violet-500/20", riskPct: "1.00%" },
  WAIT:         { ar: "انتظار",    en: "Wait",         borderClass: "border-zinc-500/20",   riskPct: "—" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, d = 2): string {
  return n != null ? n.toFixed(d) : "—";
}

function Row({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-1 py-[3px] border-b border-border/10 last:border-0">
      <span className="text-[10px] text-muted-foreground shrink-0">{label}</span>
      <span className={`text-[11px] font-mono tabular-nums ${cls || "text-foreground/80"}`}>{value}</span>
    </div>
  );
}

function CollapseList({ label, items, cls = "text-foreground/70" }: { label: string; items: string[]; cls?: string }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(p => !p)}
        className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground/60 flex items-center gap-1">
        <span>{open ? "▾" : "▸"}</span>{label} ({items.length})
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {items.map((s, i) => (
            <li key={i} className={`text-[10px] leading-relaxed flex gap-1 ${cls}`}>
              <span className="shrink-0 mt-0.5">•</span>{s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({ plan, isBest }: { plan: TradePlan; isBest: boolean }) {
  const st   = STATUS_CFG[plan.proposalStatus];
  const pl   = PLAN_CFG[plan.planType];
  const wait = plan.direction === "WAIT";

  const dirLabel = plan.direction === "BUY" ? "↑ شراء" : plan.direction === "SELL" ? "↓ بيع" : "—";
  const dirCls   = plan.direction === "BUY" ? "text-emerald-300 font-bold" : plan.direction === "SELL" ? "text-red-300 font-bold" : "text-zinc-400";
  const timingCls =
    plan.professional.timingAssessment === "NOW"     ? "text-emerald-300" :
    plan.professional.timingAssessment === "MONITOR" ? "text-amber-300"   : "text-zinc-400";

  return (
    <div className={`relative rounded-xl border ${pl.borderClass} bg-card/50 p-3 space-y-2 ${isBest ? "ring-1 ring-amber-400/40" : ""}`}>
      {isBest && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          <span className="text-[9px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/30 rounded-full px-2 py-0.5 whitespace-nowrap">★ الأفضل</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-1">
        <div>
          <p className="text-xs font-bold text-foreground/90">{pl.ar}</p>
          <p className="text-[9px] text-muted-foreground">{pl.en} — {pl.riskPct}</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${st.badgeClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${st.dotClass}`} />
          {st.label}
        </span>
      </div>

      {/* Direction + timing */}
      {!wait && (
        <div className="flex items-center gap-2">
          <span className={`text-xs ${dirCls}`}>{dirLabel}</span>
          <span className="text-[10px] border border-border/30 rounded px-1 text-muted-foreground">
            {plan.entryType === "LIMIT" ? "LIMIT" : "MARKET"}
          </span>
          <span className={`text-[9px] ${timingCls}`}>
            {plan.professional.timingAssessment === "NOW" ? "الآن" :
             plan.professional.timingAssessment === "MONITOR" ? "مراقبة" : "انتظار"}
          </span>
        </div>
      )}

      {/* Prices */}
      {!wait && plan.entry != null && (
        <div>
          <Row label="دخول"    value={fmt(plan.entry)}      />
          <Row label="وقف"     value={fmt(plan.stopLoss)}    cls="text-red-300/90" />
          <Row label="TP1 30%" value={fmt(plan.takeProfit1)} cls="text-emerald-300/80" />
          <Row label="TP2 30%" value={fmt(plan.takeProfit2)} cls="text-emerald-300/90" />
          <Row label="TP3 40%" value={fmt(plan.takeProfit3)} cls="text-emerald-400" />
        </div>
      )}

      {/* RR */}
      {!wait && plan.rr1 != null && (
        <div className="rounded bg-background/20 border border-border/20 px-2 py-1">
          <Row label="RR1" value={`${fmt(plan.rr1, 1)}:1`} />
          <Row label="RR2" value={`${fmt(plan.rr2, 1)}:1`} />
          <Row label="RR3" value={`${fmt(plan.rr3, 1)}:1`} />
        </div>
      )}

      {/* Risk + Lot — PROFESSIONAL */}
      {!wait && (
        <div className="rounded bg-background/15 border border-border/20 px-2 py-1.5 space-y-0.5">
          <p className="text-[9px] text-muted-foreground/60 uppercase mb-1">إدارة المخاطر</p>
          <Row label="مخاطرة مقترحة" value={`$${fmt(plan.suggestedRiskUsd)}`} />
          {plan.riskPercent != null && (
            <Row label="% من الحساب" value={`${plan.riskPercent.toFixed(2)}%`} />
          )}
          <Row label="أقصى خسارة"    value={`$${fmt(plan.maxLossUsd)}`} cls="text-red-300/80" />
          {plan.estimatedLot != null && (
            <Row label="اللوت"       value={plan.estimatedLot.toFixed(2)} />
          )}
        </div>
      )}

      {/* Manual vs ATR comparison */}
      {plan.manualLotNote && (
        <div className="rounded border border-amber-500/15 bg-amber-500/5 px-2 py-1.5">
          <p className="text-[9px] text-amber-300/70 leading-relaxed">{plan.manualLotNote}</p>
        </div>
      )}

      {/* Lot reason */}
      {!wait && plan.lotReason && (
        <CollapseList label="سبب اللوت" items={[plan.lotReason]} cls="text-muted-foreground/70" />
      )}

      {/* MTF info */}
      {plan.professional.mtfSupportingFrames.length > 0 && (
        <CollapseList
          label="فريمات داعمة"
          items={[plan.professional.mtfSupportingFrames.join(", ")]}
          cls="text-emerald-300/70"
        />
      )}
      {plan.professional.mtfConflictingFrames.length > 0 && (
        <CollapseList
          label="فريمات متعارضة"
          items={[plan.professional.mtfConflictingFrames.join(", ")]}
          cls="text-red-300/70"
        />
      )}

      {/* Collapsible lists */}
      <CollapseList label="أسباب"    items={plan.reasons}  cls="text-foreground/65" />
      <CollapseList label="تحذيرات" items={plan.warnings} cls="text-amber-300/75" />
      {plan.blockers.length > 0 && (
        <CollapseList label="أسباب المنع" items={plan.blockers} cls="text-red-300/80" />
      )}

      {/* Partial close */}
      {!wait && plan.entry != null && (
        <div className="text-[9px] text-muted-foreground/50 border-t border-border/15 pt-1.5">
          إغلاق جزئي: TP1 {plan.partialClosePlan.tp1Pct}% | TP2 {plan.partialClosePlan.tp2Pct}% | TP3 {plan.partialClosePlan.tp3Pct}%
        </div>
      )}

      {/* Grade */}
      <div className="flex items-center justify-between text-[9px] border-t border-border/15 pt-1.5">
        <span className="text-muted-foreground">درجة / ثقة</span>
        <span className="font-mono font-bold text-amber-300/80">{plan.grade} | {plan.confidence}%</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GoldTradePlansCard({ plans }: { plans: GoldTradePlansResult }) {
  const { plans: tradePlans, bestPlanIdx } = plans;

  if (tradePlans.length === 1 && tradePlans[0].planType === "WAIT") {
    return (
      <div className="rounded-xl border border-zinc-500/20 bg-zinc-500/5 px-4 py-3" dir="rtl">
        <p className="text-xs font-semibold text-zinc-300/80">خطط التداول المقترحة</p>
        <p className="text-[11px] text-zinc-400 mt-1">لا توجد فرصة تداول حالياً — انتظر إشارة واضحة.</p>
      </div>
    );
  }

  const bestLabel =
    bestPlanIdx === 0 ? "الخطة المحافظة هي الأفضل حالياً" :
    bestPlanIdx === 1 ? "الخطة المتوازنة هي الأفضل حالياً" :
    bestPlanIdx === 2 ? "الخطة الهجومية هي الأفضل حالياً" :
    "لا توجد خطة موصى بها — راجع التحذيرات";

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-foreground/90">خطط التداول المقترحة</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{bestLabel}</p>
        </div>
        <span className="text-[9px] border border-amber-500/20 rounded px-2 py-0.5 text-amber-300/60">
          XAUUSD — ATR + Risk Manager
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tradePlans.map((plan, i) => (
          <PlanCard key={plan.planType} plan={plan} isBest={i === bestPlanIdx} />
        ))}
      </div>

      <p className="text-[9px] text-muted-foreground/40 italic text-center">
        الخطط مقترحة للدراسة — إدارة مخاطر مهنية — لا تنفيذ تلقائي.
      </p>
    </div>
  );
}
