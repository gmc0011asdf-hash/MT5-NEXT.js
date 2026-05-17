"use client";

import { Wifi } from "lucide-react";

import { ActivityMicroBar, PulseDot, StatusBadge } from "@/components/common/status-indicator";
import { cn } from "@/lib/utils";

type MarketPulseIndicatorProps = {
  /** When true, shows mock-live vitality (no real broker feed). */
  mockLive?: boolean;
  className?: string;
};

export function MarketPulseIndicator({ mockLive = true, className }: MarketPulseIndicatorProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <StatusBadge
        variant={mockLive ? "mock" : "ok"}
        icon={<PulseDot tone={mockLive ? "mock" : "ok"} pulse className="ms-0.5" />}
      >
        <span className="inline-flex items-center gap-1">
          <Wifi className="size-3 opacity-90" aria-hidden />
          {mockLive ? "تيار وهمي" : "مراقبة"}
        </span>
      </StatusBadge>
      <div className="mt-1 flex items-center gap-2">
        <ActivityMicroBar active={mockLive} />
        <span className="text-muted-foreground text-[10px] leading-tight">نشاط واجهة</span>
      </div>
    </div>
  );
}
