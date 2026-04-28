/**
 * Read-only local MT5 proxy. No trading operations.
 * Proxies GET http://127.0.0.1:8010/readonly/snapshot into Next.js for browser-safe fetch (same-origin).
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const LOCAL_SNAPSHOT_URL = `${MT5_SERVICE_BASE}/readonly/snapshot`;
const FETCH_TIMEOUT_MS = 8000;

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LOCAL_SNAPSHOT_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false as const,
          connected: false as const,
          error: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
        },
        { status: 503 },
      );
    }

    const snapshot = await res.json();
    return NextResponse.json({ ok: true as const, snapshot });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        ok: false as const,
        connected: false as const,
        error: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
      },
      { status: 503 },
    );
  }
}
