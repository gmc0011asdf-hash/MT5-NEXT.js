"use client";

import { useEffect, useState } from "react";

import {
  ActivityMicroBar,
  PulseDot,
  StatusBadge,
  type StatusBadgeVariant,
} from "@/components/common/status-indicator";
import { AnalogMarketClock } from "@/components/dashboard/AnalogMarketClock";
import { MARKET_SESSIONS, type MarketSession } from "@/lib/constants/market-sessions";
import { formatTimeString12h, getSessionStatus } from "@/lib/market-session-time";
import { cn } from "@/lib/utils";

// --- helpers -----------------------------------------------------------------

function toneToBadge(tone: "ok" | "warning" | "danger" | "neutral"): StatusBadgeVariant {
  return tone;
}

function toneToPulse(
  tone: "ok" | "warning" | "danger" | "neutral",
): "ok" | "warning" | "danger" | "neutral" | "mock" {
  return tone;
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

const TIME_PLACEHOLDER = "--:--:--";

function formatBaghdadTime(date: Date | null): string {
  if (!date) return TIME_PLACEHOLDER;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function formatSessionTime12(date: Date | null, timeZone: string): string {
  if (!date) return TIME_PLACEHOLDER;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

// --- accent strip per tone ----------------------------------------------------

function stripClass(tone: "ok" | "warning" | "danger" | "neutral"): string {
  if (tone === "ok")      return "from-emerald-500/70 via-emerald-500/20 to-transparent";
  if (tone === "warning") return "from-amber-400/70  via-amber-400/20  to-transparent";
  if (tone === "danger")  return "from-rose-500/70   via-rose-500/20   to-transparent";
  return "from-amber-500/20 via-amber-500/5 to-transparent";
}

// --- SessionCard -------------------------------------------------------------

function SessionCard({ session, at }: { session: MarketSession; at: Date | null }) {
  const stableDate = at ?? new Date("1970-01-01T00:00:00Z");
  const st        = getSessionStatus(session, stableDate);
  const tzShort   = shortTz(session, stableDate);
  const localTime = formatSessionTime12(at, session.timezone);
  const baghdad   = formatBaghdadTime(at);

  const hoursLine =
    session.type === "market" && session.openTime && session.closeTime
      ? `${formatTimeString12h(session.openTime)} – ${formatTimeString12h(session.closeTime)}`
      : null;

  const eta =
    st.minutesToOpen != null && st.minutesToOpen > 0 && st.minutesToOpen <= 180
      ? `يفتح بعد ${st.minutesToOpen} د`
      : st.minutesToClose != null &&
          st.minutesToClose > 0 &&
          (st.labelAr === "يغلق قريبًا" || st.minutesToClose <= 120)
        ? `يغلق بعد ${st.minutesToClose} د`
        : null;

  const hasProgress =
    st.progress != null && session.type === "market" && st.isOpen;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl",
        "border border-amber-500/15",
        "bg-gradient-to-b from-card to-amber-500/[0.025]",
        "transition-all duration-200 hover:border-amber-500/25 hover:shadow-lg hover:shadow-amber-500/[0.06]",
      )}
    >
      {/* -- Status accent strip ------------------------------------------- */}
      <div className={cn("h-[2px] w-full bg-gradient-to-r", stripClass(st.tone))} />

      <div className="flex flex-1 flex-col items-center gap-0 px-3 pb-3 pt-2.5">

        {/* -- City name ------------------------------------------------- */}
        <p className="mb-2 text-center text-[11px] font-bold tracking-widest text-amber-200/75 uppercase">
          {session.nameAr}
        </p>

        {/* -- Analog clock ---------------------------------------------- */}
        <div className="mb-2 flex items-center justify-center">
          <AnalogMarketClock session={session} at={stableDate} size={72} tone={st.tone} />
        </div>

        {/* -- Digital time ---------------------------------------------- */}
        <p className="font-mono text-sm tabular-nums text-amber-100/95 leading-none">
          {at ? localTime : TIME_PLACEHOLDER}
        </p>

        {/* -- Timezone abbr --------------------------------------------- */}
        <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/55">{tzShort}</p>

        {/* -- Divider --------------------------------------------------- */}
        <div className="my-2.5 h-px w-full bg-amber-500/10" />

        {/* -- Status + Activity ----------------------------------------- */}
        <div className="flex w-full items-center justify-between gap-1">
          <StatusBadge
            variant={toneToBadge(st.tone)}
            icon={<PulseDot tone={toneToPulse(st.tone)} pulse={st.isOpen} />}
          >
            {st.labelAr}
          </StatusBadge>
          {session.type === "market" ? (
            <ActivityMicroBar active={st.isOpen} />
          ) : null}
        </div>

        {/* -- Progress bar ---------------------------------------------- */}
        {hasProgress ? (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted/40">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500/30 to-emerald-400/80 transition-[width] duration-500"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, st.progress ?? 0)) * 100)}%` }}
            />
          </div>
        ) : null}

        {/* -- Hours + ETA ----------------------------------------------- */}
        {(hoursLine || eta) ? (
          <div className="mt-2 flex w-full items-center justify-between gap-1">
            {hoursLine ? (
              <span className="text-[10px] text-muted-foreground/60">{hoursLine}</span>
            ) : <span />}
            {eta ? (
              <span className="text-[10px] font-medium text-amber-300/80">{eta}</span>
            ) : null}
          </div>
        ) : null}

        {/* -- Baghdad footer -------------------------------------------- */}
        <div className="mt-auto flex w-full items-center justify-between border-t border-amber-500/8 pt-2">
          <span className="text-[10px] text-muted-foreground/45">بغداد</span>
          <span className="font-mono text-[10px] tabular-nums text-amber-100/55">{baghdad}</span>
        </div>

      </div>
    </div>
  );
}

// --- MarketSessionsPanel ------------------------------------------------------

export function MarketSessionsPanel() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="space-y-3" suppressHydrationWarning>
      <div className="space-y-0.5">
        <h3 className="page-title">ساعات افتتاح الأسواق</h3>
        <p className="label-secondary">
          متابعة جلسات التداول العالمية حسب التوقيت المحلي لكل سوق
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {MARKET_SESSIONS.map((session) => (
          <SessionCard key={session.id} session={session} at={now} />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
        الأوقات مرجعية — قد تختلف في العطل الرسمية أو تغيّر التوقيت الصيفي. هذه الساعات للمتابعة فقط ولا تنفذ أي أوامر تداول.
      </p>
    </section>
  );
}
