"use client";

import type { ReactNode } from "react";

import { MockMarketStreamProvider } from "@/components/providers/mock-market-stream-provider";
import { MonitoringSnapshotProvider } from "@/components/providers/monitoring-snapshot-provider";

export function DashboardExperienceProviders({ children }: { children: ReactNode }) {
  return (
    <MonitoringSnapshotProvider>
      <MockMarketStreamProvider>{children}</MockMarketStreamProvider>
    </MonitoringSnapshotProvider>
  );
}
