import { readOnlyGetJsonSafe } from "@/lib/api/client";
import type { ApiResult } from "@/lib/api/client";
import type { MonitoringStatusResponse } from "@/lib/types/monitoring-api";

/** GET /api/monitoring/status — read-only snapshot. */
export function fetchMonitoringStatus(): Promise<ApiResult<MonitoringStatusResponse>> {
  return readOnlyGetJsonSafe<MonitoringStatusResponse>("/api/monitoring/status");
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Minimal runtime guard before mapping to UI rows. */
export function isMonitoringStatusResponse(x: unknown): x is MonitoringStatusResponse {
  if (!isObject(x)) return false;
  if (!isObject(x.backend) || typeof x.backend.status !== "string") return false;
  if (!isObject(x.mt5) || typeof x.mt5.status !== "string") return false;
  if (!isObject(x.database) || typeof x.database.status !== "string") return false;
  if (!isObject(x.governance) || typeof x.governance.decision !== "string") return false;
  if (!isObject(x.protection) || typeof x.protection.status !== "string") return false;
  if (!isObject(x.execution) || typeof x.execution.pending_execution_enabled !== "boolean") return false;
  if (!isObject(x.lab)) return false;
  if (!isObject(x.replay)) return false;
  return true;
}
