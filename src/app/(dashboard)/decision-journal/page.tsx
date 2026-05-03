"use client";
/**
 * decision-journal/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ هذه الصفحة للقراءة فقط ولا تنفذ أي تداول.
 * البيانات تأتي من Convex (decisionRuns) إن وجدت.
 * لا يوجد أي أمر تنفيذ هنا — لا useMutation — لا API routes.
 * userId يُستخرج من Clerk server-side داخل query — لا يُمرَّر من الواجهة.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { AlertCircle, BookOpen, Download } from "lucide-react";

// ─── مساعدات العرض ────────────────────────────────────────────────────────────

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    WATCHING: "مراقبة",
    SETUP_FORMING: "تهيؤ",
    WAIT_CONFIRMATION: "انتظار تأكيد",
    READY_FOR_REVIEW: "جاهز للمراجعة",
    BLOCKED: "محظور",
    EXPIRED: "منتهي",
    HOLD: "تعليق",
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

// ─── الصفحة ───────────────────────────────────────────────────────────────────

export default function DecisionJournalPage() {
  // ── Clerk auth check — نفس النمط المستخدم في lab/mt5/page.tsx ──
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  // ── Convex read-only query — لا userId في args — يُستخرج من ctx.auth server-side ──
  const rawEntries = useQuery(
    api.decisionJournal.listMyDecisions,
    isAuthenticated ? { limit: 50 } : "skip",
  );

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

          {/* Data table */}
          {!isLoading && entries.length > 0 && (
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
                  {entries.map((entry) => (
                    <tr key={entry._id} className="hover:bg-muted/10 transition-colors">
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
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
