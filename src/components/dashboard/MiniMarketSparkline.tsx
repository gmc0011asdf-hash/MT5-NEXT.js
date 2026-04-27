"use client";

import { useSyncExternalStore } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

import { cn } from "@/lib/utils";

import type { MarketDirection } from "@/lib/mock-market-stream";

const STROKE_NEUTRAL = "oklch(0.7 0.1 80)";
const FILL_NEUTRAL = "oklch(0.75 0.12 75 / 0.35)";
const STROKE_UP = "#6ee7b7";
const FILL_UP = "rgba(16, 185, 129, 0.2)";
const STROKE_DOWN = "#fda4af";
const FILL_DOWN = "rgba(244, 63, 94, 0.18)";

function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

type MiniMarketSparklineProps = {
  data: number[];
  direction: MarketDirection;
  className?: string;
  height?: number;
};

export function MiniMarketSparkline({
  data,
  direction,
  className,
  height = 44,
}: MiniMarketSparklineProps) {
  const mounted = useIsClient();

  const chartData = data.map((v, i) => ({ i, v }));
  const stroke = direction === "up" ? STROKE_UP : direction === "down" ? STROKE_DOWN : STROKE_NEUTRAL;
  const fill = direction === "up" ? FILL_UP : direction === "down" ? FILL_DOWN : FILL_NEUTRAL;

  if (chartData.length < 2) {
    return <div className={cn("rounded-md bg-black/20", className)} style={{ height }} />;
  }

  if (!mounted) {
    return (
      <div
        className={cn("min-h-0 w-full min-w-0 rounded-md bg-black/20", className)}
        style={{ height, minHeight: height }}
      />
    );
  }

  return (
    <div
      className={cn("w-full min-w-[72px] min-h-0", className)}
      style={{ height, minHeight: height }}
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={height}>
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <YAxis domain={["dataMin", "dataMax"]} hide width={0} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            fill={fill}
            strokeWidth={1.25}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
