"use client";
/**
 * decision-journal/page.tsx — A21
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ قراءة فقط — لا تنفيذ تداول — لا useMutation — لا userId من الواجهة.
 * الفلترة والترتيب client-side فقط على البيانات المجلوبة من Convex.
 * userId يُستخرج من Clerk server-side داخل query.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  AlertCircle, ArrowUpDown, BarChart2, BookOpen,
  ClipboardList, Download, Search, SlidersHorizontal, X,
} from "lucide-react";

// ─── خيارات الفلاتر ───────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "",                  label: "كل الحالات"       },
  { value: "WATCHING",          label: "مراقبة"           },
  { value: "SETUP_FORMING",     label: "تهيؤ"             },
  { value: "WAIT_CONFIRMATION", label: "انتظار تأكيد"     },
  { value: "READY_FOR_REVIEW",  label: "جاهز للمراجعة"   },
  { value: "BLOCKED",           label: "محظور"            },
  { value: "EXPIRED",           label: "منتهي"            },
  { value: "HOLD",              label: "تعليق"            },
];

const DECISION_OPTIONS = [
  { value: "",      label: "كل القرارات" },
  { value: "BUY",   label: "شراء ↑"     },
  { value: "SELL",  label: "بيع ↓"      },
  { value: "HOLD",  label: "انتظار"      },
  { value: "BLOCK", label: "حظر"         },
];

const TIMEFRAME_OPTIONS = [
  { value: "",    label: "كل الفريمات" },
  ...["M1", "M5", "M15", "M30", "H1", "H4", "D1"].map((tf) => ({
    value: tf, label: tf,
  })),
];

const PLATFORM_OPTIONS = [
  { value: "",     label: "كل المنصات" },
  { value: "MT5",  label: "MT5"        },
  { value: "OKX",  label: "OKX"        },
];

// ─── مساعدات العرض — القرارات ────────────────────────────────────────────────

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    WATCHING:          "مراقبة",
    SETUP_FORMING:     "تهيؤ",
    WAIT_CONFIRMATION: "انتظار تأكيد",
    READY_FOR_REVIEW:  "جاهز للمراجعة",
    BLOCKED:           "محظور",
    EXPIRED:           "منتهي",
    HOLD:              "تعليق",
  };
  return map[s] ?? s;
}

function statusColor(s: string): string {
  if (s === "READY_FOR_REVIEW") return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
  if (s === "BLOCKED")          return "text-red-300 bg-red-500/10 border-red-500/30";
  if (s === "EXPIRED")          return "text-zinc-400 bg-zinc-500/10 border-zinc-500/30";
  if (s === "WATCHING")         return "text-sky-300 bg-sky-500/10 border-sky-500/30";
  return "text-amber-300 bg-amber-500/10 border-amber-500/30";
}

function decisionLabel(d: string): string {
  const map: Record<string, string> = {
    BUY:   "شراء ↑",
    SELL:  "بيع ↓",
    HOLD:  "انتظار",
    BLOCK: "حظر",
  };
  return map[d] ?? d;
}

function decisionColor(d: string): string {
  if (d === "BUY")   return "text-emerald-300";
  if (d === "SELL")  return "text-red-300";
  if (d === "BLOCK") return "text-red-400";
  return "text-muted-foreground";
}

function gradeColor(g: string): string {
  if (g === "A+" || g === "A") return "text-emerald-300";
  if (g === "B")               return "text-amber-300";
  return "text-red-300";
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString("ar-IQ", {
      month:  "short",
      day:    "numeric",
      hour:   "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

// ─── مساعدات العرض — أحداث التدقيق ──────────────────────────────────────────

function eventTypeLabel(et: string): string {
  const map: Record<string, string> = {
    CREATED:        "تم الإنشاء",
    STATUS_CHANGED: "تغيير الحالة",
    REVIEWED:       "مراجعة",
    EXPIRED:        "انتهاء الصلاحية",
    BLOCKED:        "حظر",
    HELD:           "تعليق",
    NOTE_ADDED:     "ملاحظة",
    SYSTEM_REVIEW:  "مراجعة نظام",
    RISK_RECHECK:   "إعادة فحص المخاطرة",
    DATA_REFRESHED: "تحديث البيانات",
  };
  return map[et] ?? et;
}

function eventTypeColor(et: string): string {
  if (et === "CREATED")        return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
  if (et === "BLOCKED")        return "text-red-300    bg-red-500/10    border-red-500/30";
  if (et === "EXPIRED")        return "text-zinc-400   bg-zinc-500/10   border-zinc-500/30";
  if (et === "STATUS_CHANGED") return "text-sky-300    bg-sky-500/10    border-sky-500/30";
  if (et === "NOTE_ADDED")     return "text-violet-300 bg-violet-500/10 border-violet-500/30";
  if (et === "REVIEWED")       return "text-blue-300   bg-blue-500/10   border-blue-500/30";
  return "text-amber-300 bg-amber-500/10 border-amber-500/30";
}

function triggeredByLabel(tb: string): string {
  if (tb === "system")       return "النظام";
  if (tb === "agent")        return "وكيل";
  if (tb === "lab-analysis") return "محرك التحليل";
  return tb;
}

// ─── مساعدات عرض اللجان ───────────────────────────────────────────────────────

function verdictColor(v: string): string {
  if (v === "PASS")  return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
  if (v === "WARN")  return "text-amber-300  bg-amber-500/10  border-amber-500/30";
  if (v === "BLOCK") return "text-red-300    bg-red-500/10    border-red-500/30";
  return "text-muted-foreground bg-muted/10 border-border";
}

function verdictLabel(v: string): string {
  if (v === "PASS")  return "ناجح ✓";
  if (v === "WARN")  return "تحذير ⚠";
  if (v === "BLOCK") return "محظور ✗";
  return v;
}

function verdictBarColor(v: string): string {
  if (v === "PASS")  return "bg-emerald-500/70";
  if (v === "WARN")  return "bg-amber-500/70";
  if (v === "BLOCK") return "bg-red-500/70";
  return "bg-muted";
}

// ─── FilterSelect — select مُصمَّم بالنمط الداكن الذهبي ──────────────────────

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value:    string;
  onChange: (v: string) => void;
  options:  { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50 cursor-pointer min-w-[100px]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── AuditEventsPanel ─────────────────────────────────────────────────────────
// قراءة فقط — لا useMutation — لا createDecisionAuditEvent — لا تنفيذ تداول

interface AuditEventsPanelProps {
  decisionId:      string;
  symbol:          string;
  isAuthenticated: boolean;
  onClose:         () => void;
}

function AuditEventsPanel({
  decisionId,
  symbol,
  isAuthenticated,
  onClose,
}: AuditEventsPanelProps) {
  const events = useQuery(
    api.decisionJournal.listAuditEventsByDecision,
    isAuthenticated ? { decisionId, limit: 50 } : "skip",
  );
  const isLoading = events === undefined;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-card shadow flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <ClipboardList className="h-4 w-4 text-amber-500 shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">
            سجل التدقيق —{" "}
            <span className="font-mono text-amber-400">{symbol}</span>
          </h2>
          <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
            قراءة فقط
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="إغلاق سجل التدقيق"
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-5 overflow-y-auto max-h-[420px]">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <span className="animate-pulse">جارٍ تحميل سجل التدقيق...</span>
          </div>
        )}

        {!isLoading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <ClipboardList className="h-8 w-8 text-muted-foreground/25 mb-3" />
            <p className="text-sm">لا توجد أحداث تدقيق لهذا القرار بعد.</p>
          </div>
        )}

        {!isLoading && events.length > 0 && (
          <div className="space-y-2.5">
            {events.map((ev) => (
              <div
                key={ev._id}
                className="rounded-lg border border-border bg-muted/5 p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${eventTypeColor(ev.eventType)}`}>
                      {eventTypeLabel(ev.eventType)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {triggeredByLabel(ev.triggeredBy)}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatTs(ev.createdAt)}
                  </span>
                </div>

                {(ev.fromStatus ?? ev.toStatus) && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                    {ev.fromStatus && (
                      <>
                        <span className="opacity-60">من:</span>
                        <span className="rounded border border-border px-1.5 py-0.5 bg-muted/20 font-mono">
                          {ev.fromStatus}
                        </span>
                      </>
                    )}
                    {ev.fromStatus && ev.toStatus && <span className="opacity-50">←</span>}
                    {ev.toStatus && (
                      <>
                        <span className="opacity-60">إلى:</span>
                        <span className="rounded border border-border px-1.5 py-0.5 bg-muted/20 font-mono">
                          {ev.toStatus}
                        </span>
                      </>
                    )}
                  </div>
                )}

                {ev.message && (
                  <p className="text-sm text-muted-foreground/90 leading-relaxed">
                    {ev.message}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CommitteeBreakdownPanel ──────────────────────────────────────────────────
// قراءة فقط — لا useMutation — لا تنفيذ تداول
// userId يُستخرَج من ctx.auth server-side داخل listCommitteesByDecision

interface CommitteeBreakdownPanelProps {
  decisionId:      string;
  symbol:          string;
  isAuthenticated: boolean;
  onClose:         () => void;
}

function CommitteeBreakdownPanel({
  decisionId,
  symbol,
  isAuthenticated,
  onClose,
}: CommitteeBreakdownPanelProps) {
  const committees = useQuery(
    api.decisionJournal.listCommitteesByDecision,
    isAuthenticated ? { decisionId } : "skip",
  );
  const isLoading = committees === undefined;

  return (
    <div className="rounded-xl border border-border bg-card shadow flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <BarChart2 className="h-4 w-4 text-amber-500 shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">
            تقرير اللجان —{" "}
            <span className="font-mono text-amber-400">{symbol}</span>
          </h2>
          <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
            قراءة فقط
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="إغلاق تقرير اللجان"
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-5 overflow-y-auto max-h-[420px]">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <span className="animate-pulse">جارٍ تحميل نتائج اللجان...</span>
          </div>
        )}

        {!isLoading && committees.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <BarChart2 className="h-8 w-8 text-muted-foreground/25 mb-3" />
            <p className="text-sm">لا توجد نتائج لجان لهذا القرار بعد.</p>
          </div>
        )}

        {!isLoading && committees.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {committees.map((c) => (
              <div
                key={c._id}
                className="rounded-lg border border-border bg-muted/5 p-3.5 space-y-2.5"
              >
                {/* Name + verdict badge */}
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground leading-tight">
                    {c.committeeName}
                  </p>
                  <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${verdictColor(c.verdict)}`}>
                    {verdictLabel(c.verdict)}
                  </span>
                </div>

                {/* Score bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>النتيجة</span>
                    <span className="font-mono font-bold tabular-nums">{c.score}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${verdictBarColor(c.verdict)}`}
                      style={{ width: `${Math.min(100, Math.max(0, c.score))}%` }}
                    />
                  </div>
                </div>

                {/* Summary */}
                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                  {c.summary}
                </p>

                {/* Reasons */}
                {c.reasons.length > 0 && (
                  <ul className="space-y-0.5">
                    {c.reasons.slice(0, 4).map((reason, i) => (
                      <li key={i} className="text-xs text-muted-foreground/60 leading-snug">
                        • {reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── الصفحة ───────────────────────────────────────────────────────────────────

export default function DecisionJournalPage() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  // ── Convex read-only query — لا userId في args ────────────────────────────
  const rawEntries = useQuery(
    api.decisionJournal.listMyDecisions,
    isAuthenticated ? { limit: 50 } : "skip",
  );

  // ── القرار المختار ────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<{
    decisionId: string;
    symbol:     string;
  } | null>(null);

  // ── حالة الفلاتر — client-side فقط ───────────────────────────────────────
  const [searchText,      setSearchText]      = useState("");
  const [filterStatus,    setFilterStatus]    = useState("");
  const [filterDecision,  setFilterDecision]  = useState("");
  const [filterTimeframe, setFilterTimeframe] = useState("");
  const [filterPlatform,  setFilterPlatform]  = useState("");
  const [sortAsc,         setSortAsc]         = useState(false); // false = الأحدث أولاً

  const isLoading = isAuthLoading || rawEntries === undefined;
  const entries   = rawEntries ?? [];

  // ── فلترة وترتيب client-side ──────────────────────────────────────────────
  const q = searchText.trim().toLowerCase();
  const filteredEntries = entries
    .filter((e) => {
      if (q && !e.symbol.toLowerCase().includes(q) && !e.reason.toLowerCase().includes(q)) return false;
      if (filterStatus    && e.status        !== filterStatus)    return false;
      if (filterDecision  && e.finalDecision !== filterDecision)  return false;
      if (filterTimeframe && e.timeframe     !== filterTimeframe) return false;
      if (filterPlatform  && e.platform      !== filterPlatform)  return false;
      return true;
    })
    .sort((a, b) => sortAsc ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);

  const hasActiveFilters = !!(q || filterStatus || filterDecision || filterTimeframe || filterPlatform);

  function clearFilters() {
    setSearchText("");
    setFilterStatus("");
    setFilterDecision("");
    setFilterTimeframe("");
    setFilterPlatform("");
  }

  const countByStatus = (s: string) => entries.filter((e) => e.status === s).length;

  return (
    <div className="flex-1 space-y-6 p-6">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-amber-500">
            سجل قرارات التحليل
          </h1>
          <p className="text-muted-foreground text-sm">
            جميع قرارات اللجان والتحليل — قراءة مباشرة من Convex
          </p>
        </div>
        <button
          disabled
          className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-500 opacity-50 cursor-not-allowed border border-amber-500/20"
        >
          <Download className="h-4 w-4" />
          تصدير التقرير — قريباً
        </button>
      </div>

      {/* ── Read-only banner ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-200/90 text-sm flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Read-only / لا يوجد تنفيذ تداول</p>
          <p className="opacity-80">
            هذه الصفحة للقراءة فقط ولا تنفذ أي تداول.
            البيانات تأتي من Convex إن وجدت، ولا توجد أوامر تنفيذ هنا.
          </p>
        </div>
      </div>

      {/* ── Stats row — مجموع كامل بدون تأثير الفلاتر ──────────────────── */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "إجمالي القرارات", value: isLoading ? "—" : entries.length,                    color: "text-foreground"  },
          { label: "جاهز للمراجعة",  value: isLoading ? "—" : countByStatus("READY_FOR_REVIEW"), color: "text-emerald-400" },
          { label: "محظور",           value: isLoading ? "—" : countByStatus("BLOCKED"),          color: "text-red-400"     },
          { label: "منتهي الصلاحية", value: isLoading ? "—" : countByStatus("EXPIRED"),          color: "text-zinc-400"    },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4 shadow">
            <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ── Table card ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card shadow">

        {/* ── Filter bar ─────────────────────────────────────────────────── */}
        {!isLoading && entries.length > 0 && (
          <div className="px-5 py-4 border-b border-border space-y-3">
            {/* Row 1: filters label + controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 ml-1">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>فلتر:</span>
              </div>

              {/* Search input */}
              <div className="relative flex-1 min-w-[140px] max-w-[200px]">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="رمز أو سبب…"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="w-full rounded-md border border-border bg-background pr-7 pl-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                />
              </div>

              <FilterSelect value={filterStatus}    onChange={setFilterStatus}    options={STATUS_OPTIONS}    />
              <FilterSelect value={filterDecision}  onChange={setFilterDecision}  options={DECISION_OPTIONS}  />
              <FilterSelect value={filterTimeframe} onChange={setFilterTimeframe} options={TIMEFRAME_OPTIONS} />
              <FilterSelect value={filterPlatform}  onChange={setFilterPlatform}  options={PLATFORM_OPTIONS}  />

              {/* Sort toggle */}
              <button
                onClick={() => setSortAsc((v) => !v)}
                title={sortAsc ? "عرض الأحدث أولاً" : "عرض الأقدم أولاً"}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-amber-500/40 transition-colors"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sortAsc ? "الأقدم أولاً" : "الأحدث أولاً"}
              </button>

              {/* Clear filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  مسح الفلاتر
                </button>
              )}
            </div>

            {/* Count */}
            <p className="text-xs text-muted-foreground">
              {hasActiveFilters ? (
                <>
                  يعرض{" "}
                  <span className="font-semibold text-amber-400">{filteredEntries.length}</span>
                  {" "}من{" "}
                  <span className="font-semibold">{entries.length}</span>
                  {" "}قرار
                </>
              ) : (
                <>
                  إجمالي{" "}
                  <span className="font-semibold text-foreground">{entries.length}</span>
                  {" "}قرار
                </>
              )}
            </p>
          </div>
        )}

        <div className="p-5">

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              <span className="animate-pulse">جارٍ تحميل القرارات...</span>
            </div>
          )}

          {/* Empty — لا بيانات نهائياً */}
          {!isLoading && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-1">
                لا توجد قرارات محفوظة بعد
              </h3>
              <p className="text-sm max-w-sm mx-auto">
                سيظهر السجل هنا عند ربط محرك التحليل بحفظ القرارات.
              </p>
            </div>
          )}

          {/* No results after filter */}
          {!isLoading && entries.length > 0 && filteredEntries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <Search className="h-10 w-10 text-muted-foreground/25 mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">
                لا توجد نتائج تطابق الفلاتر الحالية
              </p>
              <button
                onClick={clearFilters}
                className="mt-2 text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2"
              >
                مسح الفلاتر
              </button>
            </div>
          )}

          {/* Data table */}
          {!isLoading && filteredEntries.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                اضغط على صف لعرض تقرير اللجان وسجل التدقيق
              </p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm text-right">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">الوقت</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">المنصة</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">الرمز</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">الفريم</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">الحالة</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">القرار</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">الدرجة</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">%</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">السبب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border border-t border-border">
                    {filteredEntries.map((entry) => {
                      const isSelected = selected?.decisionId === entry.decisionId;
                      return (
                        <tr
                          key={entry._id}
                          onClick={() =>
                            setSelected(
                              isSelected
                                ? null
                                : { decisionId: entry.decisionId, symbol: entry.symbol },
                            )
                          }
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-amber-500/10 border-r-2 border-r-amber-500"
                              : "hover:bg-muted/10"
                          }`}
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                            {formatTs(entry.createdAt)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                              {entry.platform}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono font-semibold text-sm">
                            {entry.symbol}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                            {entry.timeframe}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(entry.status)}`}>
                              {statusLabel(entry.status)}
                            </span>
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap font-semibold text-sm ${decisionColor(entry.finalDecision)}`}>
                            {decisionLabel(entry.finalDecision)}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap font-bold ${gradeColor(entry.grade)}`}>
                            {entry.grade}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                            {entry.probability}%
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                            {entry.reason}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </div>
      </div>

      {/* ── قسم التفاصيل — يظهر عند اختيار صف ──────────────────────────── */}
      {selected !== null && (
        <div className="space-y-4">

          {/* شريط المعلومات + زر الإغلاق الرئيسي */}
          <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono font-bold text-amber-400 text-sm">
                {selected.symbol}
              </span>
              <span className="text-muted-foreground text-xs">— عرض التفاصيل</span>
              <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
                قراءة فقط
              </span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 border border-border transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              إغلاق التفاصيل
            </button>
          </div>

          {/* اللجان + التدقيق في grid ─────────────────────────────────────── */}
          <div className="grid gap-5 lg:grid-cols-2">
            <CommitteeBreakdownPanel
              decisionId={selected.decisionId}
              symbol={selected.symbol}
              isAuthenticated={isAuthenticated}
              onClose={() => setSelected(null)}
            />
            <AuditEventsPanel
              decisionId={selected.decisionId}
              symbol={selected.symbol}
              isAuthenticated={isAuthenticated}
              onClose={() => setSelected(null)}
            />
          </div>

        </div>
      )}

    </div>
  );
}
