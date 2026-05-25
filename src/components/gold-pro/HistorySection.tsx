// src/components/gold-pro/HistorySection.tsx
// Component معزول — يحتوي على useQuery حتى لا يُسقط GoldProLab عند فشل Convex
"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { AnalysisHistory } from "./AnalysisHistory";

const EMPTY_STATS = { total: 0, wins: 0, losses: 0, pending: 0, accuracy: 0 };

export function HistorySection() {
  const history = useQuery(api.goldProAnalysis.getMyAnalyses);
  const stats   = useQuery(api.goldProAnalysis.getAccuracyStats);

  return (
    <AnalysisHistory
      history={history ?? []}
      stats={stats ?? EMPTY_STATS}
    />
  );
}
