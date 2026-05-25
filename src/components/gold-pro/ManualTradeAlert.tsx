// src/components/gold-pro/ManualTradeAlert.tsx
// تنبيه تداول يدوي — يظهر عند وجود إشارة قوية (Score ≥ 70)
// لا order_send — لا تنفيذ آلي — تنفيذ يدوي في MT5 فقط
"use client";

import { useState } from "react";
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title={`نسخ ${label}`}
      className="ml-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
      style={{ background: copied ? "#166534" : "#1e293b", color: copied ? "#86efac" : "#94a3b8" }}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

interface Props {
  analysis: GoldProAnalysis;
}

export function ManualTradeAlert({ analysis }: Props) {
  const { confluence, sltp, positioning, tradeSetups } = analysis;
  const [expanded, setExpanded] = useState(true);

  // يظهر فقط عند BUY أو SELL بدرجة ≥ 70
  if (confluence.signal === "WAIT" || confluence.score < 70) return null;

  const isBuy = confluence.signal === "BUY";
  const colorBase  = isBuy ? "green"  : "red";
  const borderCls  = isBuy ? "border-green-500" : "border-red-500";
  const bgCls      = isBuy ? "bg-green-950"     : "bg-red-950";
  const textCls    = isBuy ? "text-green-300"    : "text-red-300";
  const accentCls  = isBuy ? "text-green-400"    : "text-red-400";
  const badgeCls   = isBuy
    ? "bg-green-900 text-green-300 border border-green-700"
    : "bg-red-900 text-red-300 border border-red-700";
  const signalAr   = isBuy ? "شراء" : "بيع";
  const dirAr      = isBuy ? "BUY  ↑" : "SELL ↓";

  const fmt = (n: number) => n.toFixed(2);

  // نستخدم trade setup الأول إن وُجد وأقوى من الأساسي، وإلا الأساسي
  const bestSetup = tradeSetups.length > 0
    ? tradeSetups.reduce((a, b) => b.confidence > a.confidence ? b : a)
    : null;

  const entry   = bestSetup ? fmt(bestSetup.entryPrice)  : fmt(sltp.entryPrice);
  const sl      = bestSetup ? fmt(bestSetup.stopLoss)    : fmt(sltp.stopLoss);
  const tp1     = bestSetup ? fmt(bestSetup.takeProfit1) : fmt(sltp.takeProfit1);
  const tp2     = bestSetup ? fmt(bestSetup.takeProfit2) : fmt(sltp.takeProfit2);
  const rr      = bestSetup ? bestSetup.rrRatio1.toFixed(1) : sltp.rrRatio1.toFixed(1);
  const lot     = bestSetup ? bestSetup.lotSize.toFixed(2) : positioning.lotSize.toFixed(2);
  const label   = bestSetup ? bestSetup.label : "H1 Intraday";
  const score   = confluence.score;

  const rows: Array<{ ar: string; val: string; copy?: boolean }> = [
    { ar: "الرمز",        val: "XAUUSD" },
    { ar: "الاتجاه",      val: dirAr },
    { ar: "سعر الدخول",  val: entry,  copy: true },
    { ar: "وقف الخسارة", val: sl,     copy: true },
    { ar: "هدف 1 (TP1)", val: tp1,    copy: true },
    { ar: "هدف 2 (TP2)", val: tp2,    copy: true },
    { ar: "حجم العقد",   val: `${lot} Lot`, copy: true },
    { ar: "R/R",          val: `1 : ${rr}` },
    { ar: "نوع الصفقة",  val: label },
    { ar: "درجة الثقة",  val: `${score} / 100` },
  ];

  return (
    <div className={`rounded-xl border-2 ${borderCls} ${bgCls} p-4 shadow-lg`} dir="rtl">
      {/* ─── Header ───────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{isBuy ? "🟢" : "🔴"}</span>
          <div>
            <p className={`text-lg font-bold ${accentCls}`}>
              إشارة {signalAr} قوية — XAUUSD
            </p>
            <p className="text-xs text-slate-400">
              درجة الالتقاء: <strong className={accentCls}>{score}/100</strong>
              {" · "}نفّذ يدوياً في MT5
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${badgeCls}`}>
            {dirAr}
          </span>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            {expanded ? "▲ إخفاء" : "▼ تفاصيل"}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* ─── Parameters Grid ──────────────────────────────────────── */}
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {rows.map(row => (
              <div key={row.ar} className="flex items-center justify-between border-b border-slate-800 py-1">
                <span className="text-slate-400">{row.ar}</span>
                <span className={`font-mono font-semibold ${
                  row.ar === "الاتجاه"     ? accentCls :
                  row.ar === "وقف الخسارة" ? "text-red-400" :
                  row.ar.startsWith("هدف") ? "text-green-400" :
                  row.ar === "حجم العقد"  ? "text-blue-400" :
                  textCls
                }`}>
                  {row.val}
                  {row.copy && <CopyButton value={row.val.replace(" Lot", "")} label={row.ar} />}
                </span>
              </div>
            ))}
          </div>

          {/* ─── MT5 خطوات التنفيذ ────────────────────────────────────── */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400">
            <p className="mb-2 font-semibold text-slate-300">📋 خطوات التنفيذ في MT5 (يدوي):</p>
            <ol className="list-decimal space-y-1 pr-4">
              <li>افتح MT5 → <strong>New Order</strong> على رمز <strong>XAUUSD</strong></li>
              <li>
                اختر <strong className={accentCls}>{isBuy ? "Buy" : "Sell"}</strong>
                {" · "}حجم الصفقة: <strong className="text-blue-400">{lot} Lot</strong>
              </li>
              <li>
                وقف الخسارة (Stop Loss): <strong className="text-red-400">{sl}</strong>
                <CopyButton value={sl} label="SL" />
              </li>
              <li>
                جني الأرباح (Take Profit): <strong className="text-green-400">{tp1}</strong>
                <CopyButton value={tp1} label="TP1" />
                {" "}أو <strong className="text-green-300">{tp2}</strong>
                <CopyButton value={tp2} label="TP2" />
              </li>
              <li>راجع السعر الحالي يطابق منطقة الدخول ثم اضغط <strong>Place</strong></li>
            </ol>
          </div>

          {/* ─── Disclaimer ───────────────────────────────────────────── */}
          <p className="mt-3 text-center text-[10px] text-slate-600">
            ⚠️ هذه إشارة تحليلية معلوماتية فقط — ليست توصية مالية — التنفيذ على مسؤوليتك الكاملة
          </p>
        </>
      )}
    </div>
  );
}
