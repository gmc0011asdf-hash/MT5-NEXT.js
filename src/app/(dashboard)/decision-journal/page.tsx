/**
 * decision-journal/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ هذه الصفحة Read-only — لا تنفيذ تداول — لا حفظ بيانات — لا API حقيقي.
 * البيانات المعروضة هي Placeholder محدودة النوع فقط لأغراض التصميم والاختبار.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type {
  DecisionJournalEntry,
  SignalStatus,
  OpportunityGrade,
  FinalDecision,
} from "@/lib/trading/shared/decision-contract";
import { AlertCircle, BookOpen, Download } from "lucide-react";

// ─── بيانات Placeholder — محدودة النوع — للعرض فقط ──────────────────────────
// ⚠️ هذه البيانات ثابتة ووهمية. لا تأتي من قاعدة البيانات ولا من أي API.
const PLACEHOLDER_ENTRIES: DecisionJournalEntry[] = [
  {
    id: "placeholder-001",
    platform: "MT5",
    symbol: "XAUUSD",
    timeframe: "H1",
    status: "READY_FOR_REVIEW",
    finalDecision: "HOLD",
    grade: "B",
    probability: 62,
    createdAt: "2026-05-02T08:00:00Z",
    updatedAt: "2026-05-02T09:00:00Z",
    entryPrice: 2310.5,
    invalidationPrice: 2295.0,
    reason: "تهيؤ مرحلي — بانتظار تأكيد إغلاق الشمعة فوق المقاومة (Placeholder)",
    committees: [],
    risk: {
      riskUsd: 0,
      riskPercent: 0,
      estimatedLot: 0,
      stopLoss: 2295.0,
      takeProfit1: 2330.0,
      takeProfit2: null,
      takeProfit3: null,
      rewardRiskRatio: 0,
      marginSafe: true,
    },
    review: {
      criticalTimeframe: "H1",
      nextReviewAt: "2026-05-02T12:00:00Z",
      expiresAt: "2026-05-03T08:00:00Z",
      reviewReason: "انتظار تأكيد",
      monitoringMode: "passive",
    },
    readOnly: true,
  },
  {
    id: "placeholder-002",
    platform: "MT5",
    symbol: "EURUSD",
    timeframe: "M15",
    status: "BLOCKED",
    finalDecision: "BLOCK",
    grade: "D",
    probability: 28,
    createdAt: "2026-05-02T07:30:00Z",
    updatedAt: "2026-05-02T07:45:00Z",
    entryPrice: 1.0872,
    invalidationPrice: 1.0895,
    reason: "حركة معاكسة للاتجاه الرئيسي — محظور من لجنة الاتجاه (Placeholder)",
    committees: [],
    risk: {
      riskUsd: 0,
      riskPercent: 0,
      estimatedLot: 0,
      stopLoss: 1.0895,
      takeProfit1: 1.0845,
      takeProfit2: null,
      takeProfit3: null,
      rewardRiskRatio: 0,
      marginSafe: false,
    },
    review: {
      criticalTimeframe: "M15",
      nextReviewAt: "2026-05-02T10:00:00Z",
      expiresAt: "2026-05-02T12:00:00Z",
      reviewReason: "محظور",
      monitoringMode: "paused",
    },
    readOnly: true,
  },
  {
    id: "placeholder-003",
    platform: "MT5",
    symbol: "XAUUSD",
    timeframe: "H4",
    status: "EXPIRED",
    finalDecision: "HOLD",
    grade: "C",
    probability: 45,
    createdAt: "2026-05-01T20:00:00Z",
    updatedAt: "2026-05-02T04:00:00Z",
    entryPrice: 2290.0,
    invalidationPrice: 2275.0,
    reason: "انتهت الفرصة — لم تتشكل شروط الدخول في الوقت المحدد (Placeholder)",
    committees: [],
    risk: {
      riskUsd: 0,
      riskPercent: 0,
      estimatedLot: 0,
      stopLoss: 2275.0,
      takeProfit1: 2315.0,
      takeProfit2: null,
      takeProfit3: null,
      rewardRiskRatio: 0,
      marginSafe: true,
    },
    review: {
      criticalTimeframe: "H4",
      nextReviewAt: "2026-05-02T08:00:00Z",
      expiresAt: "2026-05-02T04:00:00Z",
      reviewReason: "انتهت الصلاحية",
      monitoringMode: "paused",
    },
    readOnly: true,
  },
];

// ─── مساعدات العرض ────────────────────────────────────────────────────────────

function statusLabel(s: SignalStatus): string {
  const map: Record<SignalStatus, string> = {
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

function statusColor(s: SignalStatus): string {
  if (s === "READY_FOR_REVIEW") return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
  if (s === "BLOCKED") return "text-red-300 bg-red-500/10 border-red-500/30";
  if (s === "EXPIRED") return "text-zinc-400 bg-zinc-500/10 border-zinc-500/30";
  if (s === "WATCHING") return "text-sky-300 bg-sky-500/10 border-sky-500/30";
  return "text-amber-300 bg-amber-500/10 border-amber-500/30";
}

function decisionLabel(d: FinalDecision): string {
  const map: Record<FinalDecision, string> = {
    BUY: "شراء",
    SELL: "بيع",
    HOLD: "انتظار",
    BLOCK: "حظر",
  };
  return map[d] ?? d;
}

function gradeColor(g: OpportunityGrade): string {
  if (g === "A+" || g === "A") return "text-emerald-300";
  if (g === "B") return "text-amber-300";
  return "text-red-300";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-IQ", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── الصفحة ───────────────────────────────────────────────────────────────────

export default function DecisionJournalPage() {
  const entries = PLACEHOLDER_ENTRIES;

  const countByStatus = (s: SignalStatus) =>
    entries.filter((e) => e.status === s).length;

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-amber-500">
            سجل قرارات التحليل
          </h1>
          <p className="text-muted-foreground">
            جميع قرارات اللجان والتحليل — مرتبط بعقد البيانات الرسمي (Placeholder)
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

      {/* Read-only banner */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-200/90 text-sm flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Read-only / لا يوجد تنفيذ تداول</p>
          <p className="opacity-80">
            هذه بيانات تجريبية للعرض فقط وليست إشارات تداول حقيقية.
            لا تأتي من قاعدة بيانات ولا من API. النظام لا ينفذ صفقات حقيقية من هذه الشاشة.
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "إجمالي القرارات", value: entries.length, color: "text-foreground" },
          { label: "جاهز للمراجعة", value: countByStatus("READY_FOR_REVIEW"), color: "text-emerald-400" },
          { label: "محظور", value: countByStatus("BLOCKED"), color: "text-red-400" },
          { label: "منتهي الصلاحية", value: countByStatus("EXPIRED"), color: "text-zinc-400" },
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

      {/* Table card */}
      <div className="rounded-xl border border-border bg-card shadow">
        <div className="p-6">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-1">
                لا توجد قرارات مسجلة
              </h3>
              <p className="text-sm max-w-sm mx-auto">
                لم تقم اللجان والوكلاء باتخاذ أي قرارات تحليلية بعد.
              </p>
            </div>
          ) : null}

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
                  <th className="px-4 py-3 font-medium whitespace-nowrap">سبب الدخول أو المنع</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">expires_at</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">next_review_at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border border-t border-border">
                {entries.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-muted-foreground bg-muted/10"
                    >
                      البيانات غير متاحة (Placeholder)
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDate(entry.createdAt)}
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
                      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                        {entry.reason}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                        {formatDate(entry.review.expiresAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                        {formatDate(entry.review.nextReviewAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
