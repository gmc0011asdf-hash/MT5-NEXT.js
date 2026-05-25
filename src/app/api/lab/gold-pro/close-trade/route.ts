// src/app/api/lab/gold-pro/close-trade/route.ts
// POST { ticket: number } — يغلق مركزاً مفتوحاً عبر خدمة التنفيذ

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const EXEC = process.env.MT5_EXECUTION_URL ?? "http://127.0.0.1:8011";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticket: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const { ticket } = body;
  if (!ticket) {
    return NextResponse.json({ error: "ticket مطلوب" }, { status: 400 });
  }

  try {
    const res = await fetch(`${EXEC}/execute/close/${ticket}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "خطأ غير معروف" }));
      return NextResponse.json(
        { error: err.detail ?? "فشل الإغلاق" },
        { status: res.status },
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[close-trade]", err);
    return NextResponse.json(
      { error: "خطأ في الاتصال بخدمة التنفيذ" },
      { status: 503 },
    );
  }
}
