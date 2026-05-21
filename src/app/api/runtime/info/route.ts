/**
 * /api/runtime/info — Local Runtime Diagnostics v1
 * Returns safe-to-expose runtime configuration (no secrets).
 * Used by Local Runtime Diagnostics panel in /system-health.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE      = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const EXECUTION_ENABLED     = process.env.MT5_DEMO_EXECUTION_ENABLED === "true";
const FETCH_TIMEOUT_MS      = 5_000;

export async function GET(): Promise<NextResponse> {
  // Try Python Bridge health — best-effort
  let pythonHealth: "ok" | "unreachable" | "error" = "unreachable";
  let mt5Connected = false;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res  = await fetch(`${MT5_SERVICE_BASE}/health`, {
      signal:  controller.signal,
      cache:   "no-store",
    });
    clearTimeout(timeoutId);
    const data = (await res.json()) as Record<string, unknown>;
    pythonHealth = res.ok ? "ok" : "error";
    mt5Connected = data.mt5_connected === true;
  } catch {
    clearTimeout(timeoutId);
    pythonHealth = "unreachable";
  }

  return NextResponse.json({
    mt5ServiceUrl:      MT5_SERVICE_BASE,
    executionEnabled:   EXECUTION_ENABLED,
    pythonHealth,
    mt5Connected,
    timestamp:          Date.now(),
  });
}
