"use client";

/**
 * /gold — مركز الذهب المؤسسي — Gold Command Center
 * مختبر XAUUSD المستقل — قراءة فقط — لا تنفيذ تداول.
 * الرمز ثابت: XAUUSD — لا يظهر أي رمز آخر داخل هذه الصفحة.
 * لا order_send — لا buy/sell recommendation — تحليل استرشادي فقط.
 */

import { GoldStatusCard } from "@/components/lab/GoldStatusCard";
import { AnalysisControlPanel } from "@/components/lab/AnalysisControlPanel";
import { GOLD_PROFILE } from "@/lib/gold/gold-profile";

export default function GoldCommandCenterPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" dir="rtl">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="page-title">مركز الذهب المؤسسي</h2>
          <span className="text-sm font-semibold text-amber-400/80 tracking-wide">
            Gold Command Center
          </span>
        </div>
        <p className="label-secondary mt-1">
          تحليل {GOLD_PROFILE.symbol} المؤسسي المستقل — التنفيذ يتم فقط بعد موافقة القواعد واللجان.
        </p>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-[11px] text-amber-300/70">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400/60 shrink-0" />
          الرمز مقيّد بـ {GOLD_PROFILE.symbol} — لا تظهر أزواج أخرى في هذا المركز
        </div>
      </div>

      {/* ── Gold Status + Market Regime ──────────────────────────────────── */}
      <GoldStatusCard />

      {/* ── MT5 Execution Gate Banner ─────────────────────────────────────── */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-1">
        <p className="text-amber-200/90 text-sm font-medium">
          تنفيذ عبر MT5 — يتطلب موافقة اللجان والحراس والتأكيد اليدوي
        </p>
        <p className="text-amber-200/60 text-xs">
          التنفيذ محكوم بقواعد الحوكمة والمخاطر — Kill Switch يوقف كل التنفيذات — لا توصية مالية.
        </p>
      </div>

      {/* ── Gold Analysis Panel — locked to XAUUSD ──────────────────────── */}
      <AnalysisControlPanel lockedSymbol={GOLD_PROFILE.symbol} mode="gold" />

      {/* ── Footer notice ────────────────────────────────────────────────── */}
      <p className="text-center text-xs text-muted-foreground/55">
        القرارات المحفوظة تظهر في{" "}
        <a
          href="/decision-journal"
          className="text-amber-300 underline underline-offset-2 hover:text-amber-200"
        >
          سجل القرارات
        </a>
        {" "}— لا يوجد تنفيذ تداول — تحليل استرشادي فقط.
      </p>

    </div>
  );
}
