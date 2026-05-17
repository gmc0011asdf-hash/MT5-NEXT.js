export type TradingPair = string;

export type SignalStatus =
  | "مسودة"
  | "قيد المراجعة"
  | "مؤكد"
  | "مرفوض"
  | "تجريبي";

export type LabUiPhase = "READY" | "WAITING" | "HOLD" | "BLOCKED";

export type LabSignal = {
  id: string;
  pair: TradingPair;
  verdict: string;
  probability: number;
  status: SignalStatus;
  timeframe: string;
  reason: string;
  /** UI-only phase for badges (no execution). */
  labPhase: LabUiPhase;
};

export type SystemStatus = "متصل" | "غير متصل" | "صيانة" | "تجريبي";

export type MonitoringStatus = "سليم" | "تحذير" | "خطأ" | "غير معروف";

export type MonitoringKey =
  | "backend"
  | "mt5"
  | "database"
  | "governance"
  | "protection"
  | "lifecycle";

export type MonitoringRow = {
  key: MonitoringKey;
  labelAr: string;
  status: MonitoringStatus;
  detail: string;
};

export type ReplaySummary = {
  barsParsed: number;
  lastBarTime: string | null;
  note: string;
};
