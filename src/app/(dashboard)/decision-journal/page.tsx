"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Users,
  Activity,
  X,
  MessageSquareText,
  Flame,
  Award,
} from "lucide-react";
import { cn } from "@/lib/utils";

const FASTAPI_BASE = "http://127.0.0.1:8010";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentVote {
  approved:   boolean;
  confidence: number;
  reason:     string;
  direction:  string | null;
}

interface JournalContext {
  symbol?:          string;
  direction?:       string | null;
  signal_strength?: number;
  sl?:              number | null;
  tp?:              number | null;
  atr?:             number | null;
}

interface JournalEntry {
  id:           number;
  trade_id:     string | null;
  context:      JournalContext;
  agents_votes: Record<string, AgentVote>;
  result:       "APPROVED" | "REJECTED";
  timestamp:    string;
}

interface JournalResponse {
  ok:      boolean;
  count:   number;
  entries: JournalEntry[];
}

// ---------------------------------------------------------------------------
// Simulated Crypto Journal — types
// ---------------------------------------------------------------------------

type SimulatedPositionStatus = "PENDING" | "ACTIVE" | "HIT_TP" | "HIT_SL" | "CLOSED_MANUAL";

interface SimulatedPosition {
  _id:            number;
  symbol:         string;
  source:         string;
  direction:      "BUY" | "SELL";
  entryPrice:     number | null;
  stopLoss:       number | null;
  takeProfit:     number | null;
  lotSize:        number | null;
  riskAmount:     number | null;
  profitAmount:   number | null;
  signalStrength: number | null;
  status:         SimulatedPositionStatus;
  openedAt:       string | null;
  closedAt:       string | null;
  notes:               string | null;
  technicalPostMortem: string | null;
  actionableLesson:    string | null;
  createdAt:           string | null;
}

interface SimulatedPositionsResponse {
  ok:        boolean;
  count:     number;
  positions: SimulatedPosition[];
}

interface SimulatedStats {
  total:        number;
  wins:         number;
  losses:       number;
  open:         number;
  closedManual: number;
  winRate:      number;
}

interface SimulatedStatsResponse {
  ok:    boolean;
  stats: SimulatedStats;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchJournal(
  result?: string,
  symbol?: string,
): Promise<JournalResponse> {
  const params = new URLSearchParams({ limit: "200" });
  if (result) params.set("result", result);
  if (symbol) params.set("symbol", symbol);
  const res = await fetch(`${FASTAPI_BASE}/api/journal?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<JournalResponse>;
}

async function fetchSimulatedPositions(source: "mt5" | "okx"): Promise<SimulatedPositionsResponse> {
  const res = await fetch(`/api/lab/journal/simulated-positions?limit=100&source=${source}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SimulatedPositionsResponse>;
}

async function fetchSimulatedStats(source: "mt5" | "okx"): Promise<SimulatedStatsResponse> {
  const res = await fetch(`/api/lab/journal/simulated-positions/stats?source=${source}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SimulatedStatsResponse>;
}

// ---------------------------------------------------------------------------
// Agent names (Arabic display)
// ---------------------------------------------------------------------------

const AGENT_LABELS: Record<string, string> = {
  TrendAgent:      "وكيل الاتجاه",
  MomentumAgent:   "وكيل الزخم",
  VolatilityAgent: "وكيل التقلب",
  RiskAgent:       "وكيل المخاطرة",
};

const agentLabel = (key: string) => AGENT_LABELS[key] ?? key;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString("ar-SA", {
      year:   "numeric",
      month:  "2-digit",
      day:    "2-digit",
      hour:   "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function DirectionBadge({ dir }: { dir?: string | null }) {
  if (!dir) return <span className="text-muted-foreground text-xs">محايد</span>;
  if (dir === "BUY")
    return (
      <span className="rounded px-1.5 py-0.5 text-xs font-bold bg-emerald-500/15 text-emerald-300">
        شراء
      </span>
    );
  return (
    <span className="rounded px-1.5 py-0.5 text-xs font-bold bg-rose-500/15 text-rose-300">
      بيع
    </span>
  );
}

function ResultBadge({ result }: { result: "APPROVED" | "REJECTED" }) {
  if (result === "APPROVED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
        <CheckCircle2 className="h-3 w-3" />
        مقبول
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/20">
      <XCircle className="h-3 w-3" />
      مرفوض
    </span>
  );
}

// ---------------------------------------------------------------------------
// Agent Votes Expansion Panel
// ---------------------------------------------------------------------------

function AgentVotesPanel({ votes }: { votes: Record<string, AgentVote> }) {
  const keys = Object.keys(votes);
  if (keys.length === 0)
    return (
      <p className="text-xs text-muted-foreground py-2">لا توجد بيانات تصويت</p>
    );

  return (
    <div className="grid gap-2 pt-2">
      {keys.map((key) => {
        const v = votes[key]!;
        return (
          <div
            key={key}
            className={`rounded-lg border p-3 text-sm ${
              v.approved
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-rose-500/15 bg-rose-500/5"
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-medium text-foreground">{agentLabel(key)}</span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums text-xs text-muted-foreground">
                  {Math.round(v.confidence * 100)}%
                </span>
                {v.approved ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-rose-400" />
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {v.reason || "لا يوجد سبب"}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single Journal Row
// ---------------------------------------------------------------------------

function JournalRow({ entry }: { entry: JournalEntry }) {
  const [open, setOpen] = useState(false);
  const ctx   = entry.context;
  const votes = entry.agents_votes;

  const approvedCount = Object.values(votes).filter((v) => v.approved).length;
  const totalVotes    = Object.keys(votes).length;
  const strengthPct   =
    ctx.signal_strength != null ? Math.round(ctx.signal_strength * 100) : null;

  return (
    <div
      className={`rounded-xl border transition-colors ${
        entry.result === "APPROVED"
          ? "border-emerald-500/15 bg-emerald-500/5"
          : "border-border bg-card/50"
      }`}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full text-right px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        <span className="shrink-0">
          <ResultBadge result={entry.result} />
        </span>

        <span className="font-mono text-sm font-semibold text-foreground min-w-[70px]">
          {ctx.symbol ?? "—"}
        </span>

        <DirectionBadge dir={ctx.direction} />

        {strengthPct != null && (
          <span className="tabular-nums text-xs text-muted-foreground">
            قوة: {strengthPct}%
          </span>
        )}

        {ctx.sl != null && (
          <span className="tabular-nums text-xs text-muted-foreground">
            SL: {ctx.sl.toFixed(2)}
          </span>
        )}

        {ctx.tp != null && (
          <span className="tabular-nums text-xs text-muted-foreground">
            TP: {ctx.tp.toFixed(2)}
          </span>
        )}

        <span className="text-xs text-muted-foreground mr-auto">
          {formatTs(entry.timestamp)}
        </span>

        <span className="shrink-0 text-muted-foreground">
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>

      {/* Expanded votes panel */}
      {open && (
        <div className="border-t border-border/50 px-4 pb-4">
          <div className="flex items-center gap-1.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>
              تصويتات الوكلاء ({approvedCount}/{totalVotes} موافقة)
            </span>
          </div>
          <AgentVotesPanel votes={votes} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Bar
// ---------------------------------------------------------------------------

function StatsBar({
  total,
  approved,
  rejected,
}: {
  total:    number;
  approved: number;
  rejected: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        {
          label: "إجمالي التحليلات",
          value: total,
          icon:  Clock,
          color: "text-amber-400",
          bg:    "bg-amber-500/10 border-amber-500/20",
        },
        {
          label: "إشارات مقبولة",
          value: approved,
          icon:  CheckCircle2,
          color: "text-emerald-400",
          bg:    "bg-emerald-500/10 border-emerald-500/20",
        },
        {
          label: "تحليلات مرفوضة",
          value: rejected,
          icon:  XCircle,
          color: "text-rose-400",
          bg:    "bg-rose-500/10 border-rose-500/20",
        },
      ].map(({ label, value, icon: Icon, color, bg }) => (
        <div
          key={label}
          className={`rounded-xl border p-4 flex items-center gap-3 ${bg}`}
        >
          <Icon className={`h-5 w-5 shrink-0 ${color}`} />
          <div>
            <p className="tabular-nums text-xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulated Crypto Journal — status action buttons
// ---------------------------------------------------------------------------

const SIMULATED_STATUS_LABELS: Record<SimulatedPositionStatus, string> = {
  PENDING:       "بانتظار التفعيل",
  ACTIVE:        "نشطة",
  HIT_TP:        "تحقق الهدف",
  HIT_SL:        "ضرب وقف الخسارة",
  CLOSED_MANUAL: "إغلاق يدوي",
};

function SimulatedPositionActions({
  position,
  onUpdated,
}: {
  position: SimulatedPosition;
  onUpdated: () => void;
}) {
  const [pendingStatus, setPendingStatus] = useState<SimulatedPositionStatus | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [technicalPostMortem, setTechnicalPostMortem] = useState("");
  const [actionableLesson, setActionableLesson] = useState("");

  const updateStatus = async (status: SimulatedPositionStatus, pm?: string, lesson?: string) => {
    setPendingStatus(status);
    try {
      const res = await fetch(
        `/api/lab/journal/simulated-positions/${position._id}/status`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            status,
            technicalPostMortem: pm || undefined,
            actionableLesson: lesson || undefined,
          }),
        },
      );
      if (res.ok) {
        setShowModal(false);
        onUpdated();
      }
    } finally {
      setPendingStatus(null);
    }
  };

  const handleActionClick = (status: SimulatedPositionStatus) => {
    if (status === "ACTIVE") {
      updateStatus(status);
    } else {
      setPendingStatus(status);
      setShowModal(true);
    }
  };

  const busy = pendingStatus !== null && !showModal;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {position.status === "PENDING" && (
          <button
            type="button"
            onClick={() => handleActionClick("ACTIVE")}
            disabled={busy}
            className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
          >
            تفعيل
          </button>
        )}
        <button
          type="button"
          onClick={() => handleActionClick("HIT_TP")}
          disabled={busy}
          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
        >
          HIT TP
        </button>
        <button
          type="button"
          onClick={() => handleActionClick("HIT_SL")}
          disabled={busy}
          className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
        >
          HIT SL
        </button>
        <button
          type="button"
          onClick={() => handleActionClick("CLOSED_MANUAL")}
          disabled={busy}
          className="rounded-full border border-border/40 bg-muted/20 px-2.5 py-1 text-[10px] font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          إغلاق يدوي
        </button>
      </div>

      {showModal && pendingStatus && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => {
            setShowModal(false);
            setPendingStatus(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">
                تشريح نتيجة الصفقة (Post-Mortem)
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setPendingStatus(null);
                }}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-border/30 bg-card/50 p-3">
              <p className="text-xs text-muted-foreground">
                إغلاق الصفقة كـ: <span className="font-bold text-foreground">{SIMULATED_STATUS_LABELS[pendingStatus]}</span>
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                سجل الملاحظات التقنية والدروس المستفادة لبناء مرجع تعليمي (اختياري).
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">التحليل الفني للنتيجة (Technical Post-Mortem)</label>
                <textarea
                  value={technicalPostMortem}
                  onChange={(e) => setTechnicalPostMortem(e.target.value)}
                  rows={3}
                  placeholder="مثال: تم ضرب الوقف بسبب خبر مفاجئ، أو السعر احترم منطقة الـ FVG..."
                  className="w-full resize-none rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">الدرس المستفاد (Actionable Lesson)</label>
                <textarea
                  value={actionableLesson}
                  onChange={(e) => setActionableLesson(e.target.value)}
                  rows={3}
                  placeholder="مثال: يجب تجنب الدخول قبل الأخبار بـ 15 دقيقة..."
                  className="w-full resize-none rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateStatus(pendingStatus, technicalPostMortem, actionableLesson)}
                disabled={busy}
                className="flex-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
              >
                {busy ? "جاري الإغلاق..." : "تأكيد وإغلاق الصفقة"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Simulated Crypto Journal — single position row
// ---------------------------------------------------------------------------

function SimulatedPositionRow({
  position,
  onUpdated,
}: {
  position: SimulatedPosition;
  onUpdated: () => void;
}) {
  const isOpen = position.status === "PENDING" || position.status === "ACTIVE";
  const ts = position.openedAt ?? position.createdAt;

  return (
    <div className="rounded-xl border border-border bg-card/50 transition-colors">
      <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <DirectionBadge dir={position.direction} />

        <span className="font-mono text-sm font-semibold text-foreground min-w-[90px]">
          {position.symbol}
        </span>

        {position.entryPrice != null && (
          <span className="tabular-nums text-xs text-muted-foreground">
            دخول: {position.entryPrice}
          </span>
        )}
        {position.stopLoss != null && (
          <span className="tabular-nums text-xs text-rose-300">
            SL: {position.stopLoss}
          </span>
        )}
        {position.takeProfit != null && (
          <span className="tabular-nums text-xs text-emerald-300">
            TP: {position.takeProfit}
          </span>
        )}
        {position.lotSize != null && (
          <span className="tabular-nums text-xs text-muted-foreground">
            لوت: {position.lotSize}
          </span>
        )}

        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted/30 text-muted-foreground">
          {SIMULATED_STATUS_LABELS[position.status]}
        </span>

        {ts && (
          <span className="text-xs text-muted-foreground mr-auto">
            {formatTs(ts)}
          </span>
        )}

        {isOpen && (
          <div className={ts ? "" : "mr-auto"}>
            <SimulatedPositionActions position={position} onUpdated={onUpdated} />
          </div>
        )}
      </div>

      {(!isOpen && (position.technicalPostMortem || position.actionableLesson)) && (
        <div className="border-t border-border/50 bg-card/30 px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {position.technicalPostMortem && (
              <div className="rounded-lg border border-border/30 bg-card/50 p-2.5 text-xs">
                <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" />
                  <span className="font-semibold">التحليل الفني للنتيجة</span>
                </div>
                <p className="leading-relaxed text-foreground/80">{position.technicalPostMortem}</p>
              </div>
            )}
            {position.actionableLesson && (
              <div className="rounded-lg border border-border/30 bg-card/50 p-2.5 text-xs">
                <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  <span className="font-semibold">الدرس المستفاد</span>
                </div>
                <p className="leading-relaxed text-foreground/80">{position.actionableLesson}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulated Crypto Journal — section
// ---------------------------------------------------------------------------

function SimulatedPositionsSection({ source }: { source: "mt5" | "okx" }) {
  const {
    data: posData,
    isLoading: posLoading,
    isError: posError,
    refetch: refetchPositions,
  } = useQuery<SimulatedPositionsResponse>({
    queryKey: ["simulated-positions", source],
    queryFn:  () => fetchSimulatedPositions(source),
    refetchInterval: 60_000,
    retry:    false,
    staleTime: 30_000,
  });

  const { data: statsData, refetch: refetchStats } = useQuery<SimulatedStatsResponse>({
    queryKey: ["simulated-positions-stats", source],
    queryFn:  () => fetchSimulatedStats(source),
    refetchInterval: 60_000,
    retry:    false,
    staleTime: 30_000,
  });

  const positions = posData?.positions ?? [];
  const openPositions   = positions.filter((p) => p.status === "PENDING" || p.status === "ACTIVE");
  const closedPositions = positions.filter((p) => p.status !== "PENDING" && p.status !== "ACTIVE");
  const stats = statsData?.stats;

  const handleUpdated = () => {
    refetchPositions();
    refetchStats();
  };

  if (posError) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl border", source === "mt5" ? "bg-amber-500/15 border-amber-500/25" : "bg-cyan-500/15 border-cyan-500/25")}>
          <Activity className={cn("h-4 w-4", source === "mt5" ? "text-amber-400" : "text-cyan-400")} />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">
            الصفقات المحاكاة — {source === "mt5" ? "الفوركس والذهب" : "الكريبتو"}
          </h2>
          <p className="text-xs text-muted-foreground">
            سجل صفقات محاكي (Paper Trades) — لا تنفيذ حقيقي — للأغراض المعلوماتية فقط
          </p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-card/50 p-3 text-center">
            <p className="tabular-nums text-lg font-bold text-foreground">{stats.total}</p>
            <p className="text-[11px] text-muted-foreground">إجمالي الصفقات</p>
          </div>
          <div className={cn("rounded-xl border p-3 text-center", source === "mt5" ? "border-amber-500/20 bg-amber-500/5" : "border-cyan-500/20 bg-cyan-500/5")}>
            <p className={cn("tabular-nums text-lg font-bold", source === "mt5" ? "text-amber-300" : "text-cyan-300")}>{stats.open}</p>
            <p className="text-[11px] text-muted-foreground">صفقات مفتوحة</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
            <p className="tabular-nums text-lg font-bold text-emerald-300">{stats.winRate}%</p>
            <p className="text-[11px] text-muted-foreground">معدل النجاح</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-3 text-center">
            <p className="tabular-nums text-lg font-bold text-foreground">
              {stats.wins} / {stats.losses}
            </p>
            <p className="text-[11px] text-muted-foreground">هدف / وقف خسارة</p>
          </div>
        </div>
      )}

      {posLoading ? (
        <div className="h-14 rounded-xl border border-border bg-card/50 animate-pulse" />
      ) : openPositions.length === 0 && closedPositions.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/30 px-4 py-8 text-center">
          <Activity className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            لا توجد صفقات محاكاة بعد
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            استخدم زر &quot;محاكاة دخول الصفقة&quot; في الطرفية لإضافة صفقة
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {openPositions.map((p) => (
            <SimulatedPositionRow key={p._id} position={p} onUpdated={handleUpdated} />
          ))}
          {closedPositions.slice(0, 10).map((p) => (
            <SimulatedPositionRow key={p._id} position={p} onUpdated={handleUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}

function SimulatedPositionsTabs() {
  const [activeTab, setActiveTab] = useState<"mt5" | "okx">("mt5");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/50 pb-2">
        <button
          onClick={() => setActiveTab("mt5")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            activeTab === "mt5"
              ? "bg-amber-500/10 text-amber-400"
              : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
          )}
        >
          <Award className="h-4 w-4" />
          الذهب والفوركس (MT5)
        </button>
        <button
          onClick={() => setActiveTab("okx")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            activeTab === "okx"
              ? "bg-cyan-500/10 text-cyan-400"
              : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
          )}
        >
          <Flame className="h-4 w-4" />
          الكريبتو (OKX)
        </button>
      </div>

      <SimulatedPositionsSection source={activeTab} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function DecisionJournalPage() {
  const [filterResult, setFilterResult] = useState<"" | "APPROVED" | "REJECTED">("");
  const [filterSymbol, setFilterSymbol] = useState<string>("");

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<JournalResponse>({
      queryKey: ["decision-journal", filterResult, filterSymbol],
      queryFn:  () =>
        fetchJournal(filterResult || undefined, filterSymbol || undefined),
      refetchInterval: 60_000,
      retry:           false,
      staleTime:       30_000,
    });

  const entries = data?.entries ?? [];

  const stats = useMemo(() => {
    const approved = entries.filter((e) => e.result === "APPROVED").length;
    return { total: entries.length, approved, rejected: entries.length - approved };
  }, [entries]);

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
              <BookOpen className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                سجل القرارات التحليلية
              </h1>
              <p className="text-xs text-muted-foreground">
                تاريخ تصويتات مجلس الوكلاء — للأغراض المعلوماتية فقط
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-amber-500/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            تحديث
          </button>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-xs text-amber-200/80 leading-relaxed">
            هذا السجل يعرض نتائج تحليل مجلس الوكلاء الآلي — تحليل معلوماتي فقط —
            ليس توصية مالية — القرار النهائي للإنسان دائماً.
          </p>
        </div>

        {/* Simulated Crypto & MT5 Journal */}
        <SimulatedPositionsTabs />

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            value={filterResult}
            onChange={(e) =>
              setFilterResult(e.target.value as "" | "APPROVED" | "REJECTED")
            }
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber-500/50"
          >
            <option value="">جميع النتائج</option>
            <option value="APPROVED">مقبولة فقط</option>
            <option value="REJECTED">مرفوضة فقط</option>
          </select>

          <input
            type="text"
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value.toUpperCase())}
            placeholder="فلتر بالرمز (مثال: XAUUSD)"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-500/50 w-48"
            maxLength={20}
          />
        </div>

        {/* Stats */}
        {!isLoading && !isError && (
          <StatsBar
            total={stats.total}
            approved={stats.approved}
            rejected={stats.rejected}
          />
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-xl border border-border bg-card/50 animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-6 text-center">
            <XCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-rose-300">
              تعذر الاتصال بخدمة FastAPI المحلية
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              تأكد من تشغيل{" "}
              <span className="font-mono">uvicorn main:app --port 8010</span>
            </p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && entries.length === 0 && (
          <div className="rounded-xl border border-border bg-card/30 px-4 py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              لا توجد تحليلات محفوظة بعد
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              ستظهر هنا بمجرد تشغيل محرك المسح في خدمة FastAPI
            </p>
          </div>
        )}

        {/* Journal entries */}
        {!isLoading && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry) => (
              <JournalRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/60 pb-4">
          نظام محكوم بالقواعد — Stage 14 مقفل — لا تنفيذ تداول آلي
        </p>
      </div>
    </div>
  );
}
