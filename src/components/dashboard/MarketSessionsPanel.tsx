"use client";

import { useEffect, useState } from "react";

import { ActivityMicroBar, PulseDot, StatusBadge, type StatusBadgeVariant } from "@/components/common/status-indicator";
import { AnalogMarketClock } from "@/components/dashboard/AnalogMarketClock";
import { Card } from "@/components/ui/card";
import { MARKET_SESSIONS, type MarketSession } from "@/lib/constants/market-sessions";
import { formatTimeString12h, getSessionStatus } from "@/lib/market-session-time";
import { institutionalCardClass } from "@/lib/ui-institutional";

function toneToBadge(tone: "ok" | "warning" | "danger" | "neutral"): StatusBadgeVariant {
  return tone;
}

function toneToPulse(tone: "ok" | "warning" | "danger" | "neutral"): "ok" | "warning" | "danger" | "neutral" | "mock" {
  if (tone === "ok") return "ok";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "danger";
  return "neutral";
}

function shortTz(session: MarketSession, date: Date): string {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: session.timezone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  return name ?? session.timezone;
}

function SessionCard({ session, at }: { session: MarketSession; at: Date }) {
  const st = getSessionStatus(session, at);
  const tzShort = shortTz(session, at);
  const hoursLine =
    session.type === "market" && session.openTime && session.closeTime
      ? `${formatTimeString12h(session.openTime)} – ${formatTimeString12h(session.closeTime)} (محلي)`
      : null;

  const eta =
    st.minutesToOpen != null && st.minutesToOpen > 0 && st.minutesToOpen <= 180
      ? `يفتح بعد ${st.minutesToOpen} دقيقة`
      : st.minutesToClose != null &&
          st.minutesToClose > 0 &&
          (st.labelAr === "يغلق قريبًا" || st.minutesToClose <= 120)
        ? `يغلق بعد ${st.minutesToClose} دقيقة`
        : null;

  return (
    <Card
      className={institutionalCardClass(
        "flex flex-col gap-3 p-4 transition-shadow hover:shadow-md/10",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <AnalogMarketClock session={session} at={at} size={104} tone={st.tone} />
        <div className="min-w-0 flex-1 space-y-1 text-end">
          <p className="font-semibold text-base text-foreground leading-tight md:text-lg">{session.nameAr}</p>
          <p className="text-muted-foreground text-[11px] tracking-wide">{session.nameEn}</p>
          <p className="font-mono text-amber-100/90 text-xs tabular-nums sm:text-sm">{st.localTimeLabel}</p>
          <p className="text-muted-foreground text-[10px] tabular-nums">{tzShort}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/10 pt-2">
        <StatusBadge variant={toneToBadge(st.tone)} icon={<PulseDot tone={toneToPulse(st.tone)} pulse={st.isOpen} />}>
          {st.labelAr}
        </StatusBadge>
        {session.type === "market" ? <ActivityMicroBar active={st.isOpen} /> : null}
      </div>
      {hoursLine ? (
        <p className="text-muted-foreground text-[11px] leading-snug">ساعات الجلسة: {hoursLine}</p>
      ) : null}
      {st.progress != null && session.type === "market" && st.isOpen ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
          <div
            className="h-full rounded-full bg-gradient-to-l from-emerald-500/70 to-emerald-400/40 transition-[width] duration-500"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, st.progress)) * 100)}%` }}
          />
        </div>
      ) : null}
      {eta ? <p className="text-amber-200/90 text-[11px]">{eta}</p> : null}
      <p className="line-clamp-2 text-muted-foreground text-[10px] leading-snug">{st.localDateLabel}</p>
    </Card>
  );
}

export function MarketSessionsPanel() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="space-y-4" suppressHydrationWarning>
      <div className="space-y-1">
        <h3 className="page-title">ساعات افتتاح الأسواق</h3>
        <p className="label-secondary">متابعة جلسات التداول العالمية حسب التوقيت المحلي لكل سوق</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {MARKET_SESSIONS.map((session) => (
          <SessionCard key={session.id} session={session} at={now} />
        ))}
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        الأوقات مرجعية حسب المنطقة الزمنية وقد تختلف في العطل الرسمية أو تغيّر التوقيت الصيفي.
      </p>
      <p className="text-muted-foreground text-[11px] leading-relaxed">
        هذه الساعات للمتابعة فقط ولا تنفذ أي أوامر تداول.
      </p>
    </section>
  );
}
