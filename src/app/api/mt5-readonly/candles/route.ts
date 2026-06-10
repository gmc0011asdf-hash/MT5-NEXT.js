/**
 * Read-only local MT5 proxy for candles.
 * Proxies GET http://127.0.0.1:8010/readonly/candles for same-origin browser fetch.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const LOCAL_BASE = `${MT5_SERVICE_BASE}/readonly/candles`;
const FETCH_TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;

  const u = new URL(LOCAL_BASE);
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
    const pythonBody = (await res.json()) as Record<string, unknown>;

    return NextResponse.json(
      {
        ...pythonBody,
        source: pythonBody.source ?? "mt5-local-readonly-candles",
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
        candles: [],
        error: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
      },
      { status: 503 },
    );
  }
}
