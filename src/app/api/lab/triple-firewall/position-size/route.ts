// src/app/api/lab/triple-firewall/position-size/route.ts
// POST — حساب حجم اللوت بناءً على نسبة المخاطرة من رأس المال (ATR-based SL)
// لا تنفيذ تداول

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const res = await fetch(`${MT5_SERVICE_BASE}/api/triple-firewall/position-size`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const json = await res.json();
    if (!res.ok) return NextResponse.json(json, { status: res.status });
    return NextResponse.json(json);
  } catch (err) {
    console.error("[triple-firewall/position-size]", err);
    return NextResponse.json({ ok: false, error: "تعذر الاتصال بخدمة MT5 المحلية" }, { status: 503 });
  }
}
