"use client";

import { Card } from "@/components/ui/card";
import { MarketMoveIcon } from "@/components/common/status-indicator";
import { MiniMarketSparkline } from "@/components/dashboard/MiniMarketSparkline";
import { institutionalCardClass } from "@/lib/ui-institutional";

import type { MarketTick } from "@/lib/mock-market-stream";

function fmtPrice(symbol: string, n: number): string {
  if (symbol === "XAUUSD") return n.toFixed(2);
  if (symbol === "USDJPY") return n.toFixed(2);
  return n.toFixed(5);
}

type LiveMarketCardProps = {
  tick: MarketTick;
};

export function LiveMarketCard({ tick }: LiveMarketCardProps) {
  const { symbol, bid, ask, spread, change, changePercent, direction, history } = tick;
  const tone =
    direction === "up"
      ? "border-emerald-500/20 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
      : direction === "down"
        ? "border-rose-500/20 shadow-[0_0_0_1px_rgba(244,63,94,0.08)]"
        : "border-amber-500/15";

  return (
    <Card
      className={institutionalCardClass(
        `min-w-[140px] flex-1 shrink-0 gap-2 p-3 transition-colors ${tone}`,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-amber-100/90 text-xs tracking-wide">{symbol}</p>
          <p className="mt-1 font-semibold text-2xl text-foreground tabular-nums tracking-tight md:text-3xl">
            {fmtPrice(symbol, tick.mid)}
          </p>
        </div>
        <MarketMoveIcon direction={direction} />
      </div>
      <div
        className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums sm:text-xs"
        dir="ltr"
      >
        <span>Bid</span>
        <span className="text-end">{fmtPrice(symbol, bid)}</span>
        <span>Ask</span>
        <span className="text-end">{fmtPrice(symbol, ask)}</span>
        <span className="text-amber-200/70">Spread</span>
        <span className="text-end text-amber-100/80">{fmtPrice(symbol, spread)}</span>
      </div>
      <div
        className={`mt-1 flex items-center justify-between text-xs tabular-nums ${
          direction === "up"
            ? "text-emerald-300"
            : direction === "down"
              ? "text-rose-300"
              : "text-amber-200/80"
        }`}
      >
        <span>
          {change >= 0 ? "+" : ""}
          {fmtPrice(symbol, change)}
        </span>
        <span>
          ({changePercent >= 0 ? "+" : ""}
          {changePercent.toFixed(3)}٪)
        </span>
      </div>
      <div className="mt-2 h-11 w-full opacity-90">
        <MiniMarketSparkline data={history} direction={direction} height={44} />
      </div>
    </Card>
  );
}
