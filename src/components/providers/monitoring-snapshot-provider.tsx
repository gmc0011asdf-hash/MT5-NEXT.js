"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { mapMonitoringSnapshotToRows } from "@/lib/api/monitoring-mappers";
import { fetchMonitoringStatus, isMonitoringStatusResponse } from "@/lib/api/monitoring";
import { mockMonitoringStatus } from "@/lib/constants/mock-data";
import type { MonitoringStatusResponse } from "@/lib/types/monitoring-api";
import type { MonitoringRow } from "@/lib/types/trading";

export type ReadOnlyMonitoringSnapshotState =
  | { phase: "loading"; rows: null; live: null; errorAr: null; source: null }
  | {
      phase: "live";
      rows: MonitoringRow[];
      live: MonitoringStatusResponse;
      errorAr: null;
      source: "live";
    }
  | {
      phase: "mock";
      rows: MonitoringRow[];
      live: null;
      errorAr: string | null;
      source: "mock";
    };

const MonitoringSnapshotContext = createContext<ReadOnlyMonitoringSnapshotState | null>(null);

export function MonitoringSnapshotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ReadOnlyMonitoringSnapshotState>({
    phase: "loading",
    rows: null,
    live: null,
    errorAr: null,
    source: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchMonitoringStatus();
      if (cancelled) return;
      if (res.ok && isMonitoringStatusResponse(res.data)) {
        setState({
          phase: "live",
          rows: mapMonitoringSnapshotToRows(res.data),
          live: res.data,
          errorAr: null,
          source: "live",
        });
        return;
      }
      setState({
        phase: "mock",
        rows: mockMonitoringStatus,
        live: null,
        errorAr: res.ok ? "شكل استجابة المراقبة غير متوقع من الخادم." : res.errorAr,
        source: "mock",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => state, [state]);

  return (
    <MonitoringSnapshotContext.Provider value={value}>{children}</MonitoringSnapshotContext.Provider>
  );
}

export function useReadOnlyMonitoringSnapshot(): ReadOnlyMonitoringSnapshotState {
  const ctx = useContext(MonitoringSnapshotContext);
  if (!ctx) {
    throw new Error("useReadOnlyMonitoringSnapshot must be used within MonitoringSnapshotProvider");
  }
  return ctx;
}
