/**
 * Read-only proxy for the Gold + Crypto ranked screener.
 * Proxies GET http://127.0.0.1:8010/api/lab/ranked-candidates
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const source = request.nextUrl.searchParams.get("source");
    const u = new URL(`${MT5_SERVICE_BASE}/api/lab/ranked-candidates`);
    if (source) u.searchParams.set("source", source);

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
        candidates: [],
        error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها",
      },
      { status: 503 },
    );
  }
}
