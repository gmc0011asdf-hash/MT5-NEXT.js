/**
 * Read-only local MT5 proxy for candles.
 * Proxies GET http://127.0.0.1:8010/readonly/candles for same-origin browser fetch.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LOCAL_BASE = "http://127.0.0.1:8010/readonly/candles";
const FETCH_TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const u = new URL(LOCAL_BASE);
  const sp = request.nextUrl.searchParams;
  for (const key of ["symbols", "timeframes", "count"] as const) {
    const v = sp.get(key);
    if (v !== null && v !== "") u.searchParams.set(key, v);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(
      {
        ...body,
        source: body.source ?? "mt5-local-readonly-candles",
      },
      { status: res.status },
    );
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        connected: false,
        read_only_mode: true,
        source: "mt5-local-readonly-candles",
        candles: [] as const,
        error: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
      },
      { status: 503 },
    );
  }
}
