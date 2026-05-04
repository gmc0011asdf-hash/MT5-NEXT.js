"use client";

/**
 * /lab/mt5 — المختبر المؤسسي
 * Stage 5A: تحليل الفرصة عبر AnalysisControlPanel — قراءة فقط.
 * لا تنفيذ تداول — لا order_send — لا mutations هنا.
 */

import { AnalysisControlPanel } from "@/components/lab/AnalysisControlPanel";

export default function LabPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">

      <div>
        <h2 className="page-title">المختبر المؤسسي</h2>
        <p className="label-secondary mt-1">
          تحليل رموز MT5 الظاهرة — قراءة فقط — لا يتم تنفيذ أي تداول.
        </p>
      </div>

      {/* Stage 5A: لوحة تحليل الفرصة */}
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
