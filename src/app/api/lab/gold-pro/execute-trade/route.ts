// src/app/api/lab/gold-pro/execute-trade/route.ts
// POST — Clerk auth → proxy to port 8011 → log to Convex
// حد صارم ثانٍ على حجم الصفقة (MAX_LOT=0.10) إضافةً لحماية Python

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";

const EXEC = process.env.MT5_EXECUTION_URL ?? "http://127.0.0.1:8011";
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const MAX_LOT = 0.10; // hard cap — لا تغيير

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    symbol: string;
    order_type: "BUY" | "SELL";
    lot: number;
    sl: number;
    tp: number;
    comment?: string;
    confluenceScore?: number;
    setupLabel?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const { symbol, order_type, lot, sl, tp, comment, confluenceScore, setupLabel } = body;

  if (!symbol || !order_type || !lot || !sl || !tp) {
    return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  }

  // Hard lot cap (second layer after Python service)
  const safeLot = Math.min(parseFloat(String(lot)), MAX_LOT);

  try {
    const execRes = await fetch(`${EXEC}/execute/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        order_type,
        lot: safeLot,
        sl,
        tp,
        comment: comment ?? "GoldProLab",
      }),
    });

    if (!execRes.ok) {
      const err = await execRes.json().catch(() => ({ detail: "خطأ غير معروف" }));
      return NextResponse.json(
        { error: err.detail ?? "فشل التنفيذ" },
        { status: execRes.status },
      );
    }

    const result = await execRes.json();

    // Log to Convex audit trail (non-blocking — لا نوقف العملية إذا فشل Convex)
    try {
      await convex.mutation(api.tradeExecutions.logExecution, {
        userId,
        symbol,
        orderType: order_type,
        lot: safeLot,
        entryPrice: result.price,
        sl,
        tp,
        ticket: result.ticket,
        confluenceScore: confluenceScore ?? 0,
        setupLabel: setupLabel ?? "Manual",
      });
    } catch (convexErr) {
      console.error("[execute-trade] Convex log failed:", convexErr);
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[execute-trade]", err);
    return NextResponse.json(
      { error: "خطأ في الاتصال بخدمة التنفيذ — تأكد من تشغيل mt5_execution_service" },
      { status: 503 },
    );
  }
}
