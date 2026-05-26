"use client";

import type { ReactNode } from "react";

import { MonitoringSnapshotProvider } from "@/components/providers/monitoring-snapshot-provider";

export function DashboardExperienceProviders({ children }: { children: ReactNode }) {
  return (
    <MonitoringSnapshotProvider>{children}</MonitoringSnapshotProvider>
  );
}
