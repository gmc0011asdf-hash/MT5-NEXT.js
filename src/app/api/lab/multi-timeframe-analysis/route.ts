/**
 * Read-only proxy for multi-timeframe analysis of a single symbol.
 * Proxies POST http://127.0.0.1:8010/api/lab/multi-timeframe-analysis
 * No trading execution.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 20000;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const body = await req.json();
    const res = await fetch(`${MT5_SERVICE_BASE}/api/lab/multi-timeframe-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { ok: false, error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
