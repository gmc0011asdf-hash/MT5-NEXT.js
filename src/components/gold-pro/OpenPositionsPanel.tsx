// src/components/gold-pro/OpenPositionsPanel.tsx
// لوحة المراكز المفتوحة — تعيد الاستعلام كل 5 ثوانٍ
// تُتيح إغلاق الصفقات بنقرة واحدة
"use client";

import { useState, useEffect, useCallback } from "react";
import type { OpenPosition } from "@/lib/gold-pro/types";

export function OpenPositionsPanel() {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [connected, setConnected] = useState(false);
  const [closing, setClosing] = useState<number | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/lab/gold-pro/positions");
      if (!res.ok) return;
      const data = await res.json();
      setPositions(data.positions ?? []);
      setConnected(data.connected ?? false);
      setLastUpdated(Date.now());
    } catch {
      // صامت — خدمة التنفيذ قد لا تكون مشغّلة
    }
  }, []);

  // الاستعلام الأولي + polling كل 15 ثانية (كانت 5 — خُفِّضت لتخفيف الحمل)
  useEffect(() => {
    fetchPositions();
    const id = setInterval(fetchPositions, 15_000);
    return () => clearInterval(id);
  }, [fetchPositions]);

  const handleClose = async (ticket: number) => {
    setClosing(ticket);
    setCloseError(null);
    try {
      const res = await fetch("/api/lab/gold-pro/close-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "خطأ" }));
        setCloseError(err.error ?? "فشل الإغلاق");
      } else {
        // تحديث فوري بعد الإغلاق
        await fetchPositions();
      }
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setClosing(null);
    }
  };

  // إخفاء اللوحة إذا لم تكن الخدمة متصلة ولا توجد مراكز
  if (!connected && positions.length === 0) return null;

  const totalProfit = positions.reduce((sum, p) => sum + p.profit, 0);

  return (
    <div
      className="rounded-xl border border-slate-700 bg-slate-900 p-4"
      dir="rtl"
    >
      {/* --- Header ----------------------------------------------- */}
      <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
        <p className="text-xs uppercase tracking-widest text-slate-500">
          📋 المراكز المفتوحة
        </p>
        <div className="flex items-center gap-3 text-xs">
          {positions.length > 0 && (
            <span className={`font-mono font-semibold ${
              totalProfit >= 0 ? "text-green-400" : "text-red-400"
            }`}>
              إجمالي P&L:{" "}
              {totalProfit >= 0 ? "+" : ""}
              {totalProfit.toFixed(2)} $
            </span>
          )}
          <span className="text-slate-500">
            {positions.length} مركز
            {" · "}
            <span className={connected ? "text-green-500" : "text-red-500"}>
              {connected ? "● متصل" : "● منقطع"}
            </span>
            {lastUpdated && (
              <span className="text-slate-600">
                {" · "}آخر تحديث:{" "}
                {new Date(lastUpdated).toLocaleTimeString("ar-EG")}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* --- Positions List ---------------------------------------- */}
      {positions.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-600">
          لا توجد مراكز مفتوحة حالياً
        </p>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const isBuy = pos.type === "BUY";
            const profitPos = pos.profit >= 0;
            const pnlPct =
              pos.price_open > 0
                ? ((pos.price_current - pos.price_open) /
                    pos.price_open) *
                  100 *
                  (isBuy ? 1 : -1)
                : 0;

            return (
              <div
                key={pos.ticket}
                className="rounded-lg border border-slate-800 bg-slate-800/50 p-3"
              >
                {/* Top row */}
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${
                        isBuy
                          ? "bg-green-900 text-green-300"
                          : "bg-red-900 text-red-300"
                      }`}
                    >
                      {isBuy ? "▲ BUY" : "▼ SELL"}
                    </span>
                    <span className="font-bold text-white">{pos.symbol}</span>
                    <span className="text-xs text-slate-500">#{pos.ticket}</span>
                    <span className="text-xs text-slate-500">
                      {pos.volume.toFixed(2)} Lot
                    </span>
                  </div>
                  {/* P&L + Close */}
                  <div className="flex items-center gap-3">
                    <div className="text-left">
                      <p
                        className={`font-mono font-bold ${
                          profitPos ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {profitPos ? "+" : ""}
                        {pos.profit.toFixed(2)} $
                      </p>
                      <p
                        className={`text-[10px] ${
                          profitPos ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {pnlPct >= 0 ? "+" : ""}
                        {pnlPct.toFixed(2)}%
                      </p>
                    </div>
                    <button
                      onClick={() => handleClose(pos.ticket)}
                      disabled={closing === pos.ticket}
                      className="rounded-lg border border-red-700 bg-red-950 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900 disabled:opacity-50"
                    >
                      {closing === pos.ticket ? "⏳" : "✕ إغلاق"}
                    </button>
                  </div>
                </div>

                {/* Price details */}
                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                  <div>
                    <span className="block text-[10px] text-slate-600">دخل</span>
                    <span className="font-mono text-slate-300">
                      {pos.price_open.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-600">حالي</span>
                    <span
                      className={`font-mono font-semibold ${
                        profitPos ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {pos.price_current.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-600">SL / TP</span>
                    <span className="font-mono">
                      <span className="text-red-400">{pos.sl.toFixed(2)}</span>
                      {" / "}
                      <span className="text-green-400">{pos.tp.toFixed(2)}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- Close Error ------------------------------------------- */}
      {closeError && (
        <p className="mt-3 rounded border border-red-800 bg-red-950 p-2 text-xs text-red-400">
          ⚠️ {closeError}
        </p>
      )}
    </div>
  );
}
