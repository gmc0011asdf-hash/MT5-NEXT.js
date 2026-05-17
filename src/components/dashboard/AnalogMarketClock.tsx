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

  const majorTickAngles = [0, 90, 180, 270].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const x1 = c + (r - 4) * Math.cos(rad);
    const y1 = c + (r - 4) * Math.sin(rad);
    const x2 = c + r * Math.cos(rad);
    const y2 = c + r * Math.sin(rad);
    return { x1, y1, x2, y2, key: deg };
  });
  const minorTickAngles = Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const x1 = c + (r - 2.5) * Math.cos(rad);
    const y1 = c + (r - 2.5) * Math.sin(rad);
    const x2 = c + (r - 6.5) * Math.cos(rad);
    const y2 = c + (r - 6.5) * Math.sin(rad);
    return { x1, y1, x2, y2, key: deg };
  });
  const hourMarks = [
    { n: "12", deg: 0 },
    { n: "3", deg: 90 },
    { n: "6", deg: 180 },
    { n: "9", deg: 270 },
  ].map((item) => {
    const rad = ((item.deg - 90) * Math.PI) / 180;
    const x = c + (r - 13) * Math.cos(rad);
    const y = c + (r - 13) * Math.sin(rad);
    return { ...item, x, y };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(
        "shrink-0 rounded-full border border-amber-400/30 bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.08),rgba(7,7,7,0.92))] ring-2",
        ring,
      )}
      aria-hidden
    >
      <circle cx={c} cy={c} r={r + 1} fill="none" stroke="oklch(0.76 0.1 78 / 0.65)" strokeWidth={size * 0.012} />
      {minorTickAngles.map((t) => (
        <line
          key={`m-${t.key}`}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="oklch(0.78 0.1 78 / 0.55)"
          strokeWidth={size * 0.009}
          strokeLinecap="round"
        />
      ))}
      {majorTickAngles.map((t) => (
        <line
          key={`M-${t.key}`}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="oklch(0.84 0.08 85 / 0.8)"
          strokeWidth={size * 0.016}
          strokeLinecap="round"
        />
      ))}
      {hourMarks.map((mark) => (
        <text
          key={mark.n}
          x={mark.x}
          y={mark.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill="oklch(0.9 0.04 88)"
          fontSize={size * 0.11}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
        >
          {mark.n}
        </text>
      ))}
      <line
        x1={c}
        y1={c}
        x2={c + Math.cos((h * Math.PI) / 180) * (size * 0.2)}
        y2={c + Math.sin((h * Math.PI) / 180) * (size * 0.2)}
        stroke="oklch(0.94 0.02 95)"
        strokeWidth={size * 0.04}
        strokeLinecap="round"
      />
      <line
        x1={c}
        y1={c}
        x2={c + Math.cos((m * Math.PI) / 180) * (size * 0.3)}
        y2={c + Math.sin((m * Math.PI) / 180) * (size * 0.3)}
        stroke="oklch(0.9 0.05 85)"
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
      <circle cx={c} cy={c} r={size * 0.05} fill="oklch(0.23 0.02 82)" stroke="oklch(0.85 0.06 84 / 0.7)" strokeWidth={size * 0.008} />
    </svg>
  );
}
