// src/lib/triple-firewall/types.ts
// أنواع بيانات واجهة "الجدار الثلاثي" (Triple Firewall) — تطابق استجابات
// /api/triple-firewall/* في خدمة MT5 المحلية. لا تنفيذ تداول.

export type FirewallConfluenceLevel = "STRONG" | "MEDIUM" | "WEAK" | "NONE";

export interface FirewallStatus {
  trend: boolean | null;
  volatility: boolean | null;
  momentum: boolean | null;
}

export interface TripleFirewallSignal {
  id: number;
  symbol: string;
  direction: "BUY" | "SELL" | null;
  approved: boolean;
  signalStrength: number;
  confluenceLevel: FirewallConfluenceLevel | null;
  alignedCount: number | null;
  firewalls: FirewallStatus;
  sl: number | null;
  tp: number | null;
  atr: number | null;
  rr: number | null;
  sessionLabel: string | null;
  baghdadHour: number | null;
  timestamp: string | null;
}

export interface MarketSession {
  utc_time: string;
  baghdad_hour: number;
  active_sessions: string[];
  is_overlap: boolean;
  label_ar: string;
}

export interface PositionSizeRequest {
  accountEquity: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  tradeTickValue: number;
  tradeTickSize: number;
  point: number;
  volumeMin?: number;
  volumeMax?: number;
  volumeStep?: number;
}

export interface PositionSizeResult {
  ok: boolean;
  raw_lot: number;
  normalized_lot: number;
  risk_usd: number;
  sl_dist_points?: number;
  warnings: string[];
}
