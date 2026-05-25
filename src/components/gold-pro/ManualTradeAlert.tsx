// src/components/gold-pro/ManualTradeAlert.tsx
// تنبيه تداول — يظهر عند Score ≥ 70
// يشمل زر التنفيذ التلقائي الذي يفتح TradeConfirmModal
"use client";

import { useState, useCallback } from "react";
import type { GoldProAnalysis, ExecutionResult } from "@/lib/gold-pro/types";
import { TradeConfirmModal, type TradeConfirmData } from "./TradeConfirmModal";

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
      style={{
        background: copied ? "#166534" : "#1e293b",
        color: copied ? "#86efac" : "#94a3b8",
      }}
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
  const [showModal, setShowModal] = useState(false);

  // يظهر فقط عند BUY أو SELL بدرجة ≥ 70
  if (confluence.signal === "WAIT" || confluence.score < 70) return null;

  const isBuy = confluence.signal === "BUY";
  const borderCls = isBuy ? "border-green-500" : "border-red-500";
  const bgCls     = isBuy ? "bg-green-950"     : "bg-red-950";
  const accentCls = isBuy ? "text-green-400"    : "text-red-400";
  const badgeCls  = isBuy
    ? "bg-green-900 text-green-300 border border-green-700"
    : "bg-red-900 text-red-300 border border-red-700";
  const signalAr  = isBuy ? "شراء" : "بيع";
  const dirAr     = isBuy ? "BUY  ↑" : "SELL ↓";

  const fmt = (n: number) => n.toFixed(2);

  // أفضل إعداد صفقة (أعلى ثقة)
  const bestSetup =
    tradeSetups.length > 0
      ? tradeSetups.reduce((a, b) => (b.confidence > a.confidence ? b : a))
      : null;

  const entry = bestSetup ? bestSetup.entryPrice  : sltp.entryPrice;
  const sl    = bestSetup ? bestSetup.stopLoss     : sltp.stopLoss;
  const tp1   = bestSetup ? bestSetup.takeProfit1  : sltp.takeProfit1;
  const tp2   = bestSetup ? bestSetup.takeProfit2  : sltp.takeProfit2;
  const rr    = bestSetup ? bestSetup.rrRatio1     : sltp.rrRatio1;
  const lot   = Math.min(bestSetup ? bestSetup.lotSize : positioning.lotSize, 0.10);
  const label = bestSetup ? bestSetup.label : "H1 Intraday";
  const score = confluence.score;

  const modalData: TradeConfirmData = {
    symbol:          analysis.symbol,
    order_type:      confluence.signal as "BUY" | "SELL",
    lot,
    entry,
    sl,
    tp:              tp1,
    rr:              rr.toFixed(1),
    confluenceScore: score,
    setupLabel:      label,
  };

  const handleExecute = useCallback(async (): Promise<ExecutionResult | null> => {
    const res = await fetch("/api/lab/gold-pro/execute-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol:          modalData.symbol,
        order_type:      modalData.order_type,
        lot:             modalData.lot,
        sl:              modalData.sl,
        tp:              modalData.tp,
        comment:         `GoldPro-${modalData.setupLabel}`,
        confluenceScore: modalData.confluenceScore,
        setupLabel:      modalData.setupLabel,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "خطأ" }));
      throw new Error(err.error ?? "فشل التنفيذ");
    }
    return res.json() as Promise<ExecutionResult>;
  }, [modalData]);

  const rows: Array<{ ar: string; val: string; copy?: string; cls?: string }> = [
    { ar: "الرمز",        val: analysis.symbol },
    { ar: "الاتجاه",      val: dirAr,                    cls: accentCls },
    { ar: "سعر الدخول",  val: fmt(entry),  copy: fmt(entry) },
    { ar: "وقف الخسارة", val: fmt(sl),     copy: fmt(sl),   cls: "text-red-400" },
    { ar: "هدف 1 (TP1)", val: fmt(tp1),    copy: fmt(tp1),  cls: "text-green-400" },
    { ar: "هدف 2 (TP2)", val: fmt(tp2),    copy: fmt(tp2),  cls: "text-green-300" },
    { ar: "حجم العقد",   val: `${lot.toFixed(2)} Lot`, copy: lot.toFixed(2), cls: "text-blue-400" },
    { ar: "R/R",          val: `1 : ${rr.toFixed(1)}` },
    { ar: "نوع الصفقة",  val: label },
    { ar: "درجة الثقة",  val: `${score} / 100`, cls: accentCls },
  ];

  return (
    <>
      <div
        className={`rounded-xl border-2 ${borderCls} ${bgCls} p-4 shadow-lg`}
        dir="rtl"
      >
        {/* ─── Header ─────────────────────────────────────────────── */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{isBuy ? "🟢" : "🔴"}</span>
            <div>
              <p className={`text-lg font-bold ${accentCls}`}>
                إشارة {signalAr} قوية — XAUUSD
              </p>
              <p className="text-xs text-slate-400">
                درجة الالتقاء:{" "}
                <strong className={accentCls}>{score}/100</strong>
                {" · "}تنفيذ تلقائي متاح
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${badgeCls}`}>
              {dirAr}
            </span>
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              {expanded ? "▲" : "▼"}
            </button>
          </div>
        </div>

        {expanded && (
          <>
            {/* ─── Parameters ─────────────────────────────────────── */}
            <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {rows.map((row) => (
                <div
                  key={row.ar}
                  className="flex items-center justify-between border-b border-slate-800 py-1"
                >
                  <span className="text-slate-400">{row.ar}</span>
                  <span className={`font-mono font-semibold ${row.cls ?? "text-white"}`}>
                    {row.val}
                    {row.copy && <CopyButton value={row.copy} label={row.ar} />}
                  </span>
                </div>
              ))}
            </div>

            {/* ─── Execute Button ──────────────────────────────────── */}
            <button
              onClick={() => setShowModal(true)}
              className={`mb-3 w-full rounded-xl py-3 text-base font-bold shadow-md transition-all active:scale-95 ${
                isBuy
                  ? "bg-green-500 text-black shadow-green-900 hover:bg-green-400"
                  : "bg-red-500 text-white shadow-red-900 hover:bg-red-400"
              }`}
            >
              {isBuy ? "⚡ تنفيذ الشراء تلقائياً" : "⚡ تنفيذ البيع تلقائياً"}
            </button>

            {/* ─── Disclaimer ─────────────────────────────────────── */}
            <p className="text-center text-[10px] text-slate-600">
              ⚠️ تنفيذ على Demo فقط — ليست توصية مالية — على مسؤوليتك الكاملة
            </p>
          </>
        )}
      </div>

      {/* ─── Confirmation Modal ──────────────────────────────────── */}
      {showModal && (
        <TradeConfirmModal
          data={modalData}
          onConfirm={handleExecute}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
