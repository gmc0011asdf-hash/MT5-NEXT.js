/**
 * Read-only proxy for the Telegram bot subscriber list.
 * Proxies GET http://127.0.0.1:8010/api/telegram/subscribers
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${MT5_SERVICE_BASE}/api/telegram/subscribers`, {
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
        total: 0,
        active: 0,
        blocked: 0,
        subscribers: [],
        error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها",
      },
      { status: 503 },
    );
  }
}
