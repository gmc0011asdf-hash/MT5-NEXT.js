"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const NO_MT5_DATA_AR = "لا توجد بيانات MT5 حقيقية بعد — شغّل خدمة MT5 المحلية وأعد المزامنة.";

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

  const tradeHistoryDeals = useQuery(api.coreQueries.getMyTradeHistoryDeals, canUseConvex ? {} : "skip");
  const activePositions = useQuery(api.coreQueries.getMyActiveMt5Positions, canUseConvex ? {} : "skip");
  const summary = useQuery(api.coreQueries.getMyRealMt5ReportSummary, canUseConvex ? {} : "skip");
  const syncHistoryMutation = useMutation(api.mt5Bridge.syncReadOnlyTradeHistoryFromLocalService);
  const syncSnapshotMutation = useMutation(api.mt5Bridge.syncReadOnlySnapshotFromLocalService);

  const [historyDays, setHistoryDays] = useState("30");
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [historySyncBusy, setHistorySyncBusy] = useState(false);
  const [activeSyncBusy, setActiveSyncBusy] = useState(false);
  const [historySyncMessage, setHistorySyncMessage] = useState<string | null>(null);
  const [activeSyncMessage, setActiveSyncMessage] = useState<string | null>(null);
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

  const symbolOptions = useMemo(() => {
    const set = new Set<string>();
    (activePositions ?? []).forEach((r) => set.add(r.symbol));
    (tradeHistoryDeals ?? []).forEach((r) => set.add(r.symbol));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [activePositions, tradeHistoryDeals]);

  const activeFiltered = useMemo(() => {
    const rows = activePositions ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (symbolFilter !== "all" && row.symbol !== symbolFilter) return false;
      if (statusFilter !== "all" && statusFilter !== "نشطة") return false;
      if (typeFilter !== "all" && mapPositionType(row.type) !== typeFilter) return false;
      if (resultFilter === "رابحة" && row.profit <= 0) return false;
      if (resultFilter === "خاسرة" && row.profit >= 0) return false;
      if (!q) return true;
      const hay = `${row.ticket ?? ""} ${row.comment ?? ""} ${row.symbol}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activePositions, symbolFilter, statusFilter, typeFilter, resultFilter, search]);

  const historyFiltered = useMemo(() => {
    const rows = tradeHistoryDeals ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const dealType = mapDealType(row.type);
      if (symbolFilter !== "all" && row.symbol !== symbolFilter) return false;
      if (statusFilter !== "all" && statusFilter !== "مغلقة") return false;
      if (typeFilter !== "all" && dealType !== typeFilter) return false;
      if (resultFilter === "رابحة" && row.profit <= 0) return false;
      if (resultFilter === "خاسرة" && row.profit >= 0) return false;
      if (!q) return true;
      const hay = `${row.dealTicket} ${row.comment ?? ""} ${row.symbol}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tradeHistoryDeals, symbolFilter, statusFilter, typeFilter, resultFilter, search]);

  // ── KING_GOLD TP Analysis (Phase 2 — client-side parsing) ──────────────────
  const kingGoldAnalysis = useMemo(() => {
    const deals = tradeHistoryDeals ?? [];
    const kingDeals = deals.filter((d) => d.comment?.startsWith("KING_GOLD"));
    if (kingDeals.length === 0) return null;

    const groups: Record<string, { profit: number; count: number; wins: number }> = {
      TP1: { profit: 0, count: 0, wins: 0 },
      TP2: { profit: 0, count: 0, wins: 0 },
      TP3: { profit: 0, count: 0, wins: 0 },
    };
    let totalProfit = 0;
    let totalCount  = 0;
    const groupMap: Record<string, number> = {};

    for (const d of kingDeals) {
      const comment = d.comment ?? "";
      const tpMatch = comment.match(/TP([123])/);
      const label   = tpMatch ? `TP${tpMatch[1]}` : "TP1";
      if (!groups[label]) continue;
      groups[label].count++;
      groups[label].profit += d.profit;
      if (d.profit > 0) groups[label].wins++;
      totalProfit += d.profit;
      totalCount++;

      // Group tracking
      const gMatch = comment.match(/G(\S+)/);
      const gId    = gMatch ? gMatch[1] : "unknown";
      groupMap[gId] = (groupMap[gId] ?? 0) + 1;
    }

    return {
      totalDeals:   totalCount,
      totalProfit:  totalProfit,
      uniqueGroups: Object.keys(groupMap).length,
      byTarget:     groups,
    };
  }, [tradeHistoryDeals]);

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

  async function refreshActivePositionsFromMt5() {
    setActiveSyncMessage(null);
    setActiveSyncBusy(true);
    try {
      const res = await fetch("/api/mt5-readonly/snapshot", { cache: "no-store" });
      const payload = (await res.json()) as { ok?: boolean; snapshot?: unknown; error?: string };
      if (!res.ok || !payload.ok || payload.snapshot === undefined) {
        setActiveSyncMessage(payload.error ?? "فشل سحب الصفقات النشطة من MT5.");
        return;
      }
      const result = await syncSnapshotMutation({ snapshot: payload.snapshot as never });
      if (result && typeof result === "object" && "ok" in result && result.ok === false) {
        setActiveSyncMessage("تعذّر تحديث الصفقات النشطة من MT5.");
        return;
      }
      setActiveSyncMessage("تم تحديث الصفقات النشطة من MT5 بنجاح (قراءة فقط).");
    } catch {
      setActiveSyncMessage("فشل الاتصال بخدمة MT5 المحلية.");
    } finally {
      setActiveSyncBusy(false);
    }
  }

  function convexEmptyOrLoading(rows: unknown[] | undefined | null, loadingLabel = true) {
    if (!canUseConvex && !isConvexAuthLoading) {
      return <p className="text-muted-foreground px-2 py-4 text-sm">{NO_MT5_DATA_AR}</p>;
    }
    if (isConvexAuthLoading || rows === undefined || rows === null) {
      return (
        <p className="text-muted-foreground px-2 py-4 text-sm">
          {loadingLabel ? "جاري تحميل بيانات Convex..." : null}
        </p>
      );
    }
    if (rows.length === 0) {
      return <p className="text-muted-foreground px-2 py-4 text-sm">{NO_MT5_DATA_AR}</p>;
    }
    return null;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="page-title">التقارير</h2>
        <p className="label-secondary mt-1">تقارير MT5 الحقيقية — قراءة فقط.</p>
      </div>

      <Card className={institutionalCardClass("p-4")}>
        <CardHeader className="space-y-2 p-0">
          <CardTitle className="card-title-inst text-base">تقارير MT5 — قراءة فقط</CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            هذه التقارير قراءة فقط من MT5 ولا توجد أي أوامر تداول.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 p-0 pt-3 text-sm">
          <span className="text-muted-foreground">
            Convex مصادق:{" "}
            <span className="tabular-nums text-amber-100/90">{String(isAuthenticated)}</span>
          </span>
          {isConvexAuthLoading ? (
            <span className="text-muted-foreground text-xs">جاري تحميل المصادقة...</span>
          ) : null}
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">الفترة</span>
              <select className="w-full rounded-md border border-amber-500/20 bg-background px-2 py-1.5 text-sm" value={historyDays} onChange={(e) => setHistoryDays(e.target.value)}>
                <option value="7">7</option>
                <option value="30">30</option>
                <option value="90">90</option>
                <option value="365">365</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">الرمز</span>
              <select className="w-full rounded-md border border-amber-500/20 bg-background px-2 py-1.5 text-sm" value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)}>
                <option value="all">All</option>
                {symbolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">النوع</span>
              <select className="w-full rounded-md border border-amber-500/20 bg-background px-2 py-1.5 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">الكل</option>
                <option value="شراء">شراء</option>
                <option value="بيع">بيع</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">الحالة</span>
              <select className="w-full rounded-md border border-amber-500/20 bg-background px-2 py-1.5 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">الكل</option>
                <option value="نشطة">نشطة</option>
                <option value="مغلقة">مغلقة</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">النتيجة</span>
              <select className="w-full rounded-md border border-amber-500/20 bg-background px-2 py-1.5 text-sm" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
                <option value="all">الكل</option>
                <option value="رابحة">رابحة</option>
                <option value="خاسرة">خاسرة</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">بحث</span>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="رقم التذكرة أو التعليق" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!canUseConvex || historySyncBusy} onClick={() => void pullTradeHistoryFromMt5()}>
              {historySyncBusy ? "جاري السحب…" : "سحب سجل الصفقات من MT5"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!canUseConvex || activeSyncBusy} onClick={() => void refreshActivePositionsFromMt5()}>
              {activeSyncBusy ? "جاري التحديث…" : "تحديث الصفقات النشطة من MT5"}
            </Button>
            {historySyncMessage ? <span className="text-muted-foreground text-xs">{historySyncMessage}</span> : null}
            {activeSyncMessage ? <span className="text-muted-foreground text-xs">{activeSyncMessage}</span> : null}
          </div>
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
            <StatCard label="عدد الصفقات النشطة" value={String(summary?.activeCount ?? mt5Stats.activeCount)} />
            <StatCard label="إجمالي الربح/الخسارة العائم" value={(summary?.floatingProfit ?? mt5Stats.floating).toFixed(2)} />
            <StatCard label="عدد صفقات السجل" value={String(summary?.historyCount ?? mt5Stats.historyCount)} />
            <StatCard label="عدد صفقات الشراء" value={String(summary?.buyCount ?? mt5Stats.buyCount)} />
            <StatCard label="عدد صفقات البيع" value={String(summary?.sellCount ?? mt5Stats.sellCount)} />
            <StatCard label="الصفقات الرابحة" value={String(mt5Stats.winners)} />
            <StatCard label="الصفقات الخاسرة" value={String(mt5Stats.losers)} />
            <StatCard label="إجمالي الربح" value={mt5Stats.totalProfit.toFixed(2)} />
            <StatCard label="إجمالي الخسارة" value={mt5Stats.totalLoss.toFixed(2)} />
            <StatCard label="صافي النتيجة" value={mt5Stats.net.toFixed(2)} />
            <StatCard label="إجمالي العمولة" value={(summary?.totalCommission ?? 0).toFixed(2)} />
            <StatCard label="إجمالي السواب" value={(summary?.totalSwap ?? 0).toFixed(2)} />
            <StatCard label="إجمالي اللوت" value={mt5Stats.totalLot.toFixed(2)} />
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-amber-100/90 text-sm">A) الصفقات النشطة من MT5</h4>
            <div className="overflow-x-auto">
              {convexEmptyOrLoading(activePositions, false) ??
                (activeFiltered.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-4 text-sm">
                    لا توجد صفقات نشطة حاليًا في MT5.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-amber-500/10 hover:bg-transparent">
                        <TableHead className="text-foreground">الحالة</TableHead>
                        <TableHead className="text-foreground">رقم التذكرة</TableHead>
                        <TableHead className="text-foreground">الرمز</TableHead>
                        <TableHead className="text-foreground">النوع</TableHead>
                        <TableHead className="text-foreground">الحجم</TableHead>
                        <TableHead className="text-foreground">سعر الدخول</TableHead>
                        <TableHead className="text-foreground">السعر الحالي</TableHead>
                        <TableHead className="text-foreground">وقف الخسارة</TableHead>
                        <TableHead className="text-foreground">جني الربح</TableHead>
                        <TableHead className="text-foreground">الربح/الخسارة العائم</TableHead>
                        <TableHead className="text-foreground">التعليق</TableHead>
                        <TableHead className="text-foreground">آخر مزامنة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeFiltered.map((row) => (
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
                          <TableCell className="max-w-[160px] text-muted-foreground text-xs">{row.comment ?? "—"}</TableCell>
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
            <h4 className="font-semibold text-amber-100/90 text-sm">B) سجل الصفقات المغلقة من MT5 — قراءة فقط</h4>
            <div className="overflow-x-auto">
              {convexEmptyOrLoading(tradeHistoryDeals, false) ??
                (historyFiltered.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-4 text-sm">
                    لا يوجد سجل صفقات مغلقة بعد — اضغط سحب سجل الصفقات من MT5.
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
                      {historyFiltered.map((row) => {
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

      {/* ── KING_GOLD TP Analysis ─────────────────────────────────────────── */}
      {kingGoldAnalysis && (
        <Card className={institutionalCardClass("p-0")}>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-amber-300/90">
              نتائج تجارب KING_GOLD — تحليل TP1 / TP2 / TP3
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4" dir="rtl">
              <div className="grid grid-cols-3 gap-3 text-center">
                <StatCard label="إجمالي صفقات النظام" value={String(kingGoldAnalysis.totalDeals)} />
                <StatCard label="إجمالي الربح/الخسارة" value={`$${kingGoldAnalysis.totalProfit.toFixed(2)}`} />
                <StatCard label="مجموعات التنفيذ" value={String(kingGoldAnalysis.uniqueGroups)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30 text-muted-foreground">
                      <th className="text-right pb-2 px-2">الهدف</th>
                      <th className="text-right pb-2 px-2">عدد الصفقات</th>
                      <th className="text-right pb-2 px-2">نسبة النجاح</th>
                      <th className="text-right pb-2 px-2">إجمالي P&L</th>
                      <th className="text-right pb-2 px-2">متوسط P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["TP1", "TP2", "TP3"] as const).map((label) => {
                      const g = kingGoldAnalysis.byTarget[label];
                      if (!g || g.count === 0) return null;
                      const winRate = g.count > 0 ? Math.round((g.wins / g.count) * 100) : 0;
                      const avgPnL  = g.count > 0 ? g.profit / g.count : 0;
                      return (
                        <tr key={label} className="border-b border-border/10">
                          <td className="py-1.5 px-2 font-semibold text-cyan-300">{label}</td>
                          <td className="py-1.5 px-2 tabular-nums">{g.count}</td>
                          <td className={`py-1.5 px-2 font-semibold tabular-nums ${winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                            {winRate}%
                          </td>
                          <td className={`py-1.5 px-2 tabular-nums font-mono ${g.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {g.profit >= 0 ? "+" : ""}{g.profit.toFixed(2)}
                          </td>
                          <td className={`py-1.5 px-2 tabular-nums font-mono ${avgPnL >= 0 ? "text-emerald-300/80" : "text-red-300/80"}`}>
                            {avgPnL >= 0 ? "+" : ""}{avgPnL.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground/50">
                يُعرض فقط سجلات من MT5 تبدأ بـ KING_GOLD — مزامنة من زر "مزامنة سجل الصفقات" أعلاه.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
