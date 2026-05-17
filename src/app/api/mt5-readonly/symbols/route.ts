/**
 * Read-only local MT5 proxy. No trading operations.
 * Proxies GET http://127.0.0.1:8010/readonly/symbols (symbol catalog) for same-origin browser fetch.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const LOCAL_BASE = `${MT5_SERVICE_BASE}/readonly/symbols`;
const FETCH_TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const u = new URL(LOCAL_BASE);
  const sp = request.nextUrl.searchParams;
  u.searchParams.set("visibleOnly", sp.get("visibleOnly") ?? "true");
  for (const key of ["visibleOnly", "limit", "search"] as const) {
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
    return NextResponse.json({
      ...body,
      source: body.source ?? "mt5-market-watch-visible",
      visible_only: body.visible_only ?? true,
      note: "Visible MT5 Market Watch symbols only (read-only).",
    });
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
