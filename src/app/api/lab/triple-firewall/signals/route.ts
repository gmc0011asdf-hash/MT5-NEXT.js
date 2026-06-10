// src/app/api/lab/triple-firewall/signals/route.ts
// GET — يقرأ سجل تحليلات الجدار الثلاثي (Triple Firewall) محلياً (SQLite)
// لا تنفيذ تداول

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const u = new URL(`${MT5_SERVICE_BASE}/api/triple-firewall/signals`);
  for (const key of ["limit", "symbol", "confluence"] as const) {
    const v = sp.get(key);
    if (v !== null && v !== "") u.searchParams.set(key, v);
  }

  try {
    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false, signals: [] }, { status: res.status });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (err) {
    console.error("[triple-firewall/signals]", err);
    return NextResponse.json({ ok: false, signals: [] }, { status: 503 });
  }
}
