"use client";
/**
 * decision-journal/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ هذه الصفحة للقراءة فقط ولا تنفذ أي تداول.
 * البيانات تأتي من Convex (decisionRuns + decisionAuditEvents) إن وجدت.
 * لا يوجد أي أمر تنفيذ هنا — لا useMutation — لا API routes.
 * userId يُستخرج من Clerk server-side داخل query — لا يُمرَّر من الواجهة.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { AlertCircle, BarChart2, BookOpen, ClipboardList, Download, X } from "lucide-react";

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
    BUY:   "شراء",
    SELL:  "بيع",
    HOLD:  "انتظار",
    BLOCK: "حظر",
  };
  return map[d] ?? d;
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
  // لا userId في args — يُستخرج من ctx.auth server-side داخل الـ query
  const events = useQuery(
    api.decisionJournal.listAuditEventsByDecision,
    isAuthenticated ? { decisionId, limit: 50 } : "skip",
  );
  const isLoading = events === undefined;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-card shadow">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
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

      <div className="p-6">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <span className="animate-pulse">جارٍ تحميل سجل التدقيق...</span>
          </div>
        )}

        {/* Empty */}
        {!isLoading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <ClipboardList className="h-8 w-8 text-muted-foreground/25 mb-3" />
            <p className="text-sm">لا توجد أحداث تدقيق لهذا القرار بعد.</p>
          </div>
        )}

        {/* Events list — Append-only read */}
        {!isLoading && events.length > 0 && (
          <div className="space-y-3">
            {events.map((ev) => (
              <div
                key={ev._id}
                className="rounded-lg border border-border bg-muted/5 p-4 space-y-2"
              >
                {/* Badge + triggeredBy + timestamp */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${eventTypeColor(ev.eventType)}`}
                    >
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

                {/* Status transition */}
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
                    {ev.fromStatus && ev.toStatus && (
                      <span className="opacity-50">←</span>
                    )}
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

                {/* Message */}
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
  // لا userId في args — يُستخرج من ctx.auth server-side
  const committees = useQuery(
    api.decisionJournal.listCommitteesByDecision,
    isAuthenticated ? { decisionId } : "skip",
  );
  const isLoading = committees === undefined;

  return (
    <div className="rounded-xl border border-border bg-card shadow">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
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

      <div className="p-6">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <span className="animate-pulse">جارٍ تحميل نتائج اللجان...</span>
          </div>
        )}

        {/* Empty */}
        {!isLoading && committees.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <BarChart2 className="h-8 w-8 text-muted-foreground/25 mb-3" />
            <p className="text-sm">لا توجد نتائج لجان لهذا القرار بعد.</p>
          </div>
        )}

        {/* Committee cards grid */}
        {!isLoading && committees.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {committees.map((c) => (
              <div
                key={c._id}
                className="rounded-lg border border-border bg-muted/5 p-4 space-y-3"
              >
                {/* Name + verdict badge */}
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground leading-tight">
                    {c.committeeName}
                  </p>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${verdictColor(c.verdict)}`}
                  >
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
  // ── Clerk auth check ──────────────────────────────────────────────────────
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  // ── Convex read-only query — لا userId في args ────────────────────────────
  const rawEntries = useQuery(
    api.decisionJournal.listMyDecisions,
    isAuthenticated ? { limit: 50 } : "skip",
  );

  // ── القرار المختار لعرض سجل التدقيق ────────────────────────────────────────
  const [selected, setSelected] = useState<{
    decisionId: string;
    symbol:     string;
  } | null>(null);

  const isLoading = isAuthLoading || rawEntries === undefined;
  const entries   = rawEntries ?? [];

  const countByStatus = (s: string) => entries.filter((e) => e.status === s).length;

  return (
    <div className="flex-1 space-y-6 p-6">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-amber-500">
            سجل قرارات التحليل
          </h1>
          <p className="text-muted-foreground">
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

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "إجمالي القرارات",  value: isLoading ? "—" : entries.length,                    color: "text-foreground"  },
          { label: "جاهز للمراجعة",   value: isLoading ? "—" : countByStatus("READY_FOR_REVIEW"), color: "text-emerald-400" },
          { label: "محظور",            value: isLoading ? "—" : countByStatus("BLOCKED"),          color: "text-red-400"     },
          { label: "منتهي الصلاحية",  value: isLoading ? "—" : countByStatus("EXPIRED"),          color: "text-zinc-400"    },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-card p-4 shadow"
          >
            <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ── Table card ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card shadow">
        <div className="p-6">

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              <span className="animate-pulse">جارٍ تحميل القرارات...</span>
            </div>
          )}

          {/* Empty state */}
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

          {/* Data table — Click a row to view its audit events */}
          {!isLoading && entries.length > 0 && (
            <>
              {selected !== null && (
                <p className="text-xs text-muted-foreground mb-3">
                  اضغط على صف لعرض سجل التدقيق
                </p>
              )}
              {selected === null && (
                <p className="text-xs text-muted-foreground mb-3">
                  اضغط على صف لعرض سجل التدقيق
                </p>
              )}
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
                      <th className="px-4 py-3 font-medium whitespace-nowrap">درجة الفرصة</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">الاحتمالية</th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">سبب القرار</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border border-t border-border">
                    {entries.map((entry) => {
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
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                            {formatTs(entry.createdAt)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                              {entry.platform}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono font-semibold">
                            {entry.symbol}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                            {entry.timeframe}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(entry.status)}`}
                            >
                              {statusLabel(entry.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-medium">
                            {decisionLabel(entry.finalDecision)}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap font-bold ${gradeColor(entry.grade)}`}>
                            {entry.grade}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                            {entry.probability}%
                          </td>
                          <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
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

      {/* ── تقرير اللجان — يظهر عند اختيار قرار ────────────────────────── */}
      {selected !== null && (
        <CommitteeBreakdownPanel
          decisionId={selected.decisionId}
          symbol={selected.symbol}
          isAuthenticated={isAuthenticated}
          onClose={() => setSelected(null)}
        />
      )}

      {/* ── سجل التدقيق — يظهر عند اختيار قرار ─────────────────────────── */}
      {selected !== null && (
        <AuditEventsPanel
          decisionId={selected.decisionId}
          symbol={selected.symbol}
          isAuthenticated={isAuthenticated}
          onClose={() => setSelected(null)}
        />
      )}

    </div>
  );
}
