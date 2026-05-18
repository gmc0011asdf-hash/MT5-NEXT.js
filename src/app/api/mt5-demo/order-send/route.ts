/**
 * /api/mt5-demo/order-send — A26.2 (MT5 Platform Execution Gate)
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxy آمن إلى خدمة MT5 المحلية: POST http://127.0.0.1:8010/demo/order-send
 *
 * ⚠️ هذا Route لا يحتوي على order_send — التنفيذ داخل خدمة Python فقط.
 * ⚠️ التنفيذ مغلق افتراضياً — يتطلب MT5_DEMO_EXECUTION_ENABLED=true في بيئة التشغيل.
 *     [legacy env name: MT5_DEMO_EXECUTION_ENABLED → سيُعاد تسميته MT5_PLATFORM_EXECUTION_ENABLED لاحقاً]
 *
 * الأمان:
 *  • لا userId يُمرَّر
 *  • لا secrets تُخزَّن
 *  • لا Convex mutations
 *  • التحقق من manualConfirmation و accountMode داخل الخدمة المحلية
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE         = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const DEMO_ORDER_URL           = `${MT5_SERVICE_BASE}/demo/order-send`;
const FETCH_TIMEOUT_MS         = 12_000;
const DEMO_EXECUTION_ENABLED   = process.env.MT5_DEMO_EXECUTION_ENABLED === "true";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Guard: demo execution is disabled by default ───────────────────────────
  if (!DEMO_EXECUTION_ENABLED) {
    return NextResponse.json(
      {
        ok: false,
        accepted: false,
        error: "تنفيذ MT5 مغلق حاليًا بواسطة إعدادات النظام — يجب تفعيل MT5_DEMO_EXECUTION_ENABLED=true في خدمة MT5",
        demoOnly: true,
        read_only_mode: true,
      },
      { status: 403 },
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, accepted: false, error: "Invalid JSON body", demoOnly: true },
      { status: 400 },
    );
  }

  // ── Guard: must include manualConfirmation and accountMode ─────────────────
  if (body.manualConfirmation !== true) {
    return NextResponse.json(
      { ok: false, accepted: false, error: "manualConfirmation مطلوب", demoOnly: true },
      { status: 400 },
    );
  }
  if (body.accountMode !== "DEMO_ONLY") {
    return NextResponse.json(
      { ok: false, accepted: false, error: "accountMode يجب أن يكون DEMO_ONLY", demoOnly: true },
      { status: 400 },
    );
  }

  // ── Proxy to local MT5 service ────────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(DEMO_ORDER_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body:    JSON.stringify(body),
      signal:  controller.signal,
      cache:   "no-store",
    });
    clearTimeout(timeoutId);

    const data = (await upstream.json()) as Record<string, unknown>;
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const message   = isTimeout
      ? "انتهت مهلة الطلب — تحقق من تشغيل خدمة MT5 المحلية (port 8010)"
      : "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل";
    return NextResponse.json(
      { ok: false, accepted: false, error: message, demoOnly: true },
      { status: 503 },
    );
  }
}
