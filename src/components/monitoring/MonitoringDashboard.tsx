"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/common/status-indicator";
import { useReadOnlyMonitoringSnapshot } from "@/lib/hooks/use-read-only-monitoring-snapshot";
import { institutionalCardClass } from "@/lib/ui-institutional";
import type { MonitoringRow } from "@/lib/types/trading";

const SYSTEM_KEYS = new Set(["backend", "mt5", "database"]);
const GOV_KEYS = new Set(["governance", "protection"]);
const EVENT_KEY = "lifecycle";

function statusBadgeVariant(s: MonitoringRow["status"]) {
  if (s === "سليم") return "ok" as const;
  if (s === "تحذير") return "warning" as const;
  if (s === "خطأ") return "danger" as const;
  return "neutral" as const;
}

function MonitoringCard({ row }: { row: MonitoringRow }) {
  return (
    <Card className={institutionalCardClass("p-4")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-2">
        <CardTitle className="card-title-inst">{row.labelAr}</CardTitle>
        <StatusBadge variant={statusBadgeVariant(row.status)}>{row.status}</StatusBadge>
      </CardHeader>
      <CardContent className="p-0">
        <p className="text-muted-foreground text-sm leading-relaxed">{row.detail}</p>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-medium text-amber-100/90 text-sm tracking-wide md:text-base">{children}</h3>;
}

export function MonitoringDashboard() {
  const snap = useReadOnlyMonitoringSnapshot();

  const systemRows = snap.rows?.filter((r) => SYSTEM_KEYS.has(r.key)) ?? [];
  const govRows = snap.rows?.filter((r) => GOV_KEYS.has(r.key)) ?? [];
  const lifecycleRow = snap.rows?.find((r) => r.key === EVENT_KEY);
  const dbRow = snap.rows?.find((r) => r.key === "database");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div>
        <h2 className="page-title">لوحة المراقبة</h2>
        <p className="label-secondary mt-1">
          {snap.phase === "live"
            ? "بيانات من واجهة البرمجة (قراءة فقط)."
            : snap.phase === "mock"
              ? "وضع العرض التجريبي — تعذّر تحميل البيانات الحية أو لم يُضبط العنوان."
              : "جاري التحميل…"}
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          قراءة فقط — لا توجد أوامر تنفيذ من هذه الواجهة.
        </p>
      </div>

      {snap.phase === "mock" && snap.errorAr ? (
        <Alert className="border-rose-500/20 bg-rose-500/5">
          <AlertTitle>تعذّر الاتصال بمراقبة الخادم</AlertTitle>
          <AlertDescription>{snap.errorAr}</AlertDescription>
        </Alert>
      ) : null}

      {snap.phase === "live" && snap.live.warnings && snap.live.warnings.length > 0 ? (
        <Alert className="border-amber-500/25 bg-amber-500/10">
          <AlertTitle>تنبيهات من الخادم</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
              {snap.live.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {snap.phase === "loading" ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className={institutionalCardClass("p-4")}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-2">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-14" />
                </CardHeader>
                <CardContent className="p-0">
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="space-y-3">
            <SectionTitle>حالة النظام</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {systemRows.map((row) => (
                <MonitoringCard key={row.key} row={row} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle>الحوكمة والحماية</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              {govRows.map((row) => (
                <MonitoringCard key={row.key} row={row} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle>قاعدة البيانات</SectionTitle>
            {dbRow ? <MonitoringCard row={dbRow} /> : null}
          </section>

          <section className="space-y-3">
            <SectionTitle>آخر الأحداث</SectionTitle>
            <div className="grid gap-4 lg:grid-cols-2">
              {lifecycleRow ? <MonitoringCard row={lifecycleRow} /> : null}
              <Card className={institutionalCardClass("p-4")}>
                <CardHeader className="p-0 pb-2">
                  <CardTitle className="card-title-inst">مختبر — آخر القرارات</CardTitle>
                  <p className="text-muted-foreground text-xs">قراءة فقط.</p>
                </CardHeader>
                <CardContent className="p-0">
                  {snap.phase === "live" && snap.live.lab.last_decisions?.length ? (
                    <pre className="max-h-40 overflow-auto rounded-lg border border-border/60 bg-black/30 p-2 font-mono text-[11px] leading-relaxed dir-ltr">
                      {JSON.stringify(snap.live.lab.last_decisions.slice(0, 3), null, 2)}
                    </pre>
                  ) : (
                    <p className="text-muted-foreground text-sm">لا بيانات حية — سيتم ربط القراءة لاحقاً.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
