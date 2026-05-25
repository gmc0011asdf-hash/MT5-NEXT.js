// src/app/api/lab/gold-pro/positions/route.ts
// GET — يجلب المراكز المفتوحة من خدمة التنفيذ
// يُعيد مصفوفة فارغة إذا كانت الخدمة غير متاحة (graceful)

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const EXEC = process.env.MT5_EXECUTION_URL ?? "http://127.0.0.1:8011";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(`${EXEC}/execute/positions`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ positions: [], connected: false });
    }
    return NextResponse.json(await res.json());
  } catch {
    // خدمة التنفيذ غير متصلة — ليس خطأ قاتلاً
    return NextResponse.json({ positions: [], connected: false });
  }
}
