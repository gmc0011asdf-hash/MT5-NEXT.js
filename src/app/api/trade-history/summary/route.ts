/**
 * Read-only proxy for trade-history summary stats (recommendation-accuracy
 * informational metrics -- not financial advice).
 * Proxies GET http://127.0.0.1:8010/api/trade-history/summary
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const u = new URL(`${MT5_SERVICE_BASE}/api/trade-history/summary`);
  for (const key of ["days", "source"] as const) {
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
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        ok: false,
        days: 30,
        totalTrades: 0,
        matchedTrades: 0,
        unmatchedTrades: 0,
        overallWinRatePct: null,
        matchedWinRatePct: null,
        unmatchedWinRatePct: null,
        netProfit: 0,
        error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها",
      },
      { status: 503 },
    );
  }
}
