"use client";

import { Button } from "@/components/ui/button";
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
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";

const NO_CONVEX_DATA_AR =
  "لا توجد بيانات Convex بعد — استخدم صفحة قاعدة Convex لإنشاء بيانات تجريبية.";

function fmtTs(ms: number) {
  return new Date(ms).toLocaleString("ar-SA", { hour12: false });
}

function fmtNum(n: number | undefined) {
  if (n === undefined) return "—";
  return <span className="tabular-nums">{Number.isInteger(n) ? n : n.toFixed(2)}</span>;
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
  const tradeHistoryDeals = useQuery(api.coreQueries.getMyTradeHistoryDeals, canUseConvex ? {} : "skip");
  const syncHistoryMutation = useMutation(api.mt5Bridge.syncReadOnlyTradeHistoryFromLocalService);

  const [historyDays, setHistoryDays] = useState("30");
  const [historySyncBusy, setHistorySyncBusy] = useState(false);
  const [historySyncMessage, setHistorySyncMessage] = useState<string | null>(null);

  async function pullTradeHistoryFromMt5() {
    setHistorySyncMessage(null);
    setHistorySyncBusy(true);
    try {
      const res = await fetch(
        `/api/mt5-readonly/history-deals?days=${encodeURIComponent(historyDays)}`,
        { cache: "no-store" },
      );
      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok || payload.connected === false) {
        setHistorySyncMessage(
          typeof payload.error === "string"
            ? payload.error
            : "فشل جلب السجل من الخدمة المحلية أو MT5 غير متصل.",
        );
        return;
      }
      await syncHistoryMutation({
        payload: {
          connected: Boolean(payload.connected),
          read_only_mode:
            typeof payload.read_only_mode === "boolean" ? payload.read_only_mode : true,
          deals: Array.isArray(payload.deals) ? payload.deals : [],
          from: typeof payload.from === "string" ? payload.from : undefined,
          to: typeof payload.to === "string" ? payload.to : undefined,
          error: typeof payload.error === "string" ? payload.error : undefined,
        },
      });
      setHistorySyncMessage("تم تحديث سجل الصفقات من MT5 (قراءة فقط).");
    } catch {
      setHistorySyncMessage("فشل الاتصال بالخدمة المحلية.");
    } finally {
      setHistorySyncBusy(false);
    }
  }

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
        <CardHeader className="space-y-2 border-b border-amber-500/10 px-4 py-4 md:px-6">
          <CardTitle className="card-title-inst">سجل صفقات MT5 — قراءة فقط</CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            هذا سجل قراءة فقط من MT5 ولا توجد أي أوامر تداول.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <span>نطاق الأيام</span>
              <select
                className="rounded-md border border-amber-500/20 bg-background px-2 py-1.5 text-foreground text-sm"
                value={historyDays}
                onChange={(e) => setHistoryDays(e.target.value)}
              >
                <option value="7">7</option>
                <option value="30">30</option>
                <option value="90">90</option>
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUseConvex || historySyncBusy}
              onClick={() => void pullTradeHistoryFromMt5()}
            >
              {historySyncBusy ? "جاري السحب…" : "سحب سجل الصفقات من MT5"}
            </Button>
            {historySyncMessage ? (
              <span className="text-muted-foreground text-xs leading-snug">{historySyncMessage}</span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-4 md:px-4">
          {convexEmptyOrLoading(tradeHistoryDeals) ??
            (tradeHistoryDeals && (
              <Table>
                <TableHeader>
                  <TableRow className="border-amber-500/10 hover:bg-transparent">
                    <TableHead className="text-foreground">الوقت</TableHead>
                    <TableHead className="text-foreground">الرمز</TableHead>
                    <TableHead className="text-foreground">النوع</TableHead>
                    <TableHead className="text-foreground">الحجم</TableHead>
                    <TableHead className="text-foreground">السعر</TableHead>
                    <TableHead className="text-foreground">الربح</TableHead>
                    <TableHead className="text-foreground">العمولة</TableHead>
                    <TableHead className="text-foreground">السواب</TableHead>
                    <TableHead className="text-foreground">تعليق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradeHistoryDeals.map((row) => (
                    <TableRow key={row._id} className="border-border/60">
                      <TableCell className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                        {fmtTs(row.time)}
                      </TableCell>
                      <TableCell className="font-medium text-amber-100/90 tabular-nums">{row.symbol}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{row.type ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{row.volume}</TableCell>
                      <TableCell className="tabular-nums">{row.price}</TableCell>
                      <TableCell className="tabular-nums">{fmtNum(row.profit)}</TableCell>
                      <TableCell className="tabular-nums">{fmtNum(row.commission)}</TableCell>
                      <TableCell className="tabular-nums">{fmtNum(row.swap)}</TableCell>
                      <TableCell className="max-w-[200px] text-muted-foreground text-xs">
                        {row.comment ?? "—"}
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
