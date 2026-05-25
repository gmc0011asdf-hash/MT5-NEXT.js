// src/app/api/lab/gold-pro/save-snapshot/route.ts
// POST — يحفظ snapshot التحليل في Convex
// لا تنفيذ تداول

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const id = await convex.mutation(api.goldProAnalysis.saveAnalysis, body);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error("[gold-pro/save-snapshot]", err);
    return NextResponse.json({ error: "فشل الحفظ" }, { status: 500 });
  }
}
