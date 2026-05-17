/**
 * Read-only local MT5 proxy. No trading operations.
 * Proxies GET http://127.0.0.1:8010/readonly/history-deals (closed deals read) for same-origin fetch.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const LOCAL_BASE = `${MT5_SERVICE_BASE}/readonly/history-deals`;
const FETCH_TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const days = sp.get("days") ?? "30";
  const symbol = sp.get("symbol");

  const u = new URL(LOCAL_BASE);
  u.searchParams.set("days", days);
  if (symbol) u.searchParams.set("symbol", symbol);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        {
          connected: false,
          read_only_mode: true,
          deals: [] as const,
          error: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
        },
        { status: 503 },
      );
    }

    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(body);
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        connected: false,
        read_only_mode: true,
        deals: [] as const,
        error: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
      },
      { status: 503 },
    );
  }
}
