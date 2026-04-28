"use client";

import { Badge } from "@/components/ui/badge";
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
import { institutionalCardClass } from "@/lib/ui-institutional";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";

const NO_CONVEX_DATA_AR =
  "لا توجد بيانات Convex بعد — استخدم صفحة قاعدة Convex لإنشاء بيانات تجريبية.";

const HISTORY_DEAL_CHUNK = 200;

function fmtTs(ms: number) {
  return new Date(ms).toLocaleString("ar-SA", { hour12: false });
}

function fmtNum(n: number | undefined) {
  if (n === undefined) return "—";
  return <span className="tabular-nums">{Number.isInteger(n) ? n : n.toFixed(2)}</span>;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-amber-500/15 bg-muted/20 px-3 py-2">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className="font-semibold text-amber-100/90 text-sm tabular-nums">{value}</p>
    </div>
  );
}

function mapPositionType(value: string | undefined) {
  if (value === "0" || value?.toUpperCase() === "BUY") return "شراء";
  if (value === "1" || value?.toUpperCase() === "SELL") return "بيع";
  return "غير محدد";
}

function mapDealType(value: string | undefined) {
  if (value === "0" || value?.toUpperCase() === "BUY") return "شراء";
  if (value === "1" || value?.toUpperCase() === "SELL") return "بيع";
  if (value === "2") return "رصيد";
  return "غير محدد";
}

function mapEntry(value: string | undefined) {
  if (value === "0" || value?.toUpperCase() === "IN") return "دخول";
  if (value === "1" || value?.toUpperCase() === "OUT") return "خروج / مغلقة";
  if (value === "2" || value?.toUpperCase() === "INOUT") return "دخول/خروج";
  if (value === "3" || value?.toUpperCase() === "OUT_BY") return "إغلاق مقابل";
  return "غير محدد";
}

export default function ReportsPage() {
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const governance = useQuery(api.coreQueries.getMyGovernanceState, canUseConvex ? {} : "skip");
  const tradeHistoryDeals = useQuery(api.coreQueries.getMyTradeHistoryDeals, canUseConvex ? {} : "skip");
  const activePositions = useQuery(api.coreQueries.getMyActiveMt5Positions, canUseConvex ? {} : "skip");
  const syncHistoryMutation = useMutation(api.mt5Bridge.syncReadOnlyTradeHistoryFromLocalService);

  const [historyDays, setHistoryDays] = useState("30");
  const [historySyncBusy, setHistorySyncBusy] = useState(false);
  const [historySyncMessage, setHistorySyncMessage] = useState<string | null>(null);
  const mt5Stats = useMemo(() => {
    const active = activePositions ?? [];
    const history = tradeHistoryDeals ?? [];
    const floating = active.reduce((sum, row) => sum + row.profit, 0);
    const buyCount = history.filter((row) => mapDealType(row.type) === "شراء").length;
    const sellCount = history.filter((row) => mapDealType(row.type) === "بيع").length;
    const winners = history.filter((row) => row.profit > 0).length;
    const losers = history.filter((row) => row.profit < 0).length;
    const totalProfit = history.reduce((sum, row) => sum + (row.profit > 0 ? row.profit : 0), 0);
    const totalLoss = history.reduce((sum, row) => sum + (row.profit < 0 ? row.profit : 0), 0);
    const totalCommissionSwap = history.reduce(
      (sum, row) => sum + (row.commission ?? 0) + (row.swap ?? 0),
      0,
    );
    const totalLot = history.reduce((sum, row) => sum + row.volume, 0);
    const net = history.reduce(
      (sum, row) => sum + row.profit + (row.commission ?? 0) + (row.swap ?? 0) + (row.fee ?? 0),
      0,
    );
    return {
      activeCount: active.length,
      floating,
      historyCount: history.length,
      buyCount,
      sellCount,
      winners,
      losers,
      totalProfit,
      totalLoss,
      net,
      totalCommissionSwap,
      totalLot,
    };
  }, [activePositions, tradeHistoryDeals]);

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
      const deals = Array.isArray(payload.deals) ? payload.deals : [];
      const syncRunId = `hist-${Date.now()}`;
      const chunks: unknown[][] = [];
      for (let i = 0; i < deals.length; i += HISTORY_DEAL_CHUNK) {
        chunks.push(deals.slice(i, i + HISTORY_DEAL_CHUNK));
      }
      const totalChunks = Math.max(1, chunks.length);
      const fromStr = typeof payload.from === "string" ? payload.from : undefined;
      const toStr = typeof payload.to === "string" ? payload.to : undefined;
      const readOnly =
        typeof payload.read_only_mode === "boolean" ? payload.read_only_mode : true;

      for (let i = 0; i < totalChunks; i++) {
        const chunk = (chunks[i] ?? []) as unknown[];
        try {
          await syncHistoryMutation({
            connected: true,
            deals: chunk,
            read_only_mode: readOnly,
            from: fromStr,
            to: toStr,
            syncRunId,
            chunkIndex: i,
            totalChunks,
          });
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          setHistorySyncMessage(
            `فشلت مزامنة السجل في الدفعة ${i + 1} من ${totalChunks}. ${reason}`,
          );
          return;
        }
      }
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
          <CardTitle className="card-title-inst">تقرير صفقات MT5 — قراءة فقط</CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            هذا التقرير قراءة فقط من MT5 ولا توجد أي أوامر تداول.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 px-2 pb-4 md:px-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="عدد الصفقات النشطة" value={String(mt5Stats.activeCount)} />
            <StatCard label="إجمالي الربح/الخسارة العائم" value={mt5Stats.floating.toFixed(2)} />
            <StatCard label="عدد صفقات السجل" value={String(mt5Stats.historyCount)} />
            <StatCard label="صفقات شراء" value={String(mt5Stats.buyCount)} />
            <StatCard label="صفقات بيع" value={String(mt5Stats.sellCount)} />
            <StatCard label="الصفقات الرابحة" value={String(mt5Stats.winners)} />
            <StatCard label="الصفقات الخاسرة" value={String(mt5Stats.losers)} />
            <StatCard label="إجمالي الربح" value={mt5Stats.totalProfit.toFixed(2)} />
            <StatCard label="إجمالي الخسارة" value={mt5Stats.totalLoss.toFixed(2)} />
            <StatCard label="صافي النتيجة" value={mt5Stats.net.toFixed(2)} />
            <StatCard label="إجمالي العمولة والسواب" value={mt5Stats.totalCommissionSwap.toFixed(2)} />
            <StatCard label="إجمالي اللوت" value={mt5Stats.totalLot.toFixed(2)} />
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-amber-100/90 text-sm">A) الصفقات النشطة من MT5</h4>
            <div className="overflow-x-auto">
              {convexEmptyOrLoading(activePositions, false) ??
                (activePositions && activePositions.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-4 text-sm">
                    لا توجد صفقات نشطة حاليًا في MT5.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-amber-500/10 hover:bg-transparent">
                        <TableHead className="text-foreground">الحالة</TableHead>
                        <TableHead className="text-foreground">التذكرة</TableHead>
                        <TableHead className="text-foreground">الرمز</TableHead>
                        <TableHead className="text-foreground">النوع</TableHead>
                        <TableHead className="text-foreground">الحجم</TableHead>
                        <TableHead className="text-foreground">سعر الدخول</TableHead>
                        <TableHead className="text-foreground">السعر الحالي</TableHead>
                        <TableHead className="text-foreground">وقف الخسارة</TableHead>
                        <TableHead className="text-foreground">جني الربح</TableHead>
                        <TableHead className="text-foreground">الربح/الخسارة العائم</TableHead>
                        <TableHead className="text-foreground">المصدر</TableHead>
                        <TableHead className="text-foreground">آخر مزامنة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activePositions?.map((row) => (
                        <TableRow key={row._id} className="border-border/60">
                          <TableCell>
                            <Badge variant="outline" className="border-amber-500/30 text-amber-100/90">نشطة</Badge>
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground text-xs">{row.ticket ?? "—"}</TableCell>
                          <TableCell className="font-medium text-amber-100/90 tabular-nums">{row.symbol}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{mapPositionType(row.type)}</Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">{row.volume}</TableCell>
                          <TableCell className="tabular-nums">{row.openPrice}</TableCell>
                          <TableCell className="tabular-nums">{row.currentPrice}</TableCell>
                          <TableCell className="tabular-nums">{fmtNum(row.stopLoss)}</TableCell>
                          <TableCell className="tabular-nums">{fmtNum(row.takeProfit)}</TableCell>
                          <TableCell className="tabular-nums">{fmtNum(row.profit)}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{row.source}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                            {fmtTs(row.capturedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-amber-100/90 text-sm">B) سجل الصفقات المغلقة / التاريخية من MT5</h4>
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
            <div className="overflow-x-auto">
              {convexEmptyOrLoading(tradeHistoryDeals, false) ??
                (tradeHistoryDeals && tradeHistoryDeals.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-4 text-sm">
                    لا يوجد سجل صفقات بعد — اضغط سحب سجل الصفقات من MT5.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-amber-500/10 hover:bg-transparent">
                        <TableHead className="text-foreground">الحالة</TableHead>
                        <TableHead className="text-foreground">رقم الصفقة</TableHead>
                        <TableHead className="text-foreground">الرمز</TableHead>
                        <TableHead className="text-foreground">النوع</TableHead>
                        <TableHead className="text-foreground">الدخول/الخروج</TableHead>
                        <TableHead className="text-foreground">الحجم</TableHead>
                        <TableHead className="text-foreground">السعر</TableHead>
                        <TableHead className="text-foreground">الربح</TableHead>
                        <TableHead className="text-foreground">العمولة</TableHead>
                        <TableHead className="text-foreground">السواب</TableHead>
                        <TableHead className="text-foreground">الصافي</TableHead>
                        <TableHead className="text-foreground">الوقت</TableHead>
                        <TableHead className="text-foreground">التعليق</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tradeHistoryDeals?.map((row) => {
                        const entry = mapEntry(row.entry);
                        const net = row.profit + (row.commission ?? 0) + (row.swap ?? 0) + (row.fee ?? 0);
                        return (
                          <TableRow key={row._id} className="border-border/60">
                            <TableCell>
                              <Badge variant="outline" className="border-amber-500/30 text-amber-100/90">
                                {entry === "خروج / مغلقة" ? "مغلقة" : entry}
                              </Badge>
                            </TableCell>
                            <TableCell className="tabular-nums text-muted-foreground text-xs">{row.dealTicket}</TableCell>
                            <TableCell className="font-medium text-amber-100/90 tabular-nums">{row.symbol}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{mapDealType(row.type)}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{entry}</TableCell>
                            <TableCell className="tabular-nums">{row.volume}</TableCell>
                            <TableCell className="tabular-nums">{row.price}</TableCell>
                            <TableCell>
                              <Badge variant={row.profit >= 0 ? "outline" : "secondary"}>
                                {row.profit >= 0 ? "رابحة" : "خاسرة"}
                              </Badge>
                              <span className="mr-2 tabular-nums">{row.profit.toFixed(2)}</span>
                            </TableCell>
                            <TableCell className="tabular-nums">{(row.commission ?? 0).toFixed(2)}</TableCell>
                            <TableCell className="tabular-nums">{(row.swap ?? 0).toFixed(2)}</TableCell>
                            <TableCell className="tabular-nums">{net.toFixed(2)}</TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                              {fmtTs(row.time)}
                            </TableCell>
                            <TableCell className="max-w-[220px] text-muted-foreground text-xs">{row.comment ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ))}
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
