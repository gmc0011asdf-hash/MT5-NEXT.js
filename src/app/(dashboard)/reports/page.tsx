"use client";

import { ConvexSafeWrapper } from "@/components/gold-pro/ConvexSafeWrapper";
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

// ── Live MT5 History types ────────────────────────────────────────────────────

type RawMT5Deal = {
  ticket:      number;
  position_id: number;
  symbol:      string;
  type:        number;
  entry:       number;
  volume:      number;
  price:       number;
  profit:      number;
  commission:  number;
  swap:        number;
  time:        number;
  comment?:    string;
};

type GroupedMT5Trade = {
  positionId:  string;
  symbol:      string;
  direction:   string;
  volume:      number;
  openPrice:   number | null;
  openTime:    number | null;
  closePrice:  number | null;
  closeTime:   number | null;
  profit:      number;
  commission:  number;
  swap:        number;
  net:         number;
  comment:     string;
  isOpen:      boolean;
};

/** Groups raw MT5 deals (IN + OUT legs) into complete position-level trades. */
function groupDealsIntoTrades(deals: RawMT5Deal[]): GroupedMT5Trade[] {
  const map = new Map<string, RawMT5Deal[]>();
  for (const d of deals) {
    if (!d.symbol) continue; // skip balance / deposit deals
    const key = String(d.position_id || d.ticket);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return [...map.entries()]
    .map(([posId, group]) => {
      const inD  = group.find((d) => d.entry === 0);
      const outD = group.find((d) => d.entry === 1);
      const profit     = group.reduce((s, d) => s + d.profit, 0);
      const commission = group.reduce((s, d) => s + (d.commission || 0), 0);
      const swap       = group.reduce((s, d) => s + (d.swap || 0), 0);
      const t = inD?.type ?? group[0]?.type;
      return {
        positionId: posId,
        symbol:     group[0].symbol,
        direction:  t === 0 ? "BUY" : t === 1 ? "SELL" : String(t ?? "?"),
        volume:     inD?.volume ?? group[0]?.volume ?? 0,
        openPrice:  inD?.price  ?? null,
        openTime:   inD?.time   ?? null,
        closePrice: outD?.price ?? null,
        closeTime:  outD?.time  ?? null,
        profit,
        commission,
        swap,
        net:     profit + commission + swap,
        comment: outD?.comment ?? inD?.comment ?? "",
        isOpen:  !outD,
      };
    })
    .sort((a, b) => (b.closeTime ?? b.openTime ?? 0) - (a.closeTime ?? a.openTime ?? 0));
}

function ReportsPageContent() {
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const tradeHistoryDeals = useQuery(api.coreQueries.getMyTradeHistoryDeals, canUseConvex ? {} : "skip");
  const historyMeta       = useQuery(api.coreQueries.getMyHistorySyncMeta,   canUseConvex ? {} : "skip");
  const freshPositionsResult = useQuery(api.coreQueries.getMyFreshActiveMt5Positions, canUseConvex ? {} : "skip");
  const activePositions = freshPositionsResult?.positions ?? [];
  const positionsFresh  = freshPositionsResult?.isFresh   ?? false;
  const positionsLastSyncAt = freshPositionsResult?.lastSyncAt ?? null;
  const summary = useQuery(api.coreQueries.getMyRealMt5ReportSummary, canUseConvex ? {} : "skip");
  const syncHistoryMutation = useMutation(api.mt5Bridge.syncReadOnlyTradeHistoryFromLocalService);
  const syncSnapshotMutation = useMutation(api.mt5Bridge.syncReadOnlySnapshotFromLocalService);
  // Gold Journal queries
  const goldSnapshots    = useQuery(api.goldJournal.getMyRecentSnapshots,       canUseConvex ? { limit: 50 } : "skip");
  const goldExecGroups   = useQuery(api.goldJournal.getMyRecentExecutionGroups, canUseConvex ? { limit: 30 } : "skip");
  const goldPendingPlans = useQuery(api.goldJournal.getMyPendingPlans,          canUseConvex ? {} : "skip");
  const savePendingPlanMutation = useMutation(api.goldJournal.updatePendingPlanStatus);

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
  const [historySyncDetail, setHistorySyncDetail] = useState<{ received: number; inserted: number; skipped: number; runId: string } | null>(null);

  // ── Live MT5 History — direct fetch, no Convex ────────────────────────────
  const [liveRawDeals,  setLiveRawDeals]  = useState<RawMT5Deal[] | null>(null);
  const [liveFetchBusy, setLiveFetchBusy] = useState(false);
  const [liveFetchMsg,  setLiveFetchMsg]  = useState<string | null>(null);
  const [liveSymFilter, setLiveSymFilter] = useState("all");

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

  // ── Live MT5 derived data ─────────────────────────────────────────────────
  const liveGroupedTrades = useMemo(() => {
    if (!liveRawDeals) return null;
    const trades = groupDealsIntoTrades(liveRawDeals);
    return liveSymFilter === "all" ? trades : trades.filter((t) => t.symbol === liveSymFilter);
  }, [liveRawDeals, liveSymFilter]);

  const liveSymbolOptions = useMemo(() => {
    if (!liveRawDeals) return [];
    return [...new Set(liveRawDeals.filter((d) => d.symbol).map((d) => d.symbol))].sort();
  }, [liveRawDeals]);

  const liveStats = useMemo(() => {
    if (!liveGroupedTrades) return null;
    const closed = liveGroupedTrades.filter((t) => !t.isOpen);
    return {
      rawCount:    liveRawDeals?.length ?? 0,
      total:       liveGroupedTrades.length,
      openCount:   liveGroupedTrades.filter((t) => t.isOpen).length,
      closedCount: closed.length,
      wins:        closed.filter((t) => t.profit > 0).length,
      losses:      closed.filter((t) => t.profit < 0).length,
      grossProfit: closed.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0),
      grossLoss:   closed.filter((t) => t.profit < 0).reduce((s, t) => s + t.profit, 0),
      netProfit:   closed.reduce((s, t) => s + t.net, 0),
      commission:  closed.reduce((s, t) => s + t.commission, 0),
      swap:        closed.reduce((s, t) => s + t.swap, 0),
    };
  }, [liveGroupedTrades, liveRawDeals]);

  // ── Convex Archive — group raw deals by positionId (same logic as live) ──
  // Convex stores type/entry as strings ("0","1"); position key is camelCase.
  const convexGroupedTrades = useMemo(() => {
    const deals = tradeHistoryDeals ?? [];
    if (deals.length === 0) return [];
    const map = new Map<string, typeof deals[number][]>();
    for (const d of deals) {
      if (!d.symbol) continue;
      const key = d.positionId ?? d.dealTicket;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return [...map.entries()]
      .map(([posId, group]) => {
        const inD  = group.find((d) => d.entry === "0");
        const outD = group.find((d) => d.entry === "1");
        const profit     = group.reduce((s, d) => s + d.profit, 0);
        const commission = group.reduce((s, d) => s + (d.commission ?? 0), 0);
        const swap       = group.reduce((s, d) => s + (d.swap ?? 0), 0);
        const t = inD?.type ?? group[0]?.type;
        return {
          positionId: posId,
          symbol:     group[0].symbol,
          direction:  t === "0" ? "BUY" : t === "1" ? "SELL" : (t ?? "?"),
          volume:     inD?.volume ?? group[0].volume,
          openPrice:  inD?.price  ?? null,
          openTime:   inD?.time   ?? null,
          closePrice: outD?.price ?? null,
          closeTime:  outD?.time  ?? null,
          profit,
          commission,
          swap,
          net:       profit + commission + swap,
          comment:   outD?.comment ?? inD?.comment ?? "",
          isOpen:    !outD,
          isPartial: !inD && !!outD, // OUT deal present but no IN — incomplete dataset
        };
      })
      .sort((a, b) => (b.closeTime ?? b.openTime ?? 0) - (a.closeTime ?? a.openTime ?? 0));
  }, [tradeHistoryDeals]);

  // Complete trades: have both IN + OUT (or only IN = still open). Exclude partial (OUT only).
  const convexCompleteTrades = useMemo(
    () => convexGroupedTrades.filter((t) => !t.isPartial),
    [convexGroupedTrades],
  );

  // Partial records: OUT deal exists but no IN — incomplete dataset from old sync window.
  const convexPartialRecords = useMemo(
    () => convexGroupedTrades.filter((t) => t.isPartial),
    [convexGroupedTrades],
  );

  const convexGroupedStats = useMemo(() => {
    const closed = convexCompleteTrades.filter((t) => !t.isOpen);
    return {
      total:       convexCompleteTrades.length,
      closedCount: closed.length,
      openCount:   convexCompleteTrades.filter((t) => t.isOpen).length,
      wins:        closed.filter((t) => t.profit > 0).length,
      losses:      closed.filter((t) => t.profit < 0).length,
      grossProfit: closed.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0),
      grossLoss:   closed.filter((t) => t.profit < 0).reduce((s, t) => s + t.profit, 0),
      netProfit:   closed.reduce((s, t) => s + t.net, 0),
    };
  }, [convexCompleteTrades]);

  async function fetchLiveHistory() {
    setLiveFetchBusy(true);
    setLiveFetchMsg(null);
    try {
      const res = await fetch(
        `/api/mt5-readonly/history-deals?days=${encodeURIComponent(historyDays)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as { connected: boolean; deals?: RawMT5Deal[]; error?: string };
      if (data.connected && Array.isArray(data.deals)) {
        setLiveRawDeals(data.deals);
        const grouped = groupDealsIntoTrades(data.deals);
        setLiveFetchMsg(`✓ جُلب ${data.deals.length} صفقة خام → ${grouped.length} صفقة مجمّعة — آخر ${historyDays} يوم`);
      } else {
        setLiveFetchMsg(data.error ?? "فشل الاتصال بـ MT5 أو الخدمة غير متاحة");
      }
    } catch {
      setLiveFetchMsg("خطأ في الاتصال بالخدمة المحلية");
    } finally {
      setLiveFetchBusy(false);
    }
  }

  async function pullTradeHistoryFromMt5() {
    setHistorySyncMessage(null);
    setHistorySyncDetail(null);
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

      let totalInserted = 0;
      let totalSkipped  = 0;

      for (let i = 0; i < totalChunks; i++) {
        const chunk = (chunks[i] ?? []) as unknown[];
        try {
          const result = await syncHistoryMutation({
            connected: true,
            deals: chunk,
            read_only_mode: readOnly,
            from: fromStr,
            to: toStr,
            syncRunId,
            chunkIndex: i,
            totalChunks,
          });
          if (result && typeof result === "object" && "inserted" in result) {
            const ins = result.inserted as { deals?: number; skippedDuplicates?: number } | undefined;
            totalInserted += ins?.deals ?? 0;
            totalSkipped  += ins?.skippedDuplicates ?? 0;
          }
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          setHistorySyncMessage(
            `فشلت مزامنة السجل في الدفعة ${i + 1} من ${totalChunks}. ${reason}`,
          );
          return;
        }
      }
      setHistorySyncDetail({ received: deals.length, inserted: totalInserted, skipped: totalSkipped, runId: syncRunId });
      setHistorySyncMessage(`✓ deals مستلمة: ${deals.length} — جديدة: ${totalInserted} — موجودة مسبقاً: ${totalSkipped}`);
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
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-6">
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
                <option value="all">الكل</option>
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

      {/* ── Live MT5 History — Primary Source ─────────────────────────────── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="border-b border-amber-500/10 px-4 py-4 md:px-6">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="card-title-inst text-sm">سجل MT5 المباشر — المصدر الأساسي</CardTitle>
            <span className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium text-emerald-400">مباشر</span>
          </div>
          <p className="text-muted-foreground text-xs mt-1">
            يجلب مباشرة من MT5 ويجمع IN + OUT لكل position في صف واحد — كما يعرضها MT5 Terminal. لا يحتاج مزامنة Convex.
          </p>
        </CardHeader>
        <CardContent className="px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={liveFetchBusy} onClick={() => void fetchLiveHistory()}>
              {liveFetchBusy ? "جاري الجلب…" : `جلب مباشر من MT5 (${historyDays} يوم)`}
            </Button>
            {liveSymbolOptions.length > 0 && (
              <select className="rounded-md border border-amber-500/20 bg-background px-2 py-1.5 text-sm" value={liveSymFilter} onChange={(e) => setLiveSymFilter(e.target.value)}>
                <option value="all">كل الرموز</option>
                {liveSymbolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {liveFetchMsg && <span className="text-muted-foreground text-xs">{liveFetchMsg}</span>}
          </div>
          {liveStats && (
            <div className="rounded-md border border-zinc-700/30 bg-zinc-900/20 px-3 py-2 text-[10px] font-mono text-zinc-400/70 flex flex-wrap gap-3">
              <span>صفقات خام: <span className="text-cyan-400">{liveStats.rawCount}</span></span>
              <span>positions مجمّعة: <span className="text-amber-400">{liveStats.total}</span></span>
              <span>مغلقة: <span className="text-emerald-400">{liveStats.closedCount}</span></span>
              <span>مفتوحة: <span className="text-sky-400">{liveStats.openCount}</span></span>
              <span>مدة: <span className="text-zinc-300">{historyDays} يوم</span></span>
              <span>فلتر: <span className="text-zinc-300">{liveSymFilter}</span></span>
            </div>
          )}
          {liveStats && liveStats.closedCount > 0 && (
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <StatCard label="صفقات مغلقة"    value={String(liveStats.closedCount)} />
              <StatCard label="رابحة"            value={String(liveStats.wins)} />
              <StatCard label="خاسرة"           value={String(liveStats.losses)} />
              <StatCard label="إجمالي الربح"    value={`$${liveStats.grossProfit.toFixed(2)}`} />
              <StatCard label="إجمالي الخسارة" value={`$${liveStats.grossLoss.toFixed(2)}`} />
              <StatCard label="صافي النتيجة"   value={`$${liveStats.netProfit.toFixed(2)}`} />
            </div>
          )}
          {liveGroupedTrades === null ? (
            <p className="text-muted-foreground text-sm text-center py-4">اضغط "جلب مباشر من MT5" لعرض سجل الصفقات المجمّعة.</p>
          ) : liveGroupedTrades.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">لا توجد صفقات للرمز المختار في الفترة المحددة.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="text-right pb-1.5 px-2">الحالة</th>
                    <th className="text-right pb-1.5 px-2">الرمز</th>
                    <th className="text-right pb-1.5 px-2">الاتجاه</th>
                    <th className="text-right pb-1.5 px-2">الحجم</th>
                    <th className="text-right pb-1.5 px-2">سعر الدخول</th>
                    <th className="text-right pb-1.5 px-2">سعر الخروج</th>
                    <th className="text-right pb-1.5 px-2">الربح</th>
                    <th className="text-right pb-1.5 px-2">العمولة</th>
                    <th className="text-right pb-1.5 px-2">وقت الإغلاق</th>
                    <th className="text-right pb-1.5 px-2">التعليق</th>
                  </tr>
                </thead>
                <tbody>
                  {liveGroupedTrades.map((t) => (
                    <tr key={t.positionId} className="border-b border-border/10">
                      <td className="py-1 px-2">
                        <Badge variant="outline" className={t.isOpen ? "border-sky-500/30 text-sky-300" : "border-zinc-500/30 text-zinc-400"}>
                          {t.isOpen ? "مفتوحة" : "مغلقة"}
                        </Badge>
                      </td>
                      <td className="py-1 px-2 font-semibold text-amber-100/90">{t.symbol}</td>
                      <td className="py-1 px-2">
                        <Badge variant="outline" className={t.direction === "BUY" ? "border-emerald-500/30 text-emerald-300" : "border-red-500/30 text-red-300"}>
                          {t.direction === "BUY" ? "شراء" : t.direction === "SELL" ? "بيع" : t.direction}
                        </Badge>
                      </td>
                      <td className="py-1 px-2 tabular-nums">{t.volume.toFixed(2)}</td>
                      <td className="py-1 px-2 tabular-nums font-mono">{t.openPrice?.toFixed(2) ?? "—"}</td>
                      <td className="py-1 px-2 tabular-nums font-mono">{t.closePrice?.toFixed(2) ?? "—"}</td>
                      <td className={`py-1 px-2 tabular-nums font-mono font-semibold ${t.profit > 0 ? "text-emerald-400" : t.profit < 0 ? "text-red-400" : "text-zinc-400"}`}>
                        {t.profit >= 0 ? "+" : ""}{t.profit.toFixed(2)}
                      </td>
                      <td className="py-1 px-2 tabular-nums text-zinc-400/70">{t.commission.toFixed(2)}</td>
                      <td className="py-1 px-2 tabular-nums text-muted-foreground/60 text-[10px]">
                        {t.closeTime ? fmtTs(t.closeTime) : t.openTime ? fmtTs(t.openTime) : "—"}
                      </td>
                      <td className="py-1 px-2 text-zinc-400/70 max-w-[160px] truncate">{t.comment || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {liveGroupedTrades !== null && liveGroupedTrades.some((t) => t.comment?.startsWith("KING_GOLD")) && (
            <div className="border-t border-border/15 pt-2">
              <p className="text-[10px] text-amber-300/60 font-mono">
                صفقات النظام KING_GOLD: {liveGroupedTrades.filter((t) => t.comment?.startsWith("KING_GOLD")).length}
                {" — "}ربح: ${liveGroupedTrades.filter((t) => t.comment?.startsWith("KING_GOLD")).reduce((s, t) => s + t.profit, 0).toFixed(2)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Convex Archive — Raw Deals After Manual Sync ──────────────────── */}
      <Card className={institutionalCardClass("p-0")}>
        <CardHeader className="space-y-2 border-b border-amber-500/10 px-4 py-4 md:px-6">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="card-title-inst">أرشيف Convex — deals الخام بعد المزامنة</CardTitle>
            <span className="inline-flex items-center rounded border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[9px] font-medium text-zinc-400">أرشيف</span>
            {/* Freshness badge for history archive */}
            {historyMeta !== undefined && historyMeta.lastSyncAt && (
              historyMeta.isFresh ? (
                <span className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium text-emerald-400">محدّث</span>
              ) : (
                <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400">قديم · Stale</span>
              )
            )}
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            صفقات مجمّعة من deals الخام المحفوظة في Convex — يظهر كل position كصف واحد (IN + OUT مدموجان). يُحدَّث بالضغط على زر المزامنة أدناه.
          </p>
          {/* History sync metadata */}
          {historyMeta !== undefined && (
            <div className="flex flex-wrap gap-3 text-[10px] font-mono text-zinc-400/70">
              {historyMeta.lastSyncAt ? (
                <span>آخر مزامنة: <span className="text-zinc-300/80">{fmtTs(historyMeta.lastSyncAt)}</span></span>
              ) : (
                <span className="text-amber-400/70">لم تتم مزامنة السجل بعد — اضغط "سحب سجل الصفقات من MT5"</span>
              )}
              <span>deals في Convex: <span className="text-cyan-400">{historyMeta.dealCount}</span></span>
              <span>positions مجمّعة: <span className="text-amber-400">{convexGroupedStats.total}</span></span>
            </div>
          )}
          {/* Mismatch warning: live vs archive */}
          {liveGroupedTrades !== null && convexGroupedStats.total > 0 && (liveGroupedTrades.length - convexGroupedStats.total) > 2 && (
            <div className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2">
              <p className="text-orange-300/90 text-xs">
                تحذير: الأرشيف لا يطابق السجل المباشر — مباشر: {liveGroupedTrades.length} positions، Convex: {convexGroupedStats.total}.
                نفّذ "سحب سجل الصفقات من MT5" لتحديثه.
              </p>
            </div>
          )}
          {liveGroupedTrades !== null && convexGroupedStats.total === 0 && historyMeta?.dealCount === 0 && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <p className="text-amber-300/80 text-xs">
                أرشيف Convex فارغ أو غير محدث. اضغط "سحب سجل الصفقات من MT5" لجلب {liveGroupedTrades.length} صفقة.
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4 px-2 pb-4 md:px-4">
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard label="positions محفوظة" value={String(convexGroupedStats.total)} />
            <StatCard label="مغلقة"             value={String(convexGroupedStats.closedCount)} />
            <StatCard label="رابحة"              value={String(convexGroupedStats.wins)} />
            <StatCard label="خاسرة"             value={String(convexGroupedStats.losses)} />
            <StatCard label="إجمالي الربح"      value={`$${convexGroupedStats.grossProfit.toFixed(2)}`} />
            <StatCard label="صافي Convex"       value={`$${convexGroupedStats.netProfit.toFixed(2)}`} />
          </div>

          <div className="space-y-3">
            {/* Heading + freshness badge */}
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-amber-100/90 text-sm">A) الصفقات النشطة — من Convex (بعد مزامنة)</h4>
              {freshPositionsResult !== undefined && (
                positionsFresh ? (
                  <span className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium text-emerald-400">حديثة</span>
                ) : (
                  <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400">قديمة · Stale</span>
                )
              )}
              {positionsLastSyncAt && (
                <span className="text-[9px] text-muted-foreground/60 tabular-nums">
                  آخر مزامنة: {fmtTs(positionsLastSyncAt)}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              {/* Loading */}
              {freshPositionsResult === undefined ? (
                <p className="text-muted-foreground px-2 py-4 text-sm">جاري تحميل الصفقات النشطة من Convex…</p>
              ) : !canUseConvex ? (
                <p className="text-muted-foreground px-2 py-4 text-sm">{NO_MT5_DATA_AR}</p>
              ) : !positionsFresh && positionsLastSyncAt === null ? (
                /* Never synced */
                <p className="text-muted-foreground px-2 py-4 text-sm">
                  لم تتم مزامنة الصفقات النشطة بعد — اضغط "تحديث الصفقات النشطة من MT5".
                </p>
              ) : !positionsFresh ? (
                /* Stale — hide old data, show warning */
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                  <p className="text-amber-300/90 text-sm">
                    لا توجد صفقات نشطة حديثة من MT5. البيانات القديمة مخفية لأنها لا تمثل حالة المنصة الحالية.
                  </p>
                  {positionsLastSyncAt && (
                    <p className="text-muted-foreground/60 text-xs mt-1 tabular-nums">
                      آخر مزامنة: {fmtTs(positionsLastSyncAt)} — اضغط "تحديث الصفقات النشطة" للتحديث.
                    </p>
                  )}
                </div>
              ) : activeFiltered.length === 0 ? (
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
                          <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">نشطة ✓</Badge>
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
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-amber-100/90 text-sm">B) سجل الصفقات المجمّعة — من Convex (بعد المزامنة)</h4>

            {/* Main archive table — complete trades only */}
            <div className="overflow-x-auto">
              {convexEmptyOrLoading(tradeHistoryDeals, false) ??
                /* Stale archive: no complete trades, only partial leftovers */
                (historyMeta !== undefined && !historyMeta.isFresh && convexCompleteTrades.length === 0 ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3 space-y-1">
                    <p className="text-amber-300/90 text-sm">
                      أرشيف Convex قديم أو ناقص. اضغط "سحب سجل الصفقات من MT5" لتحديثه.
                    </p>
                    <p className="text-muted-foreground/60 text-xs">
                      البيانات القديمة مخفية حتى لا تُفهم كصفقات حالية.
                    </p>
                  </div>
                ) : convexCompleteTrades.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-4 text-sm">
                    لا يوجد سجل بعد — اضغط "سحب سجل الصفقات من MT5" في لوحة التحكم أعلاه.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/30 text-muted-foreground">
                        <th className="text-right pb-1.5 px-2">الحالة</th>
                        <th className="text-right pb-1.5 px-2">الرمز</th>
                        <th className="text-right pb-1.5 px-2">الاتجاه</th>
                        <th className="text-right pb-1.5 px-2">الحجم</th>
                        <th className="text-right pb-1.5 px-2">سعر الدخول</th>
                        <th className="text-right pb-1.5 px-2">سعر الخروج</th>
                        <th className="text-right pb-1.5 px-2">الربح</th>
                        <th className="text-right pb-1.5 px-2">العمولة</th>
                        <th className="text-right pb-1.5 px-2">وقت الإغلاق</th>
                        <th className="text-right pb-1.5 px-2">التعليق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {convexCompleteTrades.map((t) => (
                        <tr key={t.positionId} className="border-b border-border/10">
                          <td className="py-1 px-2">
                            <Badge variant="outline" className={t.isOpen ? "border-sky-500/30 text-sky-300" : "border-zinc-500/30 text-zinc-400"}>
                              {t.isOpen ? "مفتوحة" : "مغلقة"}
                            </Badge>
                          </td>
                          <td className="py-1 px-2 font-semibold text-amber-100/90">{t.symbol}</td>
                          <td className="py-1 px-2">
                            <Badge variant="outline" className={t.direction === "BUY" ? "border-emerald-500/30 text-emerald-300" : "border-red-500/30 text-red-300"}>
                              {t.direction === "BUY" ? "شراء" : t.direction === "SELL" ? "بيع" : t.direction}
                            </Badge>
                          </td>
                          <td className="py-1 px-2 tabular-nums">{t.volume.toFixed(2)}</td>
                          <td className="py-1 px-2 tabular-nums font-mono">{t.openPrice?.toFixed(2) ?? "—"}</td>
                          <td className="py-1 px-2 tabular-nums font-mono">{t.closePrice?.toFixed(2) ?? "—"}</td>
                          <td className={`py-1 px-2 tabular-nums font-mono font-semibold ${t.profit > 0 ? "text-emerald-400" : t.profit < 0 ? "text-red-400" : "text-zinc-400"}`}>
                            {t.profit >= 0 ? "+" : ""}{t.profit.toFixed(2)}
                          </td>
                          <td className="py-1 px-2 tabular-nums text-zinc-400/70">{t.commission.toFixed(2)}</td>
                          <td className="py-1 px-2 tabular-nums text-muted-foreground/60 text-[10px]">
                            {t.closeTime ? fmtTs(t.closeTime) : t.openTime ? fmtTs(t.openTime) : "—"}
                          </td>
                          <td className="py-1 px-2 text-zinc-400/70 max-w-[160px] truncate">{t.comment || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
            </div>

            {/* Partial records — collapsed, clearly labelled as old/incomplete */}
            {convexPartialRecords.length > 0 && (
              <details className="rounded-md border border-zinc-700/30 bg-zinc-900/20 text-xs">
                <summary className="cursor-pointer select-none px-3 py-2 text-[10px] text-zinc-400/60 hover:text-zinc-300/70 list-none flex items-center gap-1">
                  <span>▸</span>
                  <span>سجلات ناقصة من مزامنة قديمة ({convexPartialRecords.length}) — خروج بدون دخول</span>
                </summary>
                <div className="px-3 pb-1 pt-0.5 text-[9px] text-zinc-500/60 italic border-t border-zinc-700/20">
                  هذه السجلات تحتوي deal خروج فقط بدون deal دخول — ناتجة عن مزامنة قديمة لا تشمل كامل نطاق التاريخ. لا تمثل صفقات حالية.
                </div>
                <table className="w-full text-[10px] px-2 pb-2">
                  <thead>
                    <tr className="border-b border-zinc-700/20 text-zinc-500/70">
                      <th className="text-right pb-1 px-3">الرمز</th>
                      <th className="text-right pb-1 px-3">سعر الخروج</th>
                      <th className="text-right pb-1 px-3">الربح</th>
                      <th className="text-right pb-1 px-3">وقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {convexPartialRecords.map((t) => (
                      <tr key={t.positionId} className="border-b border-zinc-800/30 text-zinc-500/60">
                        <td className="py-1 px-3">{t.symbol}</td>
                        <td className="py-1 px-3 tabular-nums font-mono">{t.closePrice?.toFixed(2) ?? "—"}</td>
                        <td className="py-1 px-3 tabular-nums font-mono">{t.profit >= 0 ? "+" : ""}{t.profit.toFixed(2)}</td>
                        <td className="py-1 px-3 tabular-nums text-[9px]">
                          {t.closeTime ? fmtTs(t.closeTime) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
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

      {/* ── Gold Analysis Journal ────────────────────────────────────────────── */}
      {canUseConvex && (goldSnapshots?.length ?? 0) > 0 && (
        <Card className={institutionalCardClass("p-0")}>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-amber-300/90">
              سجل تحليلات الذهب — Gold Analysis Journal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div dir="rtl" className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="إجمالي التحليلات" value={String(goldSnapshots?.length ?? 0)} />
                <StatCard label="تحليلات مُنفَّذة"  value={String(goldSnapshots?.filter(s => s.wasExecuted).length ?? 0)} />
                <StatCard label="مجموعات التنفيذ"   value={String(goldExecGroups?.length ?? 0)} />
                <StatCard label="خطط معلّقة"         value={String(goldPendingPlans?.filter(p => p.status === "WATCHING").length ?? 0)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30 text-muted-foreground">
                      <th className="text-right pb-1.5 px-2">وقت</th>
                      <th className="text-right pb-1.5 px-2">اتجاه</th>
                      <th className="text-right pb-1.5 px-2">فريم</th>
                      <th className="text-right pb-1.5 px-2">خطة</th>
                      <th className="text-right pb-1.5 px-2">هدف</th>
                      <th className="text-right pb-1.5 px-2">توصية</th>
                      <th className="text-right pb-1.5 px-2">نُفِّذ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goldSnapshots?.slice(0, 20).map((s) => (
                      <tr key={s._id} className="border-b border-border/10">
                        <td className="py-1 px-2 text-muted-foreground/60 tabular-nums text-[10px]">
                          {new Date(s.createdAt).toLocaleString("ar-SA", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className={`py-1 px-2 font-semibold ${s.direction === "bullish" ? "text-emerald-400" : s.direction === "bearish" ? "text-red-400" : "text-zinc-400"}`}>
                          {s.direction === "bullish" ? "↑ شراء" : s.direction === "bearish" ? "↓ بيع" : "—"}
                        </td>
                        <td className="py-1 px-2 text-zinc-300/70 text-[10px]">{s.timeframe ?? "—"}</td>
                        <td className="py-1 px-2 text-amber-300/70 text-[10px]">
                          {s.selectedPlanName === "CONSERVATIVE" ? "محافظة" : s.selectedPlanName === "BALANCED" ? "متوازنة" : s.selectedPlanName === "AGGRESSIVE" ? "هجومية" : "—"}
                        </td>
                        <td className="py-1 px-2 text-cyan-300/70 text-[10px]">
                          {s.targetPreference === "REALISTIC" ? "واقعي" : s.targetPreference === "BALANCED" ? "متوسط" : s.targetPreference === "FAR" ? "بعيد" : "—"}
                        </td>
                        <td className={`py-1 px-2 text-[10px] ${s.recommendationStatus === "APPROVED" ? "text-emerald-400" : s.recommendationStatus === "EXPERIMENTAL" ? "text-violet-400" : s.recommendationStatus === "BLOCKED" ? "text-red-400" : "text-zinc-400"}`}>
                          {s.recommendationStatus ?? s.analysisStatus ?? "—"}
                        </td>
                        <td className="py-1 px-2">{s.wasExecuted ? <span className="text-emerald-400 text-[10px]">✓</span> : <span className="text-zinc-500/50 text-[10px]">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Gold Execution Groups ────────────────────────────────────────────── */}
      {canUseConvex && (goldExecGroups?.length ?? 0) > 0 && (
        <Card className={institutionalCardClass("p-0")}>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-amber-300/90">مجموعات تنفيذ الذهب</CardTitle>
          </CardHeader>
          <CardContent>
            <div dir="rtl" className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="text-right pb-1.5 px-2">وقت</th>
                    <th className="text-right pb-1.5 px-2">groupId</th>
                    <th className="text-right pb-1.5 px-2">أوامر</th>
                    <th className="text-right pb-1.5 px-2">تذاكر MT5</th>
                    <th className="text-right pb-1.5 px-2">اللوت</th>
                    <th className="text-right pb-1.5 px-2">المخاطرة $</th>
                    <th className="text-right pb-1.5 px-2">خطة</th>
                    <th className="text-right pb-1.5 px-2">هدف</th>
                  </tr>
                </thead>
                <tbody>
                  {goldExecGroups?.slice(0, 15).map((g) => (
                    <tr key={g._id} className="border-b border-border/10">
                      <td className="py-1 px-2 text-muted-foreground/60 tabular-nums text-[10px]">
                        {new Date(g.createdAt).toLocaleString("ar-SA", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-1 px-2 font-mono text-[10px] text-zinc-300/60">{g.groupId.slice(-12)}</td>
                      <td className="py-1 px-2 tabular-nums">
                        <span className={g.ordersSent === g.ordersRequested ? "text-emerald-400" : "text-amber-400"}>{g.ordersSent}/{g.ordersRequested}</span>
                      </td>
                      <td className="py-1 px-2 font-mono text-[10px] text-emerald-300/70">{g.tickets?.join(", ") || "—"}</td>
                      <td className="py-1 px-2 tabular-nums text-zinc-300/80 text-[10px]">{g.totalLot != null ? g.totalLot.toFixed(2) : "—"}</td>
                      <td className="py-1 px-2 tabular-nums text-zinc-300/80 text-[10px]">{g.totalRiskUsd != null ? `$${g.totalRiskUsd.toFixed(2)}` : "—"}</td>
                      <td className="py-1 px-2 text-amber-300/70 text-[10px]">{g.selectedPlanName ?? "—"}</td>
                      <td className="py-1 px-2 text-cyan-300/70 text-[10px]">{g.targetPreference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

export default function ReportsPage() {
  return (
    <ConvexSafeWrapper>
      <ReportsPageContent />
    </ConvexSafeWrapper>
  );
}
