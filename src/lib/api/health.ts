import { readOnlyGetJsonSafe } from "@/lib/api/client";
import type { ApiResult } from "@/lib/api/client";
import type { HealthResponse } from "@/lib/types/monitoring-api";

/** GET /api/health — read-only; optional use for checks. */
export function fetchHealth(): Promise<ApiResult<HealthResponse>> {
  return readOnlyGetJsonSafe<HealthResponse>("/api/health");
}
