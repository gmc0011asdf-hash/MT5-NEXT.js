/**
 * Simulated Crypto Journal — win-rate stats over simulated positions.
 * Read-only. Proxies http://127.0.0.1:8010/api/journal/simulated-positions/stats
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

const EMPTY_STATS = { total: 0, wins: 0, losses: 0, open: 0, closedManual: 0, winRate: 0 };

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const u = new URL(`${MT5_SERVICE_BASE}/api/journal/simulated-positions/stats`);
  const source = sp.get("source");
  if (source) u.searchParams.set("source", source);

  try {
    const res = await fetch(u.toString(), { cache: "no-store" });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    console.error("[journal/simulated-positions/stats]", err);
    return NextResponse.json({ ok: false, stats: EMPTY_STATS }, { status: 503 });
  }
}
