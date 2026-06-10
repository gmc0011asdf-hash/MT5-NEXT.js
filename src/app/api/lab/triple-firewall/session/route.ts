// src/app/api/lab/triple-firewall/session/route.ts
// GET — ساعة الجلسات السوقية الحالية بتوقيت بغداد (UTC+3)
// لا تنفيذ تداول

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const res = await fetch(`${MT5_SERVICE_BASE}/api/triple-firewall/session`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false, session: null }, { status: res.status });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (err) {
    console.error("[triple-firewall/session]", err);
    return NextResponse.json({ ok: false, session: null }, { status: 503 });
  }
}
