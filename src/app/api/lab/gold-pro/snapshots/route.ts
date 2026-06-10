// src/app/api/lab/gold-pro/snapshots/route.ts
// GET — يقرأ آخر تحليلات Gold Pro Lab المحفوظة محلياً (SQLite)
// لا تنفيذ تداول

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const u = new URL(`${MT5_SERVICE_BASE}/api/gold-pro/snapshots`);
  for (const key of ["limit", "symbol"] as const) {
    const v = sp.get(key);
    if (v !== null && v !== "") u.searchParams.set(key, v);
  }

  try {
    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false, history: [] }, { status: res.status });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (err) {
    console.error("[gold-pro/snapshots]", err);
    return NextResponse.json({ ok: false, history: [] }, { status: 503 });
  }
}
