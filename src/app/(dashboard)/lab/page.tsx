"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockSignals } from "@/lib/constants/mock-data";
import { institutionalCardClass } from "@/lib/ui-institutional";
import type { LabUiPhase } from "@/lib/types/trading";
import { useConvexAuth, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";

const NO_CONVEX_DATA_AR =
  "لا توجد بيانات Convex بعد — استخدم صفحة قاعدة Convex لإنشاء بيانات تجريبية.";

function phaseBadge(phase: LabUiPhase) {
  switch (phase) {
    case "READY":
      return <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">READY</Badge>;
    case "WAITING":
      return <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-100">WAITING</Badge>;
    case "HOLD":
      return <Badge className="border-slate-500/40 bg-slate-500/15 text-slate-200">HOLD</Badge>;
    case "BLOCKED":
      return <Badge className="border-rose-500/35 bg-rose-500/10 text-rose-200">BLOCKED</Badge>;
    default:
      return null;
  }
}

export default function LabPage() {
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const convexSignals = useQuery(api.coreQueries.getMyLatestSignals, canUseConvex ? {} : "skip");
  const labSymbolsForFilter = useQuery(api.coreQueries.getMyEnabledLabSymbols, canUseConvex ? {} : "skip");
  const protectionEvents = useQuery(api.coreQueries.getMyProtectionEvents, canUseConvex ? {} : "skip");
  const governance = useQuery(api.coreQueries.getMyGovernanceState, canUseConvex ? {} : "skip");
  const committeeReports = useQuery(api.coreQueries.getMyCommitteeReports, canUseConvex ? {} : "skip");

  const executionBlocked =
    !canUseConvex ||
    governance === undefined ||
    governance === null ||
    governance.readOnly ||
    !governance.tradingEnabled;

  const loadingSignalsSection =
    canUseConvex &&
    (convexSignals === undefined || labSymbolsForFilter === undefined);

  const signalsBlockedByLabFilters =
    canUseConvex &&
    labSymbolsForFilter !== undefined &&
    labSymbolsForFilter.length === 0;

  const filteredConvexSignals =
    convexSignals && labSymbolsForFilter && labSymbolsForFilter.length > 0
      ? convexSignals.filter((r) => labSymbolsForFilter.includes(r.symbol))
      : convexSignals ?? [];

  const noMatchesForLabFilter =
    canUseConvex &&
    !loadingSignalsSection &&
    !signalsBlockedByLabFilters &&
    Array.isArray(convexSignals) &&
    convexSignals.length > 0 &&
    Array.isArray(labSymbolsForFilter) &&
    labSymbolsForFilter.length > 0 &&
    filteredConvexSignals.length === 0;

  function fmtOptionalNum(n: number | undefined) {
    if (n === undefined) return "—";
    return (
      <span className="tabular-nums">{Number.isInteger(n) ? n : n.toFixed(n < 10 ? 4 : 2)}</span>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">المختبر المؤسسي</h2>
        <p className="label-secondary mt-1">جدول تجريبي — بدون أزرار تنفيذ.</p>
      </div>

      <Card className={institutionalCardClass("p-4")}>
        <CardHeader className="space-y-2 p-0">
          <CardTitle className="card-title-inst text-base">Convex — قراءة فقط</CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            بيانات Convex للقراءة فقط — لا يوجد تنفيذ MT5 في هذه المرحلة
          </p>
        </CardHeader>
        <CardContent className="space-y-3 p-0 pt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
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
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Button type="button" variant="outline" disabled={executionBlocked} className="shrink-0">
              تنفيذ تجريبي (معطّل)
            </Button>
            {executionBlocked && canUseConvex && governance !== undefined ? (
              <p className="text-muted-foreground text-xs leading-snug">
                التنفيذ معطل — النظام في وضع القراءة فقط
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Alert className="border-amber-500/20 bg-amber-500/5">
        <AlertTitle>تنبيه</AlertTitle>
        <AlertDescription>
          هذه نسخة واجهة Next.js للعرض والقراءة فقط، التنفيذ ما زال غير مفعل هنا.
        </AlertDescription>
      </Alert>

      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">إشارات Convex (قراءة)</CardTitle>
          <p className="text-muted-foreground text-xs">
            من قاعدة البيانات — لا تنفيذ.
          </p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            الأزواج المعروضة حسب إعدادات MT5
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          {!canUseConvex && !isConvexAuthLoading ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>
          ) : loadingSignalsSection ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">جاري تحميل بيانات Convex...</p>
          ) : signalsBlockedByLabFilters ? (
            <p className="text-muted-foreground px-2 py-4 text-sm leading-relaxed">
              لا توجد أزواج مفعّلة للمختبر — فعّل الأزواج من الإعدادات.
            </p>
          ) : convexSignals !== undefined && convexSignals.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>
          ) : noMatchesForLabFilter ? (
            <p className="text-muted-foreground px-2 py-4 text-sm leading-relaxed">
              لا توجد إشارات مطابقة للأزواج المفعّلة للمختبر في الإعدادات.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-amber-500/10 hover:bg-transparent">
                  <TableHead className="text-foreground">الرمز</TableHead>
                  <TableHead className="text-foreground">الإطار</TableHead>
                  <TableHead className="text-foreground">الحكم</TableHead>
                  <TableHead className="text-foreground">الاحتمالية</TableHead>
                  <TableHead className="text-foreground">دخول</TableHead>
                  <TableHead className="text-foreground">وقف</TableHead>
                  <TableHead className="text-foreground">هدف</TableHead>
                  <TableHead className="text-foreground">الحالة</TableHead>
                  <TableHead className="text-foreground">السبب</TableHead>
                  <TableHead className="text-foreground">المصدر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConvexSignals.map((row) => (
                  <TableRow key={row._id} className="border-border/60">
                    <TableCell className="font-medium text-amber-100/90 tabular-nums">{row.symbol}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{row.timeframe}</TableCell>
                    <TableCell>{row.verdict}</TableCell>
                    <TableCell className="tabular-nums">{(row.probability * 100).toFixed(0)}٪</TableCell>
                    <TableCell className="tabular-nums">{fmtOptionalNum(row.entry)}</TableCell>
                    <TableCell className="tabular-nums">{fmtOptionalNum(row.stopLoss)}</TableCell>
                    <TableCell className="tabular-nums">{fmtOptionalNum(row.takeProfit)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{row.status}</TableCell>
                    <TableCell className="max-w-[200px] text-muted-foreground text-xs leading-snug">
                      {row.reason ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{row.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">أحداث الحماية (Convex)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          {!canUseConvex && !isConvexAuthLoading ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>
          ) : isConvexAuthLoading || protectionEvents === undefined ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">جاري تحميل بيانات Convex...</p>
          ) : protectionEvents.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-amber-500/10 hover:bg-transparent">
                  <TableHead className="text-foreground">الخطورة</TableHead>
                  <TableHead className="text-foreground">الرسالة</TableHead>
                  <TableHead className="text-foreground">محظور</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {protectionEvents.map((e) => (
                  <TableRow key={e._id} className="border-border/60">
                    <TableCell>{e.severity}</TableCell>
                    <TableCell className="max-w-[320px] text-muted-foreground text-sm leading-snug">
                      {e.message}
                    </TableCell>
                    <TableCell className="tabular-nums">{e.blocked ? "نعم" : "لا"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">تقارير اللجنة (Convex)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          {!canUseConvex && !isConvexAuthLoading ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>
          ) : isConvexAuthLoading || committeeReports === undefined ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">جاري تحميل بيانات Convex...</p>
          ) : committeeReports.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">{NO_CONVEX_DATA_AR}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-amber-500/10 hover:bg-transparent">
                  <TableHead className="text-foreground">الرمز</TableHead>
                  <TableHead className="text-foreground">عقل السوق</TableHead>
                  <TableHead className="text-foreground">عقل الحماية</TableHead>
                  <TableHead className="text-foreground">عقل التنفيذ</TableHead>
                  <TableHead className="text-foreground">القرار النهائي</TableHead>
                  <TableHead className="text-foreground">ملخص</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {committeeReports.map((r) => (
                  <TableRow key={r._id} className="border-border/60">
                    <TableCell className="font-medium text-amber-100/90">{r.symbol}</TableCell>
                    <TableCell className="tabular-nums">{r.marketMindScore}</TableCell>
                    <TableCell className="tabular-nums">{r.protectionMindScore}</TableCell>
                    <TableCell className="tabular-nums">{r.executionMindScore}</TableCell>
                    <TableCell>{r.finalVerdict}</TableCell>
                    <TableCell className="max-w-[280px] text-muted-foreground text-xs leading-snug">
                      {r.summary}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">إشارات المختبر (وهمية)</CardTitle>
          <p className="text-muted-foreground text-xs">لا تنفيذ — رموز الحالة للعرض فقط.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          <Table>
            <TableHeader>
              <TableRow className="border-amber-500/10 hover:bg-transparent">
                <TableHead className="text-foreground">الزوج</TableHead>
                <TableHead className="text-foreground">الحكم</TableHead>
                <TableHead className="text-foreground">الاحتمالية</TableHead>
                <TableHead className="text-foreground">الحالة</TableHead>
                <TableHead className="text-foreground">مرحلة العرض</TableHead>
                <TableHead className="text-foreground">الإطار</TableHead>
                <TableHead className="text-foreground">السبب</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockSignals.map((row) => (
                <TableRow key={row.id} className="border-border/60">
                  <TableCell className="font-medium text-amber-100/90 tabular-nums">{row.pair}</TableCell>
                  <TableCell>{row.verdict}</TableCell>
                  <TableCell className="tabular-nums">{(row.probability * 100).toFixed(0)}٪</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.status}</TableCell>
                  <TableCell>{phaseBadge(row.labPhase)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{row.timeframe}</TableCell>
                  <TableCell className="max-w-[220px] text-muted-foreground text-xs leading-snug">
                    {row.reason}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
