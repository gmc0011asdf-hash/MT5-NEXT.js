"use client";

/**
 * ActionablePlanCard — Gold Actionable Trade Recommendation v1
 * ─────────────────────────────────────────────────────────────────────────────
 * بطاقة "خطة النظام العملية" — تعرض توصية قابلة للتنفيذ بدلاً من "ممنوع" فقط.
 * لا منطق حساب — عرض فقط.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ActionablePlan, ActionablePlanType } from "@/lib/gold/gold-actionable-plan-engine";

// ─── Config ───────────────────────────────────────────────────────────────────

type PlanConfig = {
  icon:        string;
  label:       string;
  badgeClass:  string;
  borderClass: string;
  bgClass:     string;
};

const PLAN_CONFIG: Record<ActionablePlanType, PlanConfig> = {
  EXECUTE_NOW: {
    icon:        "▶",
    label:       "دخول مباشر",
    badgeClass:  "text-emerald-300 bg-emerald-500/10 border-emerald-500/40",
    borderClass: "border-emerald-500/25",
    bgClass:     "bg-emerald-500/5",
  },
  EXPERIMENTAL_EXECUTION: {
    icon:        "◇",
    label:       "تجربة محكومة",
    badgeClass:  "text-violet-300 bg-violet-500/10 border-violet-500/40",
    borderClass: "border-violet-500/25",
    bgClass:     "bg-violet-500/5",
  },
  WAIT_FOR_CANDLE_CLOSE: {
    icon:        "◎",
    label:       "انتظار إغلاق شمعة",
    badgeClass:  "text-sky-300 bg-sky-500/10 border-sky-500/30",
    borderClass: "border-sky-500/20",
    bgClass:     "bg-sky-500/5",
  },
  WAIT_FOR_CONFIRMATION: {
    icon:        "◑",
    label:       "يحتاج تأكيد",
    badgeClass:  "text-amber-300 bg-amber-500/10 border-amber-500/30",
    borderClass: "border-amber-500/20",
    bgClass:     "bg-amber-500/5",
  },
  PENDING_LIMIT: {
    icon:        "⇢",
    label:       "أمر Limit مقترح",
    badgeClass:  "text-cyan-300 bg-cyan-500/10 border-cyan-500/30",
    borderClass: "border-cyan-500/20",
    bgClass:     "bg-cyan-500/5",
  },
  PENDING_STOP: {
    icon:        "⇢",
    label:       "أمر Stop مقترح",
    badgeClass:  "text-cyan-300 bg-cyan-500/10 border-cyan-500/30",
    borderClass: "border-cyan-500/20",
    bgClass:     "bg-cyan-500/5",
  },
  NO_TRADE: {
    icon:        "—",
    label:       "لا صفقة",
    badgeClass:  "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",
    borderClass: "border-zinc-500/20",
    bgClass:     "bg-zinc-500/5",
  },
  HARD_BLOCKED: {
    icon:        "✗",
    label:       "ممنوع تقنيًا",
    badgeClass:  "text-red-300 bg-red-500/10 border-red-500/40",
    borderClass: "border-red-500/25",
    bgClass:     "bg-red-500/5",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dirClass(d: "BUY" | "SELL" | null): string {
  if (d === "BUY")  return "text-emerald-300 font-bold";
  if (d === "SELL") return "text-red-300 font-bold";
  return "text-zinc-400";
}

function fmt(v: number | null | undefined, digits = 5): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DataGrid({ plan }: { plan: ActionablePlan }) {
  if (!plan.entry && !plan.stopLoss && !plan.takeProfit && !plan.lot) return null;
  const items = [
    { label: "الدخول",         val: fmt(plan.entry),      cls: "font-mono" },
    { label: "وقف الخسارة",    val: fmt(plan.stopLoss),   cls: "font-mono text-red-300" },
    { label: "الهدف الرئيسي",  val: fmt(plan.takeProfit), cls: "font-mono text-emerald-300" },
    { label: "اللوت",          val: plan.lot != null ? plan.lot.toFixed(2) : "—", cls: "font-mono font-bold" },
    { label: "نسبة R/R",       val: plan.rrRatio != null ? `${plan.rrRatio.toFixed(2)}:1` : "—", cls: "" },
    { label: "المخاطرة",       val: plan.riskUsd != null ? `$${plan.riskUsd.toFixed(2)}` : "—", cls: "" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {items.map(({ label, val, cls }) => (
        <div key={label} className="flex flex-col gap-0.5 rounded border border-border/20 bg-background/20 px-2 py-1.5">
          <span className="text-[10px] text-muted-foreground">{label}</span>
          <span className={`text-sm ${cls || "text-foreground/90"}`}>{val}</span>
        </div>
      ))}
    </div>
  );
}

function ConditionsList({ conditions }: { conditions: string[] }) {
  if (conditions.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">شروط التفعيل</p>
      <ul className="space-y-0.5">
        {conditions.map((c, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/70">
            <span className="text-amber-400/60 shrink-0 mt-0.5">◦</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ActionablePlanCard({ plan }: { plan: ActionablePlan }) {
  const cfg = PLAN_CONFIG[plan.planType];

  return (
    <div
      dir="rtl"
      className={`rounded-xl border ${cfg.borderClass} ${cfg.bgClass} p-4 space-y-4`}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            خطة النظام العملية
          </span>
          <p className="text-sm font-bold text-foreground/90 leading-snug mt-0.5">
            {plan.title}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold ${cfg.badgeClass}`}>
            <span>{cfg.icon}</span>
            <span>{cfg.label}</span>
          </span>

          {plan.direction && (
            <span className={`text-xs ${dirClass(plan.direction)}`}>
              {plan.direction === "BUY" ? "↑ شراء" : "↓ بيع"}
            </span>
          )}

          {plan.entryType && plan.entryType !== "MARKET" && (
            <span className="text-[10px] font-mono rounded border border-cyan-500/20 bg-cyan-500/5 text-cyan-300/80 px-1.5 py-0.5">
              {plan.entryType}
            </span>
          )}
        </div>
      </div>

      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      <p className="text-xs text-foreground/75 leading-relaxed">{plan.summary}</p>

      {/* ── Reason ──────────────────────────────────────────────────────────── */}
      <div className="rounded-md border border-border/20 bg-background/15 px-3 py-2">
        <span className="text-[10px] text-muted-foreground">سبب الاختيار: </span>
        <span className="text-xs text-foreground/70">{plan.reason}</span>
      </div>

      {/* ── Plan data grid ───────────────────────────────────────────────────── */}
      <DataGrid plan={plan} />

      {/* ── Why not now ─────────────────────────────────────────────────────── */}
      {plan.whyNotNow && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <span className="text-amber-400 shrink-0 text-sm">⚠</span>
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">سبب عدم الدخول الآن:</p>
            <p className="text-xs text-amber-300/80">{plan.whyNotNow}</p>
          </div>
        </div>
      )}

      {/* ── Activation conditions ────────────────────────────────────────────── */}
      <ConditionsList conditions={plan.activationConditions} />

      {/* ── Pending only notice ──────────────────────────────────────────────── */}
      {plan.isPendingOnly && (
        <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
          <p className="text-[11px] text-cyan-300/80">
            ⓘ الأمر المعلق مقترح للعرض فقط — تنفيذ الأوامر المعلقة غير مفعّل في هذه المرحلة.
          </p>
        </div>
      )}

      {/* ── Can execute now ──────────────────────────────────────────────────── */}
      {plan.canExecuteNow && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <p className="text-[11px] text-emerald-300/80">
            ✓ استخدم زر التنفيذ أدناه — راجع الخطة وأكد يدوياً قبل الإرسال.
          </p>
        </div>
      )}

      {/* ── Disclaimer ──────────────────────────────────────────────────────── */}
      <p className="text-[10px] text-muted-foreground/40 italic border-t border-border/20 pt-2">
        خطة النظام العملية — تحليل استرشادي — ليس توصية مالية — لا تنفيذ تلقائي.
      </p>
    </div>
  );
}
