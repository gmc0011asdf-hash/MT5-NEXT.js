"use client";

import { ConvexSafeWrapper } from "@/components/gold-pro/ConvexSafeWrapper";
import { MonitoringDashboard } from "@/components/monitoring/MonitoringDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { useConvexAuth, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";

const NO_CONVEX_DATA_AR =
  "لا توجد بيانات Convex بعد — استخدم صفحة قاعدة Convex لإنشاء بيانات تجريبية.";

function fmtTs(ms: number) {
  return new Date(ms).toLocaleString("ar-SA", { hour12: false });
}

function convexEmptyOrLoading(
  canUseConvex: boolean,
  isConvexAuthLoading: boolean,
  rows: unknown[] | undefined | null,
) {
  if (!canUseConvex && !isConvexAuthLoading) {
    return <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>;
  }
  if (isConvexAuthLoading || rows === undefined || rows === null) {
    return <p className="text-muted-foreground px-2 py-4 text-sm">جاري تحميل بيانات Convex...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>;
  }
  return null;
}

function MonitoringPageContent() {
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const monitoringStatus = useQuery(api.coreQueries.getMyMonitoringStatus, canUseConvex ? {} : "skip");
  const protectionEvents = useQuery(api.coreQueries.getMyProtectionEvents, canUseConvex ? {} : "skip");
  const governance = useQuery(api.coreQueries.getMyGovernanceState, canUseConvex ? {} : "skip");
  const auditEvents = useQuery(api.coreQueries.getMyAuditEvents, canUseConvex ? {} : "skip");

  const governancePlaceholder = convexEmptyOrLoading(
    canUseConvex,
    isConvexAuthLoading,
    governance === undefined
      ? undefined
      : governance === null
        ? []
        : [governance],
  );

  return (
    <div dir="rtl" className="flex flex-col gap-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="space-y-2 p-0">
            <CardTitle className="card-title-inst text-base">مراقبة Convex — قراءة فقط</CardTitle>
            <p className="text-muted-foreground text-xs leading-relaxed">
              مراقبة Convex للقراءة فقط — لا يوجد اتصال MT5 في هذه المرحلة
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-x-4 gap-y-2 p-0 pt-3 text-sm">
            <span className="text-muted-foreground">
              Convex مصادق:{" "}
              <span className="tabular-nums text-amber-100/90">{String(isAuthenticated)}</span>
            </span>
            {isConvexAuthLoading ? (
              <span className="text-muted-foreground text-xs">جاري تحميل المصادقة...</span>
            ) : null}
            {canUseConvex && governance !== undefined && governance !== null ? (
              <>
                <span className="text-muted-foreground">
                  قراءة فقط:{" "}
                  <span className="text-foreground">{governance.readOnly ? "نعم" : "لا"}</span>
                </span>
                <span className="text-muted-foreground">
                  التداول مفعّل:{" "}
                  <span className="text-foreground">{governance.tradingEnabled ? "نعم" : "لا"}</span>
                </span>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-0")}>
          <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
            <CardTitle className="card-title-inst">حالة المراقبة (Convex)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
            {convexEmptyOrLoading(canUseConvex, isConvexAuthLoading, monitoringStatus) ??
              (monitoringStatus && (
                <Table>
                  <TableHeader>
                    <TableRow className="border-amber-500/10 hover:bg-transparent">
                      <TableHead className="text-foreground">الخدمة</TableHead>
                      <TableHead className="text-foreground">الحالة</TableHead>
                      <TableHead className="text-foreground">رسالة</TableHead>
                      <TableHead className="text-foreground">آخر فحص</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monitoringStatus.map((row) => (
                      <TableRow key={row._id} className="border-border/60">
                        <TableCell className="font-medium text-amber-100/90">{row.service}</TableCell>
                        <TableCell>{row.status}</TableCell>
                        <TableCell className="max-w-[240px] text-muted-foreground text-sm leading-snug">
                          {row.message ?? "—"}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground text-xs">
                          {fmtTs(row.checkedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-0")}>
          <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
            <CardTitle className="card-title-inst">أحداث الحماية (Convex)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
            {convexEmptyOrLoading(canUseConvex, isConvexAuthLoading, protectionEvents) ??
              (protectionEvents && (
                <Table>
                  <TableHeader>
                    <TableRow className="border-amber-500/10 hover:bg-transparent">
                      <TableHead className="text-foreground">الخطورة</TableHead>
                      <TableHead className="text-foreground">محظور</TableHead>
                      <TableHead className="text-foreground">الرسالة</TableHead>
                      <TableHead className="text-foreground">الرمز</TableHead>
                      <TableHead className="text-foreground">الوقت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {protectionEvents.map((row) => (
                      <TableRow key={row._id} className="border-border/60">
                        <TableCell>{row.severity}</TableCell>
                        <TableCell className="tabular-nums">{row.blocked ? "نعم" : "لا"}</TableCell>
                        <TableCell className="max-w-[280px] text-muted-foreground text-sm leading-snug">
                          {row.message}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {row.symbol ?? "—"}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground text-xs">
                          {fmtTs(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-0")}>
          <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
            <CardTitle className="card-title-inst">الحوكمة (Convex)</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {governancePlaceholder ??
              (governance && (
                <ul className="space-y-2 text-foreground text-sm">
                  <li>
                    <span className="text-muted-foreground">الوضع:</span> {governance.mode}
                  </li>
                  <li>
                    <span className="text-muted-foreground">قراءة فقط:</span>{" "}
                    {governance.readOnly ? "نعم" : "لا"}
                  </li>
                  <li>
                    <span className="text-muted-foreground">التداول مفعّل:</span>{" "}
                    {governance.tradingEnabled ? "نعم" : "لا"}
                  </li>
                  <li>
                    <span className="text-muted-foreground">حد الصفقات اليومية:</span>{" "}
                    <span className="tabular-nums">{governance.maxDailyTrades}</span>
                  </li>
                  <li>
                    <span className="text-muted-foreground">حد المخاطرة (USD):</span>{" "}
                    <span className="tabular-nums">{governance.maxRiskUsd}</span>
                  </li>
                </ul>
              ))}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-0")}>
          <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
            <CardTitle className="card-title-inst">أحداث التدقيق (Convex)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
            {convexEmptyOrLoading(canUseConvex, isConvexAuthLoading, auditEvents) ??
              (auditEvents && (
                <Table>
                  <TableHeader>
                    <TableRow className="border-amber-500/10 hover:bg-transparent">
                      <TableHead className="text-foreground">الإجراء</TableHead>
                      <TableHead className="text-foreground">الكيان</TableHead>
                      <TableHead className="text-foreground">الرسالة</TableHead>
                      <TableHead className="text-foreground">المصدر</TableHead>
                      <TableHead className="text-foreground">الوقت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditEvents.map((row) => (
                      <TableRow key={row._id} className="border-border/60">
                        <TableCell className="font-medium">{row.action}</TableCell>
                        <TableCell>{row.entity}</TableCell>
                        <TableCell className="max-w-[240px] text-muted-foreground text-xs leading-snug">
                          {row.message}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{row.source}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground text-xs">
                          {fmtTs(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}
          </CardContent>
        </Card>
      </div>

      <MonitoringDashboard />
    </div>
  );
}

export default function MonitoringPage() {
  return (
    <ConvexSafeWrapper>
      <MonitoringPageContent />
    </ConvexSafeWrapper>
  );
}
