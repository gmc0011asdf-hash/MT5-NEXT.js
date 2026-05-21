"use client";

/**
 * RealisticTargetCard — Gold Realistic Trade Targeting v1
 * ─────────────────────────────────────────────────────────────────────────────
 * بطاقة "الأهداف الواقعية" — تعرض أهدافًا واقعية حسب الفريم الزمني.
 * لا منطق حساب — عرض فقط.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { RealisticTarget, RealismScore, TradeTargetProfile } from "@/lib/gold/gold-realistic-targeting-engine";

type TargetPreference = "REALISTIC" | "BALANCED" | "FAR";

const REALISM_COLOR: Record<RealismScore, string> = {
  REALISTIC: "text-emerald-300",
  STRETCHED: "text-amber-300",
  TOO_FAR:   "text-red-300",
};

const REALISM_BADGE: Record<RealismScore, string> = {
  REALISTIC: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  STRETCHED: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  TOO_FAR:   "border-red-500/40 bg-red-500/10 text-red-300",
};

const PROFILE_ICON: Record<TradeTargetProfile, string> = {
  SCALP_TEST: "⚡",
  INTRADAY:   "◑",
  SWING:      "◎",
};

function fmt(v: number | null | undefined, d = 5): string {
  return v == null ? "—" : v.toFixed(d);
}

function RRBadge({ rr }: { rr: number }) {
  const cls = rr >= 1.5 ? "text-emerald-300" : rr >= 1.0 ? "text-amber-300" : "text-red-300";
  return <span className={`font-mono text-sm font-bold ${cls}`}>{rr.toFixed(2)}:1</span>;
}

export function RealisticTargetCard({
  target,
  preference,
  onPreferenceChange,
}: {
  target:             RealisticTarget;
  preference:         TargetPreference;
  onPreferenceChange: (p: TargetPreference) => void;
}) {
  const dirCls = target.direction === "BUY" ? "text-emerald-300" : "text-red-300";
  const dirAr  = target.direction === "BUY" ? "↑ شراء" : "↓ بيع";

  return (
    <div dir="rtl" className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            الأهداف الواقعية
          </span>
          <p className="text-sm font-bold text-foreground/90 mt-0.5">
            {PROFILE_ICON[target.profile]} {target.profileLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold ${dirCls}`}>{dirAr}</span>
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${REALISM_BADGE[target.realismScore]}`}>
            {target.realismScore}
          </span>
        </div>
      </div>

      {/* ── Profile reason ───────────────────────────────────────────────────── */}
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{target.profileReason}</p>

      {/* ── Target preference selector ───────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground shrink-0">نوع الخطة:</span>
        <div className="flex gap-1">
          {(["REALISTIC", "BALANCED", "FAR"] as TargetPreference[]).map((p) => {
            // Profile-aware label for REALISTIC
            const realisticLabel =
              target.profile === "SCALP_TEST" ? "واقعي سريع" :
              target.profile === "INTRADAY"   ? "واقعي يومي" :
              target.profile === "SWING"      ? "واقعي طويل" : "واقعي";
            const labels: Record<TargetPreference, string> = {
              REALISTIC: realisticLabel,
              BALANCED:  "متوسط",
              FAR:       "بعيد",
            };
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPreferenceChange(p)}
                className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  preference === p
                    ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-300"
                    : "border-border/30 bg-muted/10 text-muted-foreground hover:text-foreground/70"
                }`}
              >
                {labels[p]}
              </button>
            );
          })}
        </div>
        {preference === "REALISTIC" && (
          <span className="text-[10px] text-cyan-400/70">← مفعّل في التنفيذ</span>
        )}
      </div>

      {/* ── Current plan realism warning ─────────────────────────────────────── */}
      {target.currentPlanFarWarn && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/8 px-3 py-2">
          <span className="text-red-400 shrink-0">⚠</span>
          <p className="text-[11px] text-red-300/80 leading-relaxed">{target.currentPlanFarWarn}</p>
        </div>
      )}

      {/* ── Targets data ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Entry + SL */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex flex-col gap-0.5 rounded border border-border/20 bg-background/20 px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground">الدخول</span>
            <span className="text-sm font-mono font-bold text-foreground/90">{fmt(target.entry)}</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground">SL واقعي ({target.profile === "SCALP_TEST" ? "0.6" : target.profile === "INTRADAY" ? "1.0" : "2.0"}×ATR)</span>
            <span className="text-sm font-mono text-red-300">{fmt(target.sl)}</span>
          </div>
        </div>

        {/* TP1, TP2, TP3 */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="flex flex-col gap-0.5 rounded border border-emerald-500/15 bg-emerald-500/5 px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground">TP1 (قريب)</span>
            <span className="text-sm font-mono text-emerald-300">{fmt(target.tp1)}</span>
            <RRBadge rr={target.rr1} />
          </div>
          <div className="flex flex-col gap-0.5 rounded border border-emerald-500/25 bg-emerald-500/8 px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground font-semibold">TP2 ✓ رئيسي</span>
            <span className="text-sm font-mono font-bold text-emerald-200">{fmt(target.tp2)}</span>
            <RRBadge rr={target.rr2} />
          </div>
          <div className="flex flex-col gap-0.5 rounded border border-emerald-500/10 bg-emerald-500/3 px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground">TP3 (اختياري)</span>
            <span className="text-sm font-mono text-emerald-300/70">{fmt(target.tp3)}</span>
            {target.rr3 != null && <RRBadge rr={target.rr3} />}
          </div>
        </div>
      </div>

      {/* ── Risk / Lot ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="flex flex-col gap-0.5 rounded border border-border/20 bg-background/15 px-2 py-1.5">
          <span className="text-[10px] text-muted-foreground">اللوت</span>
          <span className="text-sm font-mono font-bold text-foreground/90">{target.lot.toFixed(2)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded border border-border/20 bg-background/15 px-2 py-1.5">
          <span className="text-[10px] text-muted-foreground">المخاطرة</span>
          <span className="text-sm font-mono text-foreground/80">${target.riskUsd.toFixed(2)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded border border-border/20 bg-background/15 px-2 py-1.5">
          <span className="text-[10px] text-muted-foreground">ATR14</span>
          <span className="text-sm font-mono text-amber-300/70">{target.atr14.toFixed(2)}</span>
        </div>
      </div>

      {/* ── Expected candles + Time Stop ─────────────────────────────────────── */}
      <div className="rounded-md border border-border/15 bg-background/15 px-3 py-2 space-y-0.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">الشموع المتوقعة:</span>
          <span className="font-mono text-foreground/80">{target.minCandles}–{target.maxCandles} شمعة</span>
        </div>
        <p className="text-[10px] text-amber-300/60">{target.timeStopLabel}</p>
      </div>

      {/* ── Realism assessment ───────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-[11px]">
        <span className="text-muted-foreground shrink-0">تقييم الخطة الحالية:</span>
        <span className={REALISM_COLOR[target.realismScore]}>{target.realismReason}</span>
      </div>

      {/* Lot reason (collapsible text) */}
      <p className="text-[9px] text-muted-foreground/40 leading-relaxed border-t border-border/20 pt-2">
        {target.lotReason}
      </p>

      <p className="text-[10px] text-muted-foreground/40 italic">
        أهداف واقعية — حساب استرشادي — ليس توصية مالية — لا تنفيذ تلقائي.
      </p>
    </div>
  );
}
