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
} from "lucide-react";

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
