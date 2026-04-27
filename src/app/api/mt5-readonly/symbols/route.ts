/**
 * Read-only local MT5 proxy. No trading operations.
 * Proxies GET http://127.0.0.1:8010/readonly/symbols (symbol catalog) for same-origin browser fetch.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LOCAL_URL = "http://127.0.0.1:8010/readonly/symbols";
const FETCH_TIMEOUT_MS = 5000;

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LOCAL_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        {
          connected: false,
          read_only_mode: true,
          symbols: [] as const,
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
        symbols: [] as const,
        error: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
      },
      { status: 503 },
    );
  }
}
