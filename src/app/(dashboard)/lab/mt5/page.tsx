"use client";

/**
 * /lab/mt5 — MT5 General Lab — المختبر العام
 * مختبر التحليل العام لجميع الرموز المفعّلة في Market Watch.
 * للذهب فقط: راجع /gold — Gold Command Center.
 * لا تنفيذ تداول — لا order_send — لا mutations هنا.
 */

import { AnalysisControlPanel } from "@/components/lab/AnalysisControlPanel";

export default function LabPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">

      <div>
        <h2 className="page-title">MT5 General Lab</h2>
        <p className="label-secondary mt-1">
          مختبر تحليل عام لجميع رموز MT5 المفعّلة — قراءة فقط — لا يتم تنفيذ أي تداول.
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          للتحليل المؤسسي على XAUUSD:{" "}
          <a href="/gold" className="text-amber-300 underline underline-offset-2 hover:text-amber-200">
            Gold Command Center ←
          </a>
        </p>
      </div>

      {/* General analysis panel — all enabled symbols */}
      <AnalysisControlPanel />

      <p className="text-center text-xs text-muted-foreground/55">
        القرارات المحفوظة تظهر في{" "}
        <a
          href="/decision-journal"
          className="text-amber-300 underline underline-offset-2 hover:text-amber-200"
        >
          سجل القرارات
        </a>
        {" "}— لا يوجد تنفيذ تداول.
      </p>

    </div>
  );
}
