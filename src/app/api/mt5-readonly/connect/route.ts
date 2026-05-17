import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const LOCAL_CONNECT_URL = `${MT5_SERVICE_BASE}/connect`;
const FETCH_TIMEOUT_MS = 8000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { connected: false, error: "بيانات الطلب غير صالحة" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LOCAL_CONNECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const payload = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(payload, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { connected: false, error: "خدمة MT5 المحلية غير متاحة" },
      { status: 503 },
    );
  }
}
