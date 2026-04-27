import type { MarketSession } from "@/lib/constants/market-sessions";
import { getTimePartsForZone } from "@/lib/market-session-time";

import { cn } from "@/lib/utils";

type AnalogMarketClockProps = {
  session: MarketSession;
  at: Date;
  size?: number;
  tone?: "ok" | "warning" | "danger" | "neutral";
};

function handAngles(hour: number, minute: number, second: number) {
  const h = ((hour % 12) + minute / 60 + second / 3600) * 30 - 90;
  const m = (minute + second / 60) * 6 - 90;
  const s = second * 6 - 90;
  return { h, m, s };
}

export function AnalogMarketClock({ session, at, size = 112, tone = "neutral" }: AnalogMarketClockProps) {
  const ring =
    tone === "ok"
      ? "shadow-[0_0_20px_rgba(16,185,129,0.15)] ring-emerald-500/30"
      : tone === "warning"
        ? "shadow-[0_0_18px_rgba(245,158,11,0.12)] ring-amber-500/35"
        : tone === "danger"
          ? "shadow-[0_0_18px_rgba(244,63,94,0.12)] ring-rose-500/30"
          : "ring-amber-500/20";

  const parts = getTimePartsForZone(session.timezone, at);
  const { h, m, s } = handAngles(parts.hour, parts.minute, parts.second);
  const c = size / 2;
  const r = size * 0.38;

  const tickAngles = [0, 90, 180, 270].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const x1 = c + (r - 4) * Math.cos(rad);
    const y1 = c + (r - 4) * Math.sin(rad);
    const x2 = c + r * Math.cos(rad);
    const y2 = c + r * Math.sin(rad);
    return { x1, y1, x2, y2, key: deg };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 rounded-full border border-amber-500/25 bg-gradient-to-br from-card to-amber-500/[0.06] ring-2", ring)}
      aria-hidden
    >
      {tickAngles.map((t) => (
        <line
          key={t.key}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="oklch(0.75 0.1 78 / 0.55)"
          strokeWidth={size * 0.012}
          strokeLinecap="round"
        />
      ))}
      <line
        x1={c}
        y1={c}
        x2={c + Math.cos((h * Math.PI) / 180) * (size * 0.2)}
        y2={c + Math.sin((h * Math.PI) / 180) * (size * 0.2)}
        stroke="oklch(0.92 0.02 95)"
        strokeWidth={size * 0.045}
        strokeLinecap="round"
      />
      <line
        x1={c}
        y1={c}
        x2={c + Math.cos((m * Math.PI) / 180) * (size * 0.3)}
        y2={c + Math.sin((m * Math.PI) / 180) * (size * 0.3)}
        stroke="oklch(0.88 0.04 85)"
        strokeWidth={size * 0.028}
        strokeLinecap="round"
      />
      <line
        x1={c}
        y1={c}
        x2={c + Math.cos((s * Math.PI) / 180) * (size * 0.34)}
        y2={c + Math.sin((s * Math.PI) / 180) * (size * 0.34)}
        stroke="oklch(0.72 0.14 75)"
        strokeWidth={size * 0.012}
        strokeLinecap="round"
        opacity={0.95}
      />
      <circle cx={c} cy={c} r={size * 0.04} fill="oklch(0.25 0.03 82)" />
    </svg>
  );
}
