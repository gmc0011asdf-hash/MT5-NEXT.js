// src/components/triple-firewall/SessionClock.tsx
// ساعة الجلسات السوقية بتوقيت بغداد (UTC+3) — معلوماتي فقط
"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketSession } from "@/lib/triple-firewall/types";

export function SessionClock() {
  const { data: session, isLoading } = useQuery<MarketSession | null>({
    queryKey: ["triple-firewall-session"],
    queryFn: async () => {
      const res = await fetch("/api/lab/triple-firewall/session");
      if (!res.ok) return null;
      const json = await res.json();
      return json.session ?? null;
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-3 border-b border-slate-700 pb-2 text-xs uppercase tracking-widest text-slate-500">
        🕐 ساعة الجلسات السوقية (بغداد UTC+3)
      </p>
      {isLoading || !session ? (
        <p className="text-xs text-slate-500">جاري التحميل…</p>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-400">الساعة الحالية (بغداد)</span>
            <span className="text-blue-400 font-bold">{session.baghdad_hour}:00</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">الجلسة النشطة</span>
            <span className={`rounded-full px-2 py-0.5 font-bold ${session.is_overlap ? "bg-amber-950 text-amber-400" : "bg-blue-950 text-blue-400"}`}>
              {session.label_ar}
            </span>
          </div>
          {session.is_overlap && (
            <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-2 text-center text-amber-400">
              ⚡ تداخل لندن/نيويورك — أعلى سيولة متوقعة لـ XAUUSD
            </p>
          )}
          {session.active_sessions.length === 0 && (
            <p className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-center text-slate-500">
              لا توجد جلسة رئيسية نشطة حالياً
            </p>
          )}
        </div>
      )}
    </div>
  );
}
