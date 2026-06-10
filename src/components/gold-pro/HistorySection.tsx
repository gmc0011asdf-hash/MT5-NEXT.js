// src/components/gold-pro/HistorySection.tsx
// Component معزول — يقرأ تاريخ التحليلات من الخدمة المحلية (SQLite)
"use client";

import { useQuery } from "@tanstack/react-query";
import { AnalysisHistory } from "./AnalysisHistory";

const EMPTY_STATS = { total: 0, wins: 0, losses: 0, pending: 0, accuracy: 0 };

export function HistorySection() {
  const { data: history } = useQuery({
    queryKey: ["gold-pro-snapshots"],
    queryFn: async () => {
      const res = await fetch("/api/lab/gold-pro/snapshots");
      if (!res.ok) return [];
      const json = await res.json();
      return json.history ?? [];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["gold-pro-accuracy-stats"],
    queryFn: async () => {
      const res = await fetch("/api/lab/gold-pro/accuracy-stats");
      if (!res.ok) return EMPTY_STATS;
      const json = await res.json();
      return json.stats ?? EMPTY_STATS;
    },
  });

  return (
    <AnalysisHistory
      history={history ?? []}
      stats={stats ?? EMPTY_STATS}
    />
  );
}
