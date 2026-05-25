// src/app/api/lab/gold-pro/analysis/route.ts
// GET /api/lab/gold-pro/analysis
// يجلب candles + ticks من MT5 Bridge ويرجعها للعميل
// لا تنفيذ تداول — Read-only

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const BRIDGE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function GET() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ── جلب البيانات بالتوازي ─────────────────────────────────────────────
    const [snapshotRes, h1Res, h4Res, d1Res, m15Res] = await Promise.all([
      fetch(`${BRIDGE}/readonly/snapshot?symbol=XAUUSD`, { cache: "no-store" }),
      fetch(`${BRIDGE}/readonly/candles?symbol=XAUUSD&timeframe=H1&count=100`, { cache: "no-store" }),
      fetch(`${BRIDGE}/readonly/candles?symbol=XAUUSD&timeframe=H4&count=50`, { cache: "no-store" }),
      fetch(`${BRIDGE}/readonly/candles?symbol=XAUUSD&timeframe=D1&count=30`, { cache: "no-store" }),
      fetch(`${BRIDGE}/readonly/candles?symbol=XAUUSD&timeframe=M15&count=60`, { cache: "no-store" }),
    ]);

    if (!snapshotRes.ok || !h1Res.ok) {
      return NextResponse.json({ error: "MT5 Bridge غير متصل" }, { status: 503 });
    }

    const [snapshot, h1Data, h4Data, d1Data, m15Data] = await Promise.all([
      snapshotRes.json(),
      h1Res.json(),
      h4Res.json(),
      d1Res.json(),
      m15Res.json(),
    ]);

    // ── استخراج XAUUSD فقط من البيانات ──────────────────────────────────
    const xauTick = snapshot.ticks?.find((t: { symbol: string }) => t.symbol === "XAUUSD");
    const filterXAU = (candles: Array<{ symbol: string; timeframe: string }>) =>
      candles.filter(c => c.symbol === "XAUUSD");

    return NextResponse.json({
      connected: snapshot.connected ?? false,
      tick: xauTick ?? null,
      account: snapshot.account ?? null,
      candlesH1: filterXAU(h1Data.candles ?? []),
      candlesH4: filterXAU(h4Data.candles ?? []),
      candlesD1: filterXAU(d1Data.candles ?? []),
      candlesM15: filterXAU(m15Data.candles ?? []),
      fetchedAt: Date.now(),
    });
  } catch (err) {
    console.error("[gold-pro/analysis]", err);
    return NextResponse.json({ error: "خطأ في الاتصال بـ MT5 Bridge" }, { status: 503 });
  }
}
