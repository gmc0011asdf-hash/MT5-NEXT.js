/**
 * Simulated Crypto Journal — manual status update for one simulated position
 * (ACTIVE -> HIT_TP / HIT_SL / CLOSED_MANUAL). Local journal bookkeeping only —
 * no trading action is performed.
 * Proxies http://127.0.0.1:8010/api/journal/simulated-positions/{id}/status
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, error: "id غير صالح" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const res = await fetch(`${MT5_SERVICE_BASE}/api/journal/simulated-positions/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    console.error("[journal/simulated-positions/[id]/status]", err);
    return NextResponse.json(
      { ok: false, error: "فشل التحديث — تأكد من تشغيل خدمة MT5 المحلية" },
      { status: 503 },
    );
  }
}
