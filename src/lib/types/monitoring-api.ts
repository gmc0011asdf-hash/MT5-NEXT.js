/** Shapes returned by GET /api/monitoring/status (FastAPI, read-only). */

export type MonitoringBackendBlock = {
  status: string;
  server_time_utc: string;
  version?: string | null;
};

export type MonitoringMt5Block = {
  connected?: boolean | null;
  status: string;
  account_login?: number | null;
  source: string;
};

export type MonitoringDatabaseTablesBlock = {
  decision_runs?: boolean;
  execution_guard_logs?: boolean;
  order_lifecycle_events?: boolean;
  risk_state_daily?: boolean;
  news_events?: boolean;
};

export type MonitoringDatabaseBlock = {
  status: string;
  tables?: MonitoringDatabaseTablesBlock;
};

export type MonitoringGovernanceBlock = {
  decision: string;
  kill_switch_active?: boolean | null;
  daily_trade_count?: number | null;
  daily_loss?: number | null;
  blocked_today?: number | null;
  risk_multiplier?: number | null;
  review_code?: string | null;
};

export type MonitoringProtectionBlock = {
  status: string;
  news_events_count?: number | null;
  news_today_utc?: number | null;
  high_impact_now?: number | null;
  last_news_sync?: string | null;
};

export type MonitoringExecutionBlock = {
  pending_execution_enabled: boolean;
  live_order_execution_enabled?: boolean | null;
  last_guard_events?: Record<string, unknown>[];
  last_lifecycle_events?: Record<string, unknown>[];
};

export type MonitoringLabBlock = {
  last_decisions?: Record<string, unknown>[];
};

export type MonitoringReplayBlock = {
  available?: boolean;
  endpoint?: string;
};

export type MonitoringStatusResponse = {
  backend: MonitoringBackendBlock;
  mt5: MonitoringMt5Block;
  database: MonitoringDatabaseBlock;
  governance: MonitoringGovernanceBlock;
  protection: MonitoringProtectionBlock;
  execution: MonitoringExecutionBlock;
  lab: MonitoringLabBlock;
  replay: MonitoringReplayBlock;
  warnings?: string[];
};

export type HealthResponse = {
  status: string;
  server?: string;
  mt5_connected: boolean;
  server_time_utc: string;
};
