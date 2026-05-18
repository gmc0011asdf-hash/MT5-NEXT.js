"use client";

/**
 * /gold/strategy-lab — Gold Strategy Lab — HTML Report Analyzer v1
 * تحليل تقارير MT5 Strategy Tester لـ XAUUSD — قراءة فقط.
 * التحليل يجري client-side فقط — لا يُرسل HTML إلى أي خادم — لا يُحفظ في Convex.
 * لا تنفيذ تداول — لا اعتماد نهائي للاستراتيجية — تحليل أولي استرشادي فقط.
 */

import { useState, useRef } from "react";
import {
  parseStrategyReport,
  evaluateReport,
  type ParsedReport,
  type StrategyEvaluation,
  type StrategyVerdict,
} from "@/lib/gold/strategy-report-parser";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { Button } from "@/components/ui/button";

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function GoldStrategyLabPage() {
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

          {/* Save notice */}
          <div className="rounded-md border border-zinc-500/20 bg-zinc-500/[0.04] px-3 py-2 space-y-1">
            <p className="text-[10px] text-muted-foreground/70">
              🔒 لا يتم حفظ التقرير الخام. سيتم لاحقًا حفظ الخلاصة فقط بعد موافقتك.
            </p>
            <p className="text-[10px] text-muted-foreground/50">
              هذا تحليل أولي استرشادي — لا يُعدّ اعتمادًا نهائيًا للاستراتيجية — لا تنفيذ تداول.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
