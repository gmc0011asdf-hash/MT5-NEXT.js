"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mt5EmptyState } from "@/components/common/Mt5EmptyState";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { useReadOnlyMonitoringSnapshot } from "@/lib/hooks/use-read-only-monitoring-snapshot";

function JsonPreview({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 0);
  const short = text.length > 220 ? `${text.slice(0, 220)}…` : text;
  return (
    <pre className="max-h-28 overflow-auto rounded-lg border border-border/60 bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground dir-ltr">
      {short || "—"}
    </pre>
  );
}

export function DashboardActivitySection() {
  const snap = useReadOnlyMonitoringSnapshot();

  const labDecisions =
    snap.phase === "live" && snap.live.lab.last_decisions?.length
      ? snap.live.lab.last_decisions
      : null;

  const guardEvents = snap.phase === "live" ? snap.live.execution.last_guard_events ?? [] : [];
  const lifecycleEvents = snap.phase === "live" ? snap.live.execution.last_lifecycle_events ?? [] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 pb-3 pt-4">
          <CardTitle className="text-base md:text-lg">أحدث قرارات المختبر</CardTitle>
          <p className="text-muted-foreground text-xs">للتحليل — التنفيذ محكوم بالقواعد.</p>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4">
          {snap.phase === "loading" ? (
            <p className="text-muted-foreground text-sm">جاري التحميل…</p>
          ) : labDecisions === null ? (
            <Mt5EmptyState reason="not_synced" className="py-4" />
          ) : (
            labDecisions.slice(0, 4).map((row, idx) => {
              const pair = (row as { pair?: string }).pair ?? `item-${idx}`;
              const verdict =
                (row as { verdict?: string }).verdict ?? JSON.stringify(row).slice(0, 40);
              return (
                <div
                  key={`${pair}-${idx}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-amber-100/90 tabular-nums">{pair}</span>
                  <span className="text-muted-foreground text-xs">{verdict}</span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 pb-3 pt-4">
          <CardTitle className="text-base md:text-lg">آخر أحداث المراقبة</CardTitle>
          <p className="text-muted-foreground text-xs">
            {snap.phase === "live"
              ? "من واجهة البرمجة (مختصر)."
              : snap.phase === "loading"
                ? "جاري التحميل…"
                : "لا بيانات حية — تعذّر الاتصال بالخادم."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <div>
            <p className="mb-1 text-muted-foreground text-xs">حارس التنفيذ</p>
            {guardEvents.length ? <JsonPreview value={guardEvents.slice(0, 2)} /> : <JsonPreview value={[]} />}
          </div>
          <div>
            <p className="mb-1 text-muted-foreground text-xs">دورة حياة الطلب</p>
            {lifecycleEvents.length ? (
              <JsonPreview value={lifecycleEvents.slice(0, 2)} />
            ) : (
              <JsonPreview value={[]} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
