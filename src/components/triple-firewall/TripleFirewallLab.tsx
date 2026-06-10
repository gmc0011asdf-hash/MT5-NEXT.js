// src/components/triple-firewall/TripleFirewallLab.tsx
// مختبر "الجدار الثلاثي" — تحليل معلوماتي مؤسسي (Trend EMA200 + BB Volatility + RSI Momentum)
"use client";

import { SessionClock } from "./SessionClock";
import { SignalsHistory } from "./SignalsHistory";
import { PositionSizeCalculator } from "./PositionSizeCalculator";

export function TripleFirewallLab() {
  return (
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-bold text-amber-400">🛡️ مختبر الجدار الثلاثي</h1>
        <p className="text-xs text-slate-400">
          تحليل توافق ثلاثة مرشحات (الاتجاه EMA200 + التذبذب Bollinger Bands + الزخم RSI) — للأغراض التحليلية المعلوماتية فقط
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SessionClock />
        <PositionSizeCalculator />
      </div>

      <SignalsHistory />

      <p className="text-center text-xs text-slate-600">
        ⚠️ للأغراض التحليلية المعلوماتية فقط — ليس توصية مالية — نظام الملك الهندسي للتداول العالمي
      </p>
    </div>
  );
}
