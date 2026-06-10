// src/app/api/lab/gold-pro/accuracy-stats/route.ts
// GET — إحصاءات دقة تحليلات Gold Pro Lab المحفوظة محلياً (SQLite)
// لا تنفيذ تداول

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const EMPTY_STATS = { total: 0, wins: 0, losses: 0, pending: 0, accuracy: 0 };

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const u = new URL(`${MT5_SERVICE_BASE}/api/gold-pro/accuracy-stats`);
  const symbol = sp.get("symbol");
  if (symbol) u.searchParams.set("symbol", symbol);

  try {
    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false, stats: EMPTY_STATS }, { status: res.status });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (err) {
    console.error("[gold-pro/accuracy-stats]", err);
    return NextResponse.json({ ok: false, stats: EMPTY_STATS }, { status: 503 });
  }
}
