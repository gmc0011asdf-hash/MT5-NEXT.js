/**
 * /api/mt5-readonly/positions — Read-only open positions proxy
 * Proxies GET http://127.0.0.1:8010/readonly/positions
 * Read-only — no trading operations.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE  = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS  = 8_000;

export async function GET(): Promise<NextResponse> {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${MT5_SERVICE_BASE}/readonly/positions`, {
      signal: controller.signal,
      cache:  "no-store",
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        { connected: false, positions: [], error: "خدمة MT5 المحلية غير متاحة" },
        { status: 503 },
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(data);
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { connected: false, positions: [], error: "تعذّر الاتصال بخدمة MT5 المحلية (port 8010)" },
      { status: 503 },
    );
  }
}
