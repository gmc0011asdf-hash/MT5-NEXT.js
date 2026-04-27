"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mockDecisionReport } from "@/lib/constants/mock-data";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { useConvexAuth, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";

const NO_CONVEX_DATA_AR =
  "لا توجد بيانات Convex بعد — استخدم صفحة قاعدة Convex لإنشاء بيانات تجريبية.";

function fmtTs(ms: number) {
  return new Date(ms).toLocaleString("ar-SA", { hour12: false });
}

export default function ReportsPage() {
  const r = mockDecisionReport;

  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const auditEvents = useQuery(api.coreQueries.getMyAuditEvents, canUseConvex ? {} : "skip");
  const committeeReports = useQuery(api.coreQueries.getMyCommitteeReports, canUseConvex ? {} : "skip");
  const protectionEvents = useQuery(api.coreQueries.getMyProtectionEvents, canUseConvex ? {} : "skip");
  const signalSnapshots = useQuery(api.coreQueries.getMySignalReportSnapshots, canUseConvex ? {} : "skip");
  const governance = useQuery(api.coreQueries.getMyGovernanceState, canUseConvex ? {} : "skip");

  function convexEmptyOrLoading(rows: unknown[] | undefined | null, loadingLabel = true) {
    if (!canUseConvex && !isConvexAuthLoading) {
      return <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>;
    }
    if (isConvexAuthLoading || rows === undefined || rows === null) {
      return (
        <p className="text-muted-foreground px-2 py-4 text-sm">
          {loadingLabel ? "جاري تحميل بيانات Convex..." : null}
        </p>
      );
    }
    if (rows.length === 0) {
      return <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>;
    }
    return null;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">التقارير</h2>
        <p className="label-secondary mt-1">بطاقات عرض — بيانات آمنة وغير حية. لا ضمانات ربح.</p>
      </div>

      <Card className={institutionalCardClass("p-4")}>
        <CardHeader className="space-y-2 p-0">
          <CardTitle className="card-title-inst text-base">تقارير Convex — قراءة فقط</CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            تقارير Convex للقراءة فقط — لا يوجد تنفيذ MT5 في هذه المرحلة
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
          <CardTitle className="card-title-inst">أحداث التدقيق (Convex)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          {convexEmptyOrLoading(auditEvents) ??
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

      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">تقارير اللجنة (Convex)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          {convexEmptyOrLoading(committeeReports) ??
            (committeeReports && (
              <Table>
                <TableHeader>
                  <TableRow className="border-amber-500/10 hover:bg-transparent">
                    <TableHead className="text-foreground">الرمز</TableHead>
                    <TableHead className="text-foreground">القرار النهائي</TableHead>
                    <TableHead className="text-foreground">عقل السوق</TableHead>
                    <TableHead className="text-foreground">عقل الحماية</TableHead>
                    <TableHead className="text-foreground">عقل التنفيذ</TableHead>
                    <TableHead className="text-foreground">ملخص</TableHead>
                    <TableHead className="text-foreground">الوقت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {committeeReports.map((row) => (
                    <TableRow key={row._id} className="border-border/60">
                      <TableCell className="font-medium text-amber-100/90">{row.symbol}</TableCell>
                      <TableCell>{row.finalVerdict}</TableCell>
                      <TableCell className="tabular-nums">{row.marketMindScore}</TableCell>
                      <TableCell className="tabular-nums">{row.protectionMindScore}</TableCell>
                      <TableCell className="tabular-nums">{row.executionMindScore}</TableCell>
                      <TableCell className="max-w-[220px] text-muted-foreground text-xs leading-snug">
                        {row.summary}
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
          <CardTitle className="card-title-inst">أحداث الحماية (Convex)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          {convexEmptyOrLoading(protectionEvents) ??
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
          <CardTitle className="card-title-inst">لقطات الإشارات (Convex)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          {convexEmptyOrLoading(signalSnapshots) ??
            (signalSnapshots && (
              <Table>
                <TableHeader>
                  <TableRow className="border-amber-500/10 hover:bg-transparent">
                    <TableHead className="text-foreground">الرمز</TableHead>
                    <TableHead className="text-foreground">الإطار</TableHead>
                    <TableHead className="text-foreground">الحكم</TableHead>
                    <TableHead className="text-foreground">الاحتمالية</TableHead>
                    <TableHead className="text-foreground">الحالة</TableHead>
                    <TableHead className="text-foreground">المصدر</TableHead>
                    <TableHead className="text-foreground">الوقت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signalSnapshots.map((row) => (
                    <TableRow key={row._id} className="border-border/60">
                      <TableCell className="font-medium text-amber-100/90">{row.symbol}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{row.timeframe}</TableCell>
                      <TableCell>{row.verdict}</TableCell>
                      <TableCell className="tabular-nums">{(row.probability * 100).toFixed(0)}٪</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{row.status}</TableCell>
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card className={institutionalCardClass("p-4 md:col-span-2")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">القرار المؤسسي</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0">
            <p className="text-muted-foreground text-sm">{r.title}</p>
            <p className="border-t border-amber-500/10 pt-2 text-foreground text-sm leading-relaxed">
              {r.mainReason}
            </p>
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">السبب الرئيسي</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm leading-relaxed">{r.mainReason}</CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">عوامل الدعم</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="list-inside list-disc space-y-1.5 text-muted-foreground text-sm leading-relaxed">
              {r.supportFactors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">عوامل المنع</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="list-inside list-disc space-y-1.5 text-muted-foreground text-sm leading-relaxed">
              {r.blockFactors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">خطة الصفقة</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm leading-relaxed">{r.tradePlan}</CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4 md:col-span-2")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">ملاحظة الثقة</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-muted-foreground text-sm leading-relaxed">{r.confidenceNote}</CardContent>
        </Card>
      </div>
    </div>
  );
}
