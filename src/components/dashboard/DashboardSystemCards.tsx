"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusBadgeVariant } from "@/components/common/status-indicator";
import { useReadOnlyMonitoringSnapshot } from "@/lib/hooks/use-read-only-monitoring-snapshot";
import { institutionalCardClass } from "@/lib/ui-institutional";

function fmtKill(v: boolean | null | undefined): string {
  if (v === true) return "نشط";
  if (v === false) return "غير نشط";
  return "غير معروف";
}

function fmtPending(enabled: boolean): string {
  return enabled ? "مفعّل" : "معطّل";
}

export function DashboardSystemCards() {
  const snap = useReadOnlyMonitoringSnapshot();

  if (snap.phase === "loading") {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className={institutionalCardClass("p-4")}>
            <CardHeader className="p-0 pb-2">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent className="p-0">
              <Skeleton className="h-6 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const live = snap.live;

  const backendText =
    live != null
      ? `${live.backend.status} — ${live.backend.server_time_utc}`
      : snap.rows.find((r) => r.key === "backend")?.detail ?? "—";

  const mt5Text =
    live != null
      ? `${live.mt5.status} (${live.mt5.source})`
      : snap.rows.find((r) => r.key === "mt5")?.detail ?? "—";

  const dbText =
    live != null ? `${live.database.status}` : snap.rows.find((r) => r.key === "database")?.detail ?? "—";

  const govText =
    live != null
      ? `${live.governance.decision}${live.governance.risk_multiplier != null ? ` — مضاعف: ${live.governance.risk_multiplier}` : ""}`
      : snap.rows.find((r) => r.key === "governance")?.detail ?? "—";

  const killText =
    live != null ? fmtKill(live.governance.kill_switch_active) : "غير متاح — وضع تجريبي بدون API.";

  const pendingText =
    live != null
      ? fmtPending(live.execution.pending_execution_enabled)
      : "غير متاح — وضع تجريبي بدون API.";

  const killBadge: StatusBadgeVariant =
    live == null ? "neutral" : live.governance.kill_switch_active ? "danger" : "ok";

  return (
    <div className="space-y-3">
      {snap.phase === "mock" && snap.errorAr ? (
        <Alert className="border-amber-500/20 bg-amber-500/5">
          <AlertTitle>بيانات المراقبة</AlertTitle>
          <AlertDescription>{snap.errorAr} — يتم عرض وضع تجريبي للبطاقات أدناه.</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-muted-foreground text-xs">
        قراءة فقط — لا توجد أوامر تنفيذ من هذه الواجهة.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-2">
            <CardTitle className="card-title-inst">الخادم</CardTitle>
            <StatusBadge variant="ok">Backend</StatusBadge>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">{backendText}</CardContent>
        </Card>
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-2">
            <CardTitle className="card-title-inst">MT5</CardTitle>
            <StatusBadge variant={live?.mt5.status === "connected" ? "ok" : "warning"}>حالة</StatusBadge>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">{mt5Text}</CardContent>
        </Card>
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-2">
            <CardTitle className="card-title-inst">قاعدة البيانات</CardTitle>
            <StatusBadge variant="neutral">DB</StatusBadge>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">{dbText}</CardContent>
        </Card>
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-2">
            <CardTitle className="card-title-inst">الحوكمة</CardTitle>
            <StatusBadge variant="warning">قرار</StatusBadge>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">{govText}</CardContent>
        </Card>
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-2">
            <CardTitle className="card-title-inst">Kill switch</CardTitle>
            <StatusBadge variant={killBadge}>حالة</StatusBadge>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">{killText}</CardContent>
        </Card>
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-2">
            <CardTitle className="card-title-inst">التنفيذ المعلق</CardTitle>
            <StatusBadge variant={live?.execution.pending_execution_enabled ? "warning" : "ok"}>
              Pending
            </StatusBadge>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm">{pendingText}</CardContent>
        </Card>
      </div>
    </div>
  );
}
