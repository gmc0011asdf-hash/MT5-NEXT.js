import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const LOCAL_CONNECTION_STATUS_URL = `${MT5_SERVICE_BASE}/connection-status`;
const FETCH_TIMEOUT_MS = 8000;

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LOCAL_CONNECTION_STATUS_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const payload = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(payload, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        connected: false,
        account_login: null,
        server: null,
        company: null,
        name: null,
        balance: null,
        equity: null,
        free_margin: null,
        currency: null,
        leverage: null,
        read_only: true,
        error: "خدمة MT5 المحلية غير متاحة",
      },
      { status: 503 },
    );
  }
}
