// src/app/api/lab/gold-pro/save-snapshot/route.ts
// POST — يحفظ snapshot التحليل محلياً عبر خدمة MT5 (SQLite)
// لا تنفيذ تداول

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const res = await fetch(`${MT5_SERVICE_BASE}/api/gold-pro/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ error: "فشل الحفظ" }, { status: res.status });
    }

    const result = await res.json();
    return NextResponse.json({ success: true, id: result.id });
  } catch (err) {
    console.error("[gold-pro/save-snapshot]", err);
    return NextResponse.json({ error: "فشل الحفظ — تأكد من تشغيل خدمة MT5 المحلية" }, { status: 503 });
  }
}
