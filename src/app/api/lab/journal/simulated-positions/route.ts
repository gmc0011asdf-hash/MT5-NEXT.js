/**
 * Simulated Crypto Journal — create / list simulated (paper) positions.
 * Local-First, analysis-only records: no order is placed, modified, or closed.
 * Proxies http://127.0.0.1:8010/api/journal/simulated-positions
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const res = await fetch(`${MT5_SERVICE_BASE}/api/journal/simulated-positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    console.error("[journal/simulated-positions:POST]", err);
    return NextResponse.json(
      { ok: false, error: "فشل الحفظ — تأكد من تشغيل خدمة MT5 المحلية" },
      { status: 503 },
    );
  }
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const u = new URL(`${MT5_SERVICE_BASE}/api/journal/simulated-positions`);
  const status = sp.get("status");
  const source = sp.get("source");
  const limit = sp.get("limit");
  if (status) u.searchParams.set("status", status);
  if (source) u.searchParams.set("source", source);
  if (limit) u.searchParams.set("limit", limit);

  try {
    const res = await fetch(u.toString(), { cache: "no-store" });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    console.error("[journal/simulated-positions:GET]", err);
    return NextResponse.json(
      { ok: false, count: 0, positions: [], error: "خدمة MT5 المحلية غير متاحة" },
      { status: 503 },
    );
  }
}
