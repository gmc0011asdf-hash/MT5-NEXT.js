// src/components/gold-pro/TradeConfirmModal.tsx
// نافذة تأكيد الصفقة — مرحلتان: مراجعة ← تأكيد نهائي ← تنفيذ ← نتيجة
"use client";

import { useState } from "react";
import type { ExecutionResult } from "@/lib/gold-pro/types";

export interface TradeConfirmData {
  symbol: string;
  order_type: "BUY" | "SELL";
  lot: number;
  entry: number;
  sl: number;
  tp: number;
  rr: string;
  confluenceScore: number;
  setupLabel: string;
}

interface Props {
  data: TradeConfirmData;
  onConfirm: () => Promise<ExecutionResult | null>;
  onClose: () => void;
}

type Step = "review" | "confirm" | "executing" | "done" | "error";

export function TradeConfirmModal({ data, onConfirm, onClose }: Props) {
  const [step, setStep] = useState<Step>("review");
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const isBuy = data.order_type === "BUY";
  const accentCls = isBuy ? "text-green-400" : "text-red-400";
  const borderCls = isBuy ? "border-green-600" : "border-red-600";

  const handleFinalConfirm = async () => {
    setStep("executing");
    try {
      const res = await onConfirm();
      if (res) {
        setResult(res);
        setStep("done");
      } else {
        setErrorMsg("لم يُستلم رد من خدمة التنفيذ");
        setStep("error");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "خطأ غير معروف");
      setStep("error");
    }
  };

  const reviewRows: Array<[string, string, string]> = [
    ["الرمز",        data.symbol,                   "text-white"],
    ["الاتجاه",      isBuy ? "BUY ↑ شراء" : "SELL ↓ بيع", accentCls],
    ["حجم الصفقة",   `${data.lot.toFixed(2)} Lot`,  "text-blue-400"],
    ["سعر الدخول",  data.entry.toFixed(2),          "text-white"],
    ["وقف الخسارة", data.sl.toFixed(2),             "text-red-400"],
    ["هدف الربح",   data.tp.toFixed(2),             "text-green-400"],
    ["R/R",          `1 : ${data.rr}`,              "text-white"],
    ["درجة الثقة",  `${data.confluenceScore}/100`,  accentCls],
    ["نوع الإعداد", data.setupLabel,               "text-slate-300"],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={(e) => e.target === e.currentTarget && step !== "executing" && onClose()}
    >
      <div
        className={`w-full max-w-md rounded-2xl border-2 ${borderCls} bg-slate-900 p-6 shadow-2xl`}
        dir="rtl"
      >

        {/* -- Step 1: Review ---------------------------------------- */}
        {step === "review" && (
          <>
            <h2 className="mb-1 text-lg font-bold text-white">
              {isBuy ? "🟢" : "🔴"} مراجعة الصفقة
            </h2>
            <p className="mb-4 text-xs text-slate-400">
              تحقق من جميع التفاصيل قبل المتابعة
            </p>
            <div className="mb-4 space-y-1 text-sm">
              {reviewRows.map(([label, value, cls]) => (
                <div
                  key={label}
                  className="flex justify-between border-b border-slate-800 py-1"
                >
                  <span className="text-slate-400">{label}</span>
                  <span className={`font-mono font-semibold ${cls}`}>{value}</span>
                </div>
              ))}
            </div>
            <div className="mb-4 rounded-lg border border-yellow-700 bg-yellow-950 p-3 text-xs text-yellow-300">
              ⚠️ <strong>تأكد أن MT5 متصل بحساب تجريبي (Demo)</strong> — الخدمة تمنع الحسابات الحقيقية تلقائياً
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep("confirm")}
                className={`flex-1 rounded-lg py-2.5 font-bold ${
                  isBuy
                    ? "bg-green-600 text-white hover:bg-green-500"
                    : "bg-red-600 text-white hover:bg-red-500"
                }`}
              >
                متابعة للتأكيد النهائي →
              </button>
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-400 hover:bg-slate-800"
              >
                إلغاء
              </button>
            </div>
          </>
        )}

        {/* -- Step 2: Final Confirm --------------------------------- */}
        {step === "confirm" && (
          <>
            <h2 className="mb-2 text-lg font-bold text-white">⚡ تأكيد نهائي</h2>
            <p className="mb-4 text-sm text-slate-300">
              هل أنت متأكد من تنفيذ صفقة{" "}
              <strong className={accentCls}>{data.order_type} {data.symbol}</strong>
              {" "}بحجم{" "}
              <strong className="text-blue-400">{data.lot.toFixed(2)} Lot</strong>؟
            </p>
            <p className="mb-6 text-xs text-slate-500">
              لا يمكن التراجع بعد التنفيذ — ستحتاج إلى إغلاق المركز يدوياً أو من لوحة المراكز المفتوحة
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleFinalConfirm}
                className={`flex-1 rounded-lg py-3 text-base font-bold ${
                  isBuy
                    ? "bg-green-500 text-black hover:bg-green-400"
                    : "bg-red-500 text-white hover:bg-red-400"
                }`}
              >
                {isBuy ? "✅ نفّذ الشراء" : "✅ نفّذ البيع"}
              </button>
              <button
                onClick={() => setStep("review")}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-400 hover:bg-slate-800"
              >
                ← رجوع
              </button>
            </div>
          </>
        )}

        {/* -- Step 3: Executing ------------------------------------- */}
        {step === "executing" && (
          <div className="py-10 text-center">
            <div className="mb-4 text-5xl">⏳</div>
            <p className="text-sm text-slate-300">جاري إرسال الأمر إلى MT5…</p>
            <p className="mt-1 text-xs text-slate-500">لا تغلق النافذة</p>
          </div>
        )}

        {/* -- Step 4: Done ------------------------------------------ */}
        {step === "done" && result && (
          <>
            <div className="mb-3 text-center text-5xl">✅</div>
            <h2 className="mb-4 text-center text-lg font-bold text-green-400">
              تم التنفيذ بنجاح
            </h2>
            <div className="mb-4 space-y-1 text-sm">
              {[
                ["رقم التذكرة (Ticket)", String(result.ticket)],
                ["سعر التنفيذ الفعلي",   result.price.toFixed(2)],
                ["الحجم المنفّذ",         `${result.volume.toFixed(2)} Lot`],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between border-b border-slate-800 py-1"
                >
                  <span className="text-slate-400">{label}</span>
                  <span className="font-mono font-semibold text-white">{value}</span>
                </div>
              ))}
            </div>
            <p className="mb-4 text-center text-xs text-slate-500">
              تابع المركز في لوحة المراكز المفتوحة أدناه
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-slate-700 py-2 text-slate-200 hover:bg-slate-600"
            >
              إغلاق
            </button>
          </>
        )}

        {/* -- Step 5: Error ----------------------------------------- */}
        {step === "error" && (
          <>
            <div className="mb-3 text-center text-5xl">❌</div>
            <h2 className="mb-2 text-center text-lg font-bold text-red-400">
              فشل التنفيذ
            </h2>
            <p className="mb-6 rounded-lg border border-red-800 bg-red-950 p-3 text-center text-sm text-red-300">
              {errorMsg}
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-slate-700 py-2 text-slate-200 hover:bg-slate-600"
            >
              إغلاق
            </button>
          </>
        )}

      </div>
    </div>
  );
}
