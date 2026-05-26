"use client";

/**
 * /gold/strategy-lab — Gold Strategy Lab — HTML Report Analyzer v1
 * تحليل تقارير MT5 Strategy Tester لـ XAUUSD — قراءة فقط.
 * التحليل يجري client-side فقط — لا يُرسل HTML إلى أي خادم.
 * لا تنفيذ تداول — لا اعتماد نهائي للاستراتيجية — تحليل أولي استرشادي فقط.
 */

import { useState, useRef } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  parseStrategyReport,
  evaluateReport,
  type ParsedReport,
  type StrategyEvaluation,
  type StrategyVerdict,
} from "@/lib/gold/strategy-report-parser";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConvexSafeWrapper } from "@/components/gold-pro/ConvexSafeWrapper";

// ─── Display helpers ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<
  StrategyVerdict,
  { label: string; icon: string; badge: string; border: string }
> = {
  Rejected: {
    label: "مرفوض",
    icon: "⛔",
    badge: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    border: "border-rose-500/20",
  },
  NeedsImprovement: {
    label: "يحتاج تحسيناً",
    icon: "⚠️",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    border: "border-amber-500/20",
  },
  Candidate: {
    label: "مرشّح للدراسة",
    icon: "✅",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    border: "border-emerald-500/20",
  },
};

function fmtNum(n: number | null, decimals = 2, suffix = ""): string {
  if (n === null) return "—";
  return n.toFixed(decimals) + suffix;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 py-1 border-b border-border/20 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-foreground/90 text-left tabular-nums font-mono">{value}</span>
    </div>
  );
}

// ─── Save to Library ──────────────────────────────────────────────────────────

function SaveToLibrarySection({
  parseResult,
  fileName,
}: {
  parseResult: ParsedReport;
  fileName: string | null;
}) {
  const { isAuthenticated } = useConvexAuth();
  const strategies = useQuery(
    api.strategies.listStrategiesForSelect,
    isAuthenticated ? {} : "skip",
  );
  const addFile     = useMutation(api.strategies.addStrategyFile);
  const addBacktest = useMutation(api.strategies.addStrategyBacktest);

  const [strategyId, setStrategyId] = useState<string>("");
  const [timeframe,  setTimeframe]  = useState<string>(parseResult.timeframe ?? "");
  const [periodFrom, setPeriodFrom] = useState<string>("");
  const [periodTo,   setPeriodTo]   = useState<string>("");
  const [notes,      setNotes]      = useState<string>("");
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [error,      setError]      = useState<string>("");

  if (!isAuthenticated) return null;

  async function handleSave() {
    if (!strategyId) { setError("اختر استراتيجية أولاً"); return; }
    if (!timeframe.trim()) { setError("أدخل الفريم الزمني"); return; }
    setSaving(true);
    setError("");
    try {
      const parsedFromMs = periodFrom
        ? new Date(periodFrom.replace(/\./g, "-")).getTime()
        : undefined;
      const parsedToMs = periodTo
        ? new Date(periodTo.replace(/\./g, "-")).getTime()
        : undefined;

      const fileId = await addFile({
        strategyId: strategyId as Id<"strategies">,
        fileType:   "BACKTEST_HTML",
        fileName:   fileName ?? "backtest.html",
        timeframe:  timeframe.trim(),
        periodFrom: isNaN(parsedFromMs as number) ? undefined : parsedFromMs,
        periodTo:   isNaN(parsedToMs as number)   ? undefined : parsedToMs,
        parsedSummary: JSON.stringify({
          totalTrades:  parseResult.totalTrades,
          winRate:      parseResult.winRate,
          netProfit:    parseResult.netProfit,
          profitFactor: parseResult.profitFactor,
          drawdownPct:  parseResult.drawdownPct,
        }),
        notes: notes.trim() || undefined,
      });

      const avgWin  = parseResult.averageWin  ?? 0;
      const avgLoss = Math.abs(parseResult.averageLoss ?? 0);
      const avgRR   = avgLoss > 0 ? avgWin / avgLoss : 1;

      await addBacktest({
        strategyId:  strategyId as Id<"strategies">,
        fileId,
        timeframe:   timeframe.trim(),
        periodFrom:  isNaN(parsedFromMs as number) ? undefined : parsedFromMs,
        periodTo:    isNaN(parsedToMs as number)   ? undefined : parsedToMs,
        totalTrades: parseResult.totalTrades ?? 0,
        winRate:     parseResult.winRate     ?? 0,
        netProfit:   parseResult.netProfit   ?? 0,
        maxDrawdown: parseResult.drawdownPct ?? 0,
        profitFactor: parseResult.profitFactor ?? 1,
        avgRR:       Math.round(avgRR * 100) / 100,
        notes:       notes.trim() || undefined,
      });

      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className={institutionalCardClass("p-4")}>
        <p className="text-emerald-400 text-sm font-medium">
          ✓ تم حفظ نتائج الباكتست في مكتبة الاستراتيجيات بنجاح.
        </p>
      </div>
    );
  }

  return (
    <div className={institutionalCardClass("p-4 space-y-3")}>
      <h3 className="font-medium text-amber-100/90 text-sm">حفظ في مكتبة الاستراتيجيات</h3>
      <p className="text-[11px] text-muted-foreground">
        احفظ ملخص نتائج هذا الباكتست مرتبطاً باستراتيجية موجودة في المكتبة.
      </p>

      {error ? (
        <p className="text-rose-300 text-xs rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
          {error}
        </p>
      ) : null}

      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground">الاستراتيجية *</label>
        <select
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
          className="w-full rounded-md border border-amber-500/20 bg-muted/20 px-3 py-2 text-foreground text-sm"
          disabled={!strategies || strategies.length === 0}
        >
          <option value="">
            {!strategies
              ? "جاري التحميل..."
              : strategies.length === 0
              ? "لا توجد استراتيجيات — أنشئ واحدة أولاً"
              : "اختر استراتيجية..."}
          </option>
          {(strategies ?? []).map((s) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">الفريم الزمني *</label>
          <Input
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            placeholder="H1"
            className="border-amber-500/20 bg-muted/20"
            dir="ltr"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">ملاحظات (اختياري)</label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثال: اختبار 2024"
            className="border-amber-500/20 bg-muted/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">من (YYYY.MM.DD)</label>
          <Input
            value={periodFrom}
            onChange={(e) => setPeriodFrom(e.target.value)}
            placeholder="2024.01.01"
            className="border-amber-500/20 bg-muted/20"
            dir="ltr"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">إلى (YYYY.MM.DD)</label>
          <Input
            value={periodTo}
            onChange={(e) => setPeriodTo(e.target.value)}
            placeholder="2025.01.01"
            className="border-amber-500/20 bg-muted/20"
            dir="ltr"
          />
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button
          type="button"
          disabled={saving || !strategies || strategies.length === 0}
          onClick={handleSave}
          className="bg-amber-600 hover:bg-amber-700 text-white text-sm"
        >
          {saving ? "جاري الحفظ..." : "حفظ في المكتبة"}
        </Button>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

function GoldStrategyLabPageContent() {
  const [htmlInput,   setHtmlInput]   = useState("");
  const [fileName,    setFileName]    = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParsedReport | null>(null);
  const [evaluation,  setEvaluation]  = useState<StrategyEvaluation | null>(null);
  const [inputError,  setInputError]  = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".html") && !file.name.endsWith(".htm")) {
      setInputError("الملف يجب أن يكون بصيغة .html أو .htm");
      return;
    }
    setInputError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setHtmlInput(text);
      setFileName(file.name);
      setParseResult(null);
      setEvaluation(null);
    };
    reader.onerror = () => setInputError("فشل قراءة الملف — حاول الصق المحتوى يدوياً");
    reader.readAsText(file, "utf-8");
  }

  function handleAnalyze() {
    if (!htmlInput.trim()) {
      setInputError("الصق HTML التقرير أو ارفع ملف .html أولاً");
      return;
    }
    setInputError(null);
    const parsed = parseStrategyReport(htmlInput);
    const evalu  = evaluateReport(parsed);
    setParseResult(parsed);
    setEvaluation(evalu);
  }

  function handleClear() {
    setHtmlInput("");
    setFileName(null);
    setParseResult(null);
    setEvaluation(null);
    setInputError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const hasInput = htmlInput.trim().length > 0;
  const vc = evaluation ? VERDICT_CONFIG[evaluation.verdict] : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6" dir="rtl">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="page-title">Gold Strategy Lab</h2>
          <span className="text-sm font-semibold text-amber-400/80 tracking-wide">
            محلّل تقارير Backtest — XAUUSD
          </span>
        </div>
        <p className="label-secondary mt-1">
          تحليل أولي لتقارير MT5 Strategy Tester — قراءة فقط — لا تنفيذ تداول.
        </p>
      </div>

      {/* ── Warning banner ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-1">
        <p className="text-amber-200/90 text-sm font-medium">
          ⚠️ هذا تحليل أولي لتقرير Backtest وليس اعتمادًا للاستراتيجية
        </p>
        <p className="text-amber-200/60 text-xs">
          نتائج Backtest لا تضمن أداء السوق الحقيقي. التحليل استرشادي فقط — ليس توصية مالية — لا تنفيذ تداول.
        </p>
      </div>

      {/* ── Input card ──────────────────────────────────────────────────── */}
      <div className={institutionalCardClass("p-4 space-y-4")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-amber-100/90 text-sm">إدخال تقرير MT5</h3>
          {fileName && (
            <span className="text-[10px] text-emerald-400/80 border border-emerald-500/20 rounded px-1.5 py-0.5">
              📄 {fileName}
            </span>
          )}
        </div>

        {/* Textarea */}
        <textarea
          dir="ltr"
          className="w-full h-40 rounded-md border border-border/60 bg-black/20 px-3 py-2 font-mono text-[11px] text-foreground/80 placeholder:text-muted-foreground/40 resize-y focus:outline-none focus:ring-1 focus:ring-amber-500/40"
          placeholder="الصق هنا محتوى HTML لتقرير MT5 Strategy Tester..."
          value={htmlInput}
          onChange={(e) => {
            setHtmlInput(e.target.value);
            setFileName(null);
            setParseResult(null);
            setEvaluation(null);
          }}
        />

        {/* File upload */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs border-amber-500/20 hover:border-amber-500/40"
            onClick={() => fileRef.current?.click()}
          >
            📂 رفع ملف .html
          </Button>
          <span className="text-[10px] text-muted-foreground">أو الصق المحتوى مباشرة في الحقل أعلاه</span>
        </div>

        {inputError && (
          <p className="text-rose-300/90 text-xs">{inputError}</p>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/30">
          <Button
            type="button"
            disabled={!hasInput}
            onClick={handleAnalyze}
            className="text-sm"
          >
            🔍 تحليل التقرير
          </Button>
          {hasInput && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            >
              مسح
            </Button>
          )}
        </div>

        {/* Privacy notice */}
        <p className="text-[10px] text-muted-foreground/50">
          🔒 لا يتم إرسال HTML إلى أي خادم — التحليل يجري محلياً في المتصفح فقط.
          لا يتم حفظ التقرير الخام. سيتم لاحقًا حفظ الخلاصة فقط بعد موافقتك.
        </p>
      </div>

      {/* ── Results card ────────────────────────────────────────────────── */}
      {evaluation && parseResult && vc && (
        <div className={institutionalCardClass(`p-4 space-y-4 ${vc.border}`)}>

          {/* Verdict header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium text-amber-100/90 text-sm">نتيجة التحليل الأولي</h3>
            <span className={`rounded-md border px-3 py-1 text-sm font-bold ${vc.badge}`}>
              {vc.icon} {vc.label}
            </span>
          </div>

          {/* Symbol status */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">رمز الزوج</span>
            <span className="font-bold text-amber-200 tabular-nums">
              {parseResult.symbol ?? "غير معروف"}
            </span>
            {evaluation.symbolStatus === "Confirmed" && (
              <span className="text-[10px] text-emerald-400/80 border border-emerald-500/20 rounded px-1 py-0.5">✓ XAUUSD مؤكّد</span>
            )}
            {evaluation.symbolStatus === "NotGold" && (
              <span className="text-[10px] text-rose-400/80 border border-rose-500/20 rounded px-1 py-0.5">✗ ليس XAUUSD</span>
            )}
            {evaluation.symbolStatus === "Unknown" && (
              <span className="text-[10px] text-amber-400/80 border border-amber-500/20 rounded px-1 py-0.5">؟ غير محدد</span>
            )}
          </div>

          {/* Extracted fields */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">البيانات المستخرجة</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              <div className="space-y-0">
                <FieldRow label="اسم الاستراتيجية"    value={parseResult.strategyName ?? "—"} />
                <FieldRow label="الرمز"                value={parseResult.symbol ?? "—"} />
                <FieldRow label="الإطار الزمني"        value={parseResult.timeframe ?? "—"} />
                <FieldRow label="فترة الاختبار"        value={parseResult.testPeriod ?? "—"} />
                <FieldRow label="الإيداع الأولي"       value={fmtNum(parseResult.deposit, 2)} />
                <FieldRow label="الرافعة المالية"      value={parseResult.leverage ?? "—"} />
                <FieldRow label="عدد الصفقات"          value={fmtNum(parseResult.totalTrades, 0)} />
              </div>
              <div className="space-y-0">
                <FieldRow label="صافي الربح"           value={fmtNum(parseResult.netProfit, 2)} />
                <FieldRow label="Profit Factor"        value={fmtNum(parseResult.profitFactor, 2)} />
                <FieldRow label="الانخفاض الأقصى %"    value={fmtNum(parseResult.drawdownPct, 2, "%")} />
                <FieldRow label="الانخفاض المطلق"      value={fmtNum(parseResult.drawdownAbs, 2)} />
                <FieldRow label="نسبة الفوز"           value={fmtNum(parseResult.winRate, 2, "%")} />
                <FieldRow label="متوسط الربح"          value={fmtNum(parseResult.averageWin, 2)} />
                <FieldRow label="متوسط الخسارة"        value={fmtNum(parseResult.averageLoss, 2)} />
              </div>
            </div>
          </div>

          {/* Verdict reasons */}
          {evaluation.reasons.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">أسباب الحكم</h4>
              <ul className="space-y-1">
                {evaluation.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                    <span className="mt-0.5 shrink-0 text-amber-400/60">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Parse warnings */}
          {evaluation.warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <h4 className="text-[10px] uppercase tracking-wider text-amber-400/70 mb-1">تحذيرات الاستخراج</h4>
              <ul className="space-y-0.5">
                {evaluation.warnings.map((w, i) => (
                  <li key={i} className="text-[11px] text-amber-300/70">⚠ {w}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/50">
            هذا تحليل أولي استرشادي — لا يُعدّ اعتمادًا نهائيًا للاستراتيجية — لا تنفيذ تداول.
          </p>
        </div>
      )}

      {/* ── Save to Library ─────────────────────────────────────────────── */}
      {evaluation && parseResult ? (
        <SaveToLibrarySection parseResult={parseResult} fileName={fileName} />
      ) : null}

    </div>
  );
}

export default function GoldStrategyLabPage() {
  return (
    <ConvexSafeWrapper>
      <GoldStrategyLabPageContent />
    </ConvexSafeWrapper>
  );
}
