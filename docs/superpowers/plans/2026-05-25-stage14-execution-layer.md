# Stage 14 — MT5 Execution Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add controlled live/demo trade execution to Gold Pro Lab — `order_send` through a new FastAPI execution service on port 8011, with 2-step confirmation UI, hard safety caps, and full Convex audit log.

**Architecture:** A NEW Python service (`mt5_execution_service/`) on port 8011 handles all order_send calls, completely isolated from the read-only bridge on port 8010. Next.js API routes proxy the execution requests (with Clerk auth + lot re-validation). The UI adds an Execute button inside ManualTradeAlert that opens a confirmation modal before any order is placed. Open positions are tracked in a live-polling panel.

**Tech Stack:** FastAPI + MetaTrader5 (Python, port 8011), Next.js App Router API routes, Convex (tradeExecutions table), React (useState + useEffect polling), Tailwind CSS v4, Clerk auth.

**Critical Safety Rules (never weaken):**
- `DEMO_ONLY = True` in execution service — blocks live accounts until explicitly changed
- `MAX_LOT_SIZE = 0.10` hard cap — enforced in Python AND in Next.js route
- `MAX_OPEN_TRADES = 3` — blocks new orders when 3 positions already open
- 2-step confirmation required in UI before any order fires
- All executions logged to Convex immediately after success

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| CREATE | `mt5_execution_service/main.py` | FastAPI execution bridge, port 8011, order_send |
| CREATE | `mt5_execution_service/requirements.txt` | Python deps |
| CREATE | `src/app/api/lab/gold-pro/execute-trade/route.ts` | POST proxy → execution service + Convex log |
| CREATE | `src/app/api/lab/gold-pro/close-trade/route.ts` | POST close position proxy |
| CREATE | `src/app/api/lab/gold-pro/positions/route.ts` | GET open positions proxy |
| CREATE | `convex/tradeExecutions.ts` | logExecution mutation + getMyExecutions query |
| CREATE | `src/components/gold-pro/TradeConfirmModal.tsx` | 2-step confirmation dialog |
| CREATE | `src/components/gold-pro/OpenPositionsPanel.tsx` | Live positions list + close buttons |
| MODIFY | `convex/schema.ts` (line 716) | Add tradeExecutions table |
| MODIFY | `src/lib/gold-pro/types.ts` | Add ExecutionResult, OpenPosition interfaces |
| MODIFY | `src/components/gold-pro/ManualTradeAlert.tsx` | Add Execute button + modal wiring |
| MODIFY | `src/components/gold-pro/GoldProLab.tsx` | Add OpenPositionsPanel at bottom |
| MODIFY | `.env.local.example` | Add MT5_EXECUTION_URL |

---

## Task 1: Python Execution Service

**Files:**
- Create: `mt5_execution_service/requirements.txt`
- Create: `mt5_execution_service/main.py`

- [ ] **Step 1: Create requirements.txt**

```
fastapi>=0.115.0,<1
uvicorn[standard]>=0.32.0,<1
MetaTrader5>=5.0.45
```

File: `mt5_execution_service/requirements.txt`

- [ ] **Step 2: Create the execution service**

File: `mt5_execution_service/main.py`

```python
"""
MT5 Execution Service — Stage 14
Port 8011 — يُفرَّق عن الخدمة القراءة فقط (8010)

SAFETY CONSTANTS — لا تُعدَّل إلا بموافقة صريحة:
  DEMO_ONLY     = True   → يمنع الحسابات الحقيقية
  MAX_LOT_SIZE  = 0.10   → حد صارم لحجم الصفقة
  MAX_OPEN_TRADES = 3    → أقصى عدد صفقات مفتوحة
"""

from __future__ import annotations

import os
from typing import Optional

import MetaTrader5 as mt5
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

# ── Safety constants (hardcoded — must not be weakened) ──────────────────────
DEMO_ONLY: bool = True
MAX_LOT_SIZE: float = 0.10
MAX_OPEN_TRADES: int = 3
STAGE14_MAGIC: int = 141400  # identifies Stage-14 orders in MT5 history

app = FastAPI(title="MT5 Execution Service — Stage 14", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ── Pydantic models ──────────────────────────────────────────────────────────

class OrderRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    order_type: str = Field(..., pattern="^(BUY|SELL)$")
    lot: float = Field(..., gt=0, le=MAX_LOT_SIZE)
    sl: float = Field(..., gt=0)
    tp: float = Field(..., gt=0)
    comment: str = Field("GoldProLab", max_length=64)

    @field_validator("lot")
    @classmethod
    def cap_lot(cls, v: float) -> float:
        return min(round(v, 2), MAX_LOT_SIZE)


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    if not mt5.initialize():
        return {"connected": False, "demo_only": DEMO_ONLY, "max_lot": MAX_LOT_SIZE}
    info = mt5.account_info()
    account_type = "demo" if info and info.trade_mode == 0 else "live"
    return {
        "connected": True,
        "demo_only": DEMO_ONLY,
        "max_lot": MAX_LOT_SIZE,
        "max_open_trades": MAX_OPEN_TRADES,
        "account_type": account_type,
        "balance": info.balance if info else 0,
        "equity": info.equity if info else 0,
    }


# ── Place order ──────────────────────────────────────────────────────────────

@app.post("/execute/order")
def place_order(req: OrderRequest) -> dict:
    if not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 غير متصل")

    info = mt5.account_info()
    if info is None:
        raise HTTPException(status_code=503, detail="لا يوجد حساب MT5 مفعّل")

    # Safety: demo only
    if DEMO_ONLY and info.trade_mode != 0:
        raise HTTPException(
            status_code=403,
            detail="DEMO_ONLY=True — يُمنع التنفيذ على الحسابات الحقيقية"
        )

    # Safety: open positions cap
    existing = mt5.positions_get(symbol=req.symbol)
    if existing and len(existing) >= MAX_OPEN_TRADES:
        raise HTTPException(
            status_code=429,
            detail=f"الحد الأقصى {MAX_OPEN_TRADES} صفقات مفتوحة — أغلق صفقة أولاً"
        )

    # Get live price
    tick = mt5.symbol_info_tick(req.symbol)
    if tick is None:
        raise HTTPException(status_code=503, detail=f"لا يوجد سعر لرمز {req.symbol}")

    order_type_mt5 = mt5.ORDER_TYPE_BUY if req.order_type == "BUY" else mt5.ORDER_TYPE_SELL
    price = tick.ask if req.order_type == "BUY" else tick.bid

    request_dict = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": req.symbol,
        "volume": req.lot,
        "type": order_type_mt5,
        "price": price,
        "sl": req.sl,
        "tp": req.tp,
        "deviation": 20,
        "magic": STAGE14_MAGIC,
        "comment": req.comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request_dict)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        retcode = result.retcode if result else -1
        comment = result.comment if result else "no result"
        raise HTTPException(
            status_code=500,
            detail=f"فشل التنفيذ: {comment} (retcode={retcode})"
        )

    return {
        "ticket": result.order,
        "retcode": result.retcode,
        "volume": result.volume,
        "price": result.price,
        "symbol": req.symbol,
        "order_type": req.order_type,
        "sl": req.sl,
        "tp": req.tp,
        "comment": result.comment,
    }


# ── Close position ────────────────────────────────────────────────────────────

@app.post("/execute/close/{ticket}")
def close_position(ticket: int) -> dict:
    if not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 غير متصل")

    positions = mt5.positions_get(ticket=ticket)
    if not positions:
        raise HTTPException(status_code=404, detail=f"لا يوجد مركز برقم تذكرة {ticket}")

    pos = positions[0]
    tick = mt5.symbol_info_tick(pos.symbol)
    if tick is None:
        raise HTTPException(status_code=503, detail=f"لا يوجد سعر لرمز {pos.symbol}")

    close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
    close_price = tick.bid if pos.type == mt5.POSITION_TYPE_BUY else tick.ask

    request_dict = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": pos.symbol,
        "volume": pos.volume,
        "type": close_type,
        "position": ticket,
        "price": close_price,
        "deviation": 20,
        "magic": STAGE14_MAGIC,
        "comment": "GoldProLab-Close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request_dict)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        retcode = result.retcode if result else -1
        comment = result.comment if result else "no result"
        raise HTTPException(
            status_code=500,
            detail=f"فشل الإغلاق: {comment} (retcode={retcode})"
        )

    return {
        "closed": True,
        "ticket": ticket,
        "retcode": result.retcode,
        "profit": pos.profit,
    }


# ── Get open positions ────────────────────────────────────────────────────────

@app.get("/execute/positions")
def get_positions() -> dict:
    if not mt5.initialize():
        return {"positions": [], "connected": False}

    raw = mt5.positions_get()
    if raw is None:
        return {"positions": [], "connected": True}

    return {
        "positions": [
            {
                "ticket": p.ticket,
                "symbol": p.symbol,
                "type": "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": p.volume,
                "price_open": round(p.price_open, 2),
                "sl": round(p.sl, 2),
                "tp": round(p.tp, 2),
                "price_current": round(p.price_current, 2),
                "profit": round(p.profit, 2),
                "time": p.time,
            }
            for p in raw
        ],
        "connected": True,
    }
```

- [ ] **Step 3: Verify Python compiles without errors**

```bash
python -m py_compile mt5_execution_service/main.py
echo "EXIT:$?"
```

Expected: `EXIT:0`

- [ ] **Step 4: Commit**

```bash
git add mt5_execution_service/
git commit -m "feat(stage14): MT5 execution service — port 8011, DEMO_ONLY, MAX_LOT=0.10"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/lib/gold-pro/types.ts` (append after line 222)

- [ ] **Step 1: Add ExecutionResult and OpenPosition interfaces**

Append to the bottom of `src/lib/gold-pro/types.ts` (before the closing line, after the TradeSetup block):

```typescript
// ─── Stage 14 — Execution Types ──────────────────────────────────────────────

export interface ExecutionRequest {
  symbol: string;
  order_type: "BUY" | "SELL";
  lot: number;
  sl: number;
  tp: number;
  comment?: string;
  confluenceScore?: number;
  setupLabel?: string;
}

export interface ExecutionResult {
  ticket: number;
  retcode: number;
  volume: number;
  price: number;
  symbol: string;
  order_type: "BUY" | "SELL";
  sl: number;
  tp: number;
  comment: string;
}

export interface OpenPosition {
  ticket: number;
  symbol: string;
  type: "BUY" | "SELL";
  volume: number;
  price_open: number;
  sl: number;
  tp: number;
  price_current: number;
  profit: number;
  time: number;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: no output (zero errors)

- [ ] **Step 3: Commit**

```bash
git add src/lib/gold-pro/types.ts
git commit -m "feat(stage14): add ExecutionResult + OpenPosition types"
```

---

## Task 3: Convex Schema + tradeExecutions Functions

**Files:**
- Modify: `convex/schema.ts` (insert before closing `});` at line 716)
- Create: `convex/tradeExecutions.ts`

- [ ] **Step 1: Add tradeExecutions table to schema**

In `convex/schema.ts`, replace the closing `});` (last two lines) with:

```typescript
  tradeExecutions: defineTable({
    userId: v.string(),
    timestamp: v.number(),
    symbol: v.string(),
    orderType: v.union(v.literal("BUY"), v.literal("SELL")),
    lot: v.number(),
    entryPrice: v.number(),
    sl: v.number(),
    tp: v.number(),
    ticket: v.number(),
    confluenceScore: v.number(),
    setupLabel: v.string(),
    // outcome — filled later by updateExecutionOutcome mutation
    closePrice: v.optional(v.number()),
    profit: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    status: v.union(
      v.literal("open"),
      v.literal("closed"),
      v.literal("failed"),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"]),
});
```

- [ ] **Step 2: Run Convex codegen**

```bash
pnpm exec convex codegen
```

Expected: regenerates `convex/_generated/` with no errors

- [ ] **Step 3: Create convex/tradeExecutions.ts**

```typescript
// convex/tradeExecutions.ts
// Stage 14 — Execution audit log
// لا يحتوي على أي منطق تنفيذ — سجل فقط

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** تسجيل صفقة منفّذة بعد نجاح order_send */
export const logExecution = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
    orderType: v.union(v.literal("BUY"), v.literal("SELL")),
    lot: v.number(),
    entryPrice: v.number(),
    sl: v.number(),
    tp: v.number(),
    ticket: v.number(),
    confluenceScore: v.number(),
    setupLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    return await ctx.db.insert("tradeExecutions", {
      userId: identity.subject,
      timestamp: Date.now(),
      symbol: args.symbol,
      orderType: args.orderType,
      lot: args.lot,
      entryPrice: args.entryPrice,
      sl: args.sl,
      tp: args.tp,
      ticket: args.ticket,
      confluenceScore: args.confluenceScore,
      setupLabel: args.setupLabel,
      status: "open",
    });
  },
});

/** جلب آخر 30 صفقة للمستخدم */
export const getMyExecutions = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.db
      .query("tradeExecutions")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(30);
  },
});

/** تحديث نتيجة صفقة بعد إغلاقها */
export const updateExecutionOutcome = mutation({
  args: {
    executionId: v.id("tradeExecutions"),
    closePrice: v.number(),
    profit: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const exec = await ctx.db.get(args.executionId);
    if (!exec || exec.userId !== identity.subject) throw new Error("Not found");

    await ctx.db.patch(args.executionId, {
      closePrice: args.closePrice,
      profit: args.profit,
      closedAt: Date.now(),
      status: args.profit >= 0 ? "closed" : "closed",
    });
  },
});
```

- [ ] **Step 4: Verify TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/tradeExecutions.ts convex/_generated/
git commit -m "feat(stage14): tradeExecutions Convex table + logExecution mutation"
```

---

## Task 4: Next.js API Routes

**Files:**
- Create: `src/app/api/lab/gold-pro/execute-trade/route.ts`
- Create: `src/app/api/lab/gold-pro/close-trade/route.ts`
- Create: `src/app/api/lab/gold-pro/positions/route.ts`

- [ ] **Step 1: Create execute-trade route**

File: `src/app/api/lab/gold-pro/execute-trade/route.ts`

```typescript
// src/app/api/lab/gold-pro/execute-trade/route.ts
// POST — يأخذ طلب صفقة، يتحقق من Clerk auth، يرسل للخدمة على 8011
// يسجّل في Convex بعد النجاح

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

    // Log to Convex audit trail
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
      // لا نوقف العملية إذا فشل Convex — الصفقة نُفِّذت بالفعل
      console.error("[execute-trade] Convex log failed:", convexErr);
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[execute-trade]", err);
    return NextResponse.json(
      { error: "خطأ في الاتصال بخدمة التنفيذ" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 2: Create close-trade route**

File: `src/app/api/lab/gold-pro/close-trade/route.ts`

```typescript
// src/app/api/lab/gold-pro/close-trade/route.ts
// POST { ticket: number } — يغلق مركزاً مفتوحاً

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
```

- [ ] **Step 3: Create positions route**

File: `src/app/api/lab/gold-pro/positions/route.ts`

```typescript
// src/app/api/lab/gold-pro/positions/route.ts
// GET — يجلب المراكز المفتوحة من خدمة التنفيذ

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
      return NextResponse.json({ positions: [], connected: false }, { status: 200 });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ positions: [], connected: false }, { status: 200 });
  }
}
```

- [ ] **Step 4: Add MT5_EXECUTION_URL to .env.local.example**

Append to `.env.local.example`:

```
# MT5 Execution Service (Stage 14) — port 8011
MT5_EXECUTION_URL=http://127.0.0.1:8011
```

- [ ] **Step 5: Verify TypeScript + build**

```bash
pnpm exec tsc --noEmit
pnpm run build
```

Expected: zero errors, all pages build

- [ ] **Step 6: Commit**

```bash
git add src/app/api/lab/gold-pro/execute-trade/ \
        src/app/api/lab/gold-pro/close-trade/ \
        src/app/api/lab/gold-pro/positions/ \
        .env.local.example
git commit -m "feat(stage14): execute-trade + close-trade + positions API routes"
```

---

## Task 5: TradeConfirmModal Component

**Files:**
- Create: `src/components/gold-pro/TradeConfirmModal.tsx`

- [ ] **Step 1: Create the modal**

File: `src/components/gold-pro/TradeConfirmModal.tsx`

```typescript
// src/components/gold-pro/TradeConfirmModal.tsx
// نافذة تأكيد الصفقة — مرحلتان: مراجعة ← تأكيد نهائي
// لا order_send هنا — تُرسَل فقط بعد تأكيد المستخدم المزدوج
"use client";

import { useState } from "react";
import type { ExecutionResult } from "@/lib/gold-pro/types";

export interface TradeConfirmData {
  symbol: string;
  order_type: "BUY" | "SELL";
  lot: number;
  entry: number;
  sl: number;
  tp: number;
  rr: string;
  confluenceScore: number;
  setupLabel: string;
}

interface Props {
  data: TradeConfirmData;
  onConfirm: () => Promise<ExecutionResult | null>;
  onClose: () => void;
}

export function TradeConfirmModal({ data, onConfirm, onClose }: Props) {
  const [step, setStep] = useState<"review" | "confirm" | "executing" | "done" | "error">("review");
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const isBuy = data.order_type === "BUY";
  const accentCls = isBuy ? "text-green-400" : "text-red-400";
  const borderCls = isBuy ? "border-green-600" : "border-red-600";

  const handleFinalConfirm = async () => {
    setStep("executing");
    try {
      const res = await onConfirm();
      if (res) {
        setResult(res);
        setStep("done");
      } else {
        setErrorMsg("لم يُستلم رد من خدمة التنفيذ");
        setStep("error");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "خطأ غير معروف");
      setStep("error");
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`w-full max-w-md rounded-2xl border-2 ${borderCls} bg-slate-900 p-6`}
        dir="rtl"
      >
        {/* ── Review step ─────────────────────────────────────────── */}
        {step === "review" && (
          <>
            <h2 className="mb-1 text-lg font-bold text-white">
              {isBuy ? "🟢" : "🔴"} مراجعة الصفقة
            </h2>
            <p className="mb-4 text-xs text-slate-400">
              تحقق من جميع التفاصيل قبل المتابعة
            </p>

            <div className="mb-4 space-y-2 text-sm">
              {[
                ["الرمز",        data.symbol],
                ["الاتجاه",      isBuy ? "BUY  ↑ شراء" : "SELL ↓ بيع"],
                ["حجم الصفقة",   `${data.lot.toFixed(2)} Lot`],
                ["سعر الدخول",  data.entry.toFixed(2)],
                ["وقف الخسارة", data.sl.toFixed(2)],
                ["هدف الربح",   data.tp.toFixed(2)],
                ["R/R",          `1 : ${data.rr}`],
                ["درجة الثقة",  `${data.confluenceScore}/100`],
                ["نوع الإعداد", data.setupLabel],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-slate-800 py-1">
                  <span className="text-slate-400">{label}</span>
                  <span className={`font-mono font-semibold ${
                    label === "الاتجاه"      ? accentCls :
                    label === "وقف الخسارة" ? "text-red-400" :
                    label === "هدف الربح"   ? "text-green-400" :
                    label === "حجم الصفقة"  ? "text-blue-400" :
                    "text-white"
                  }`}>{value}</span>
                </div>
              ))}
            </div>

            {/* DEMO warning */}
            <div className="mb-4 rounded-lg border border-yellow-700 bg-yellow-950 p-3 text-xs text-yellow-300">
              ⚠️ <strong>تأكد أن MT5 متصل بحساب تجريبي (Demo)</strong> — الخدمة تمنع الحسابات الحقيقية تلقائياً
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep("confirm")}
                className={`flex-1 rounded-lg py-2 font-bold ${
                  isBuy
                    ? "bg-green-600 hover:bg-green-500 text-white"
                    : "bg-red-600 hover:bg-red-500 text-white"
                }`}
              >
                متابعة للتأكيد النهائي →
              </button>
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-400 hover:bg-slate-800"
              >
                إلغاء
              </button>
            </div>
          </>
        )}

        {/* ── Final confirm step ───────────────────────────────────── */}
        {step === "confirm" && (
          <>
            <h2 className="mb-2 text-lg font-bold text-white">
              ⚡ تأكيد نهائي
            </h2>
            <p className="mb-6 text-sm text-slate-300">
              هل أنت متأكد من تنفيذ صفقة{" "}
              <strong className={accentCls}>
                {data.order_type} {data.symbol}
              </strong>{" "}
              بحجم <strong className="text-blue-400">{data.lot.toFixed(2)} Lot</strong>؟
            </p>
            <p className="mb-6 text-xs text-slate-500">
              لا يمكن التراجع بعد التنفيذ — ستحتاج إلى إغلاق المركز يدوياً
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleFinalConfirm}
                className={`flex-1 rounded-lg py-3 text-lg font-bold ${
                  isBuy
                    ? "bg-green-500 hover:bg-green-400 text-black"
                    : "bg-red-500 hover:bg-red-400 text-white"
                }`}
              >
                {isBuy ? "✅ نفّذ الشراء" : "✅ نفّذ البيع"}
              </button>
              <button
                onClick={() => setStep("review")}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-400 hover:bg-slate-800"
              >
                ← رجوع
              </button>
            </div>
          </>
        )}

        {/* ── Executing ───────────────────────────────────────────── */}
        {step === "executing" && (
          <div className="py-8 text-center">
            <div className="mb-4 text-4xl">⏳</div>
            <p className="text-sm text-slate-300">جاري إرسال الأمر إلى MT5…</p>
          </div>
        )}

        {/* ── Done ────────────────────────────────────────────────── */}
        {step === "done" && result && (
          <>
            <div className="mb-4 text-center text-5xl">✅</div>
            <h2 className="mb-4 text-center text-lg font-bold text-green-400">
              تم تنفيذ الصفقة بنجاح
            </h2>
            <div className="mb-4 space-y-2 text-sm">
              {[
                ["رقم التذكرة (Ticket)", String(result.ticket)],
                ["سعر التنفيذ الفعلي",  result.price.toFixed(2)],
                ["الحجم",               `${result.volume.toFixed(2)} Lot`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-slate-800 py-1">
                  <span className="text-slate-400">{label}</span>
                  <span className="font-mono font-semibold text-white">{value}</span>
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-slate-700 py-2 text-slate-200 hover:bg-slate-600"
            >
              إغلاق
            </button>
          </>
        )}

        {/* ── Error ───────────────────────────────────────────────── */}
        {step === "error" && (
          <>
            <div className="mb-4 text-center text-5xl">❌</div>
            <h2 className="mb-2 text-center text-lg font-bold text-red-400">
              فشل التنفيذ
            </h2>
            <p className="mb-6 rounded-lg border border-red-800 bg-red-950 p-3 text-center text-sm text-red-300">
              {errorMsg}
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-slate-700 py-2 text-slate-200 hover:bg-slate-600"
            >
              إغلاق
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/components/gold-pro/TradeConfirmModal.tsx
git commit -m "feat(stage14): TradeConfirmModal — 2-step review→confirm→execute"
```

---

## Task 6: Execute Button in ManualTradeAlert

**Files:**
- Modify: `src/components/gold-pro/ManualTradeAlert.tsx`

- [ ] **Step 1: Replace the file with the version that includes the execute button**

The full updated `src/components/gold-pro/ManualTradeAlert.tsx`:

```typescript
// src/components/gold-pro/ManualTradeAlert.tsx
// تنبيه تداول — يظهر عند Score ≥ 70
// يشمل زر التنفيذ الذي يفتح TradeConfirmModal
"use client";

import { useState, useCallback } from "react";
import type { GoldProAnalysis, ExecutionResult } from "@/lib/gold-pro/types";
import {
  TradeConfirmModal,
  type TradeConfirmData,
} from "./TradeConfirmModal";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title={`نسخ ${label}`}
      className="ml-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
      style={{
        background: copied ? "#166534" : "#1e293b",
        color: copied ? "#86efac" : "#94a3b8",
      }}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

interface Props {
  analysis: GoldProAnalysis;
}

export function ManualTradeAlert({ analysis }: Props) {
  const { confluence, sltp, positioning, tradeSetups } = analysis;
  const [expanded, setExpanded] = useState(true);
  const [showModal, setShowModal] = useState(false);

  if (confluence.signal === "WAIT" || confluence.score < 70) return null;

  const isBuy = confluence.signal === "BUY";
  const borderCls = isBuy ? "border-green-500" : "border-red-500";
  const bgCls     = isBuy ? "bg-green-950"     : "bg-red-950";
  const accentCls = isBuy ? "text-green-400"    : "text-red-400";
  const badgeCls  = isBuy
    ? "bg-green-900 text-green-300 border border-green-700"
    : "bg-red-900 text-red-300 border border-red-700";
  const signalAr  = isBuy ? "شراء" : "بيع";
  const dirAr     = isBuy ? "BUY  ↑" : "SELL ↓";

  const fmt = (n: number) => n.toFixed(2);

  const bestSetup =
    tradeSetups.length > 0
      ? tradeSetups.reduce((a, b) => (b.confidence > a.confidence ? b : a))
      : null;

  const entry  = bestSetup ? bestSetup.entryPrice  : sltp.entryPrice;
  const sl     = bestSetup ? bestSetup.stopLoss     : sltp.stopLoss;
  const tp1    = bestSetup ? bestSetup.takeProfit1  : sltp.takeProfit1;
  const tp2    = bestSetup ? bestSetup.takeProfit2  : sltp.takeProfit2;
  const rr     = bestSetup ? bestSetup.rrRatio1     : sltp.rrRatio1;
  const lot    = bestSetup ? bestSetup.lotSize       : positioning.lotSize;
  const label  = bestSetup ? bestSetup.label         : "H1 Intraday";
  const score  = confluence.score;

  const modalData: TradeConfirmData = {
    symbol:         analysis.symbol,
    order_type:     confluence.signal as "BUY" | "SELL",
    lot:            Math.min(lot, 0.10),
    entry,
    sl,
    tp:             tp1,
    rr:             rr.toFixed(1),
    confluenceScore: score,
    setupLabel:     label,
  };

  const handleExecute = useCallback(async (): Promise<ExecutionResult | null> => {
    const res = await fetch("/api/lab/gold-pro/execute-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol:         modalData.symbol,
        order_type:     modalData.order_type,
        lot:            modalData.lot,
        sl:             modalData.sl,
        tp:             modalData.tp,
        comment:        `GoldPro-${modalData.setupLabel}`,
        confluenceScore: modalData.confluenceScore,
        setupLabel:     modalData.setupLabel,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "خطأ" }));
      throw new Error(err.error ?? "فشل التنفيذ");
    }
    return res.json() as Promise<ExecutionResult>;
  }, [modalData]);

  const rows: Array<{ ar: string; val: string; copy?: string }> = [
    { ar: "الرمز",        val: analysis.symbol },
    { ar: "الاتجاه",      val: dirAr },
    { ar: "سعر الدخول",  val: fmt(entry),  copy: fmt(entry) },
    { ar: "وقف الخسارة", val: fmt(sl),     copy: fmt(sl) },
    { ar: "هدف 1 (TP1)", val: fmt(tp1),    copy: fmt(tp1) },
    { ar: "هدف 2 (TP2)", val: fmt(tp2),    copy: fmt(tp2) },
    { ar: "حجم العقد",   val: `${Math.min(lot, 0.10).toFixed(2)} Lot`, copy: Math.min(lot, 0.10).toFixed(2) },
    { ar: "R/R",          val: `1 : ${rr.toFixed(1)}` },
    { ar: "نوع الصفقة",  val: label },
    { ar: "درجة الثقة",  val: `${score} / 100` },
  ];

  return (
    <>
      <div
        className={`rounded-xl border-2 ${borderCls} ${bgCls} p-4 shadow-lg`}
        dir="rtl"
      >
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{isBuy ? "🟢" : "🔴"}</span>
            <div>
              <p className={`text-lg font-bold ${accentCls}`}>
                إشارة {signalAr} قوية — XAUUSD
              </p>
              <p className="text-xs text-slate-400">
                درجة الالتقاء: <strong className={accentCls}>{score}/100</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${badgeCls}`}>
              {dirAr}
            </span>
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              {expanded ? "▲" : "▼"}
            </button>
          </div>
        </div>

        {expanded && (
          <>
            {/* Parameters */}
            <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {rows.map((row) => (
                <div
                  key={row.ar}
                  className="flex items-center justify-between border-b border-slate-800 py-1"
                >
                  <span className="text-slate-400">{row.ar}</span>
                  <span
                    className={`font-mono font-semibold ${
                      row.ar === "الاتجاه"      ? accentCls :
                      row.ar === "وقف الخسارة" ? "text-red-400" :
                      row.ar.startsWith("هدف") ? "text-green-400" :
                      row.ar === "حجم العقد"  ? "text-blue-400" :
                      "text-white"
                    }`}
                  >
                    {row.val}
                    {row.copy && (
                      <CopyButton value={row.copy} label={row.ar} />
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Execute button */}
            <button
              onClick={() => setShowModal(true)}
              className={`mb-3 w-full rounded-xl py-3 text-base font-bold transition-all ${
                isBuy
                  ? "bg-green-500 hover:bg-green-400 text-black shadow-green-900 shadow-md"
                  : "bg-red-500 hover:bg-red-400 text-white shadow-red-900 shadow-md"
              }`}
            >
              {isBuy ? "⚡ تنفيذ الشراء تلقائياً" : "⚡ تنفيذ البيع تلقائياً"}
            </button>

            {/* Disclaimer */}
            <p className="text-center text-[10px] text-slate-600">
              ⚠️ تنفيذ على Demo فقط — ليست توصية مالية — على مسؤوليتك الكاملة
            </p>
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      {showModal && (
        <TradeConfirmModal
          data={modalData}
          onConfirm={handleExecute}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/components/gold-pro/ManualTradeAlert.tsx
git commit -m "feat(stage14): add Execute button to ManualTradeAlert → TradeConfirmModal"
```

---

## Task 7: OpenPositionsPanel Component

**Files:**
- Create: `src/components/gold-pro/OpenPositionsPanel.tsx`

- [ ] **Step 1: Create the panel**

File: `src/components/gold-pro/OpenPositionsPanel.tsx`

```typescript
// src/components/gold-pro/OpenPositionsPanel.tsx
// لوحة المراكز المفتوحة — تعيد الاستعلام كل 5 ثوانٍ
// تُتيح إغلاق الصفقات بنقرة واحدة
"use client";

import { useState, useEffect, useCallback } from "react";
import type { OpenPosition } from "@/lib/gold-pro/types";

export function OpenPositionsPanel() {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [connected, setConnected] = useState(false);
  const [closing, setClosing] = useState<number | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/lab/gold-pro/positions");
      if (!res.ok) return;
      const data = await res.json();
      setPositions(data.positions ?? []);
      setConnected(data.connected ?? false);
    } catch {
      // silent — service may not be running
    }
  }, []);

  // initial fetch + polling every 5 seconds
  useEffect(() => {
    fetchPositions();
    const id = setInterval(fetchPositions, 5000);
    return () => clearInterval(id);
  }, [fetchPositions]);

  const handleClose = async (ticket: number) => {
    setClosing(ticket);
    setCloseError(null);
    try {
      const res = await fetch("/api/lab/gold-pro/close-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "خطأ" }));
        setCloseError(err.error ?? "فشل الإغلاق");
      } else {
        // refresh immediately after close
        await fetchPositions();
      }
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setClosing(null);
    }
  };

  // Hide panel completely if service unreachable and no positions
  if (!connected && positions.length === 0) return null;

  return (
    <div
      className="rounded-xl border border-slate-700 bg-slate-900 p-4"
      dir="rtl"
    >
      <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
        <p className="text-xs uppercase tracking-widest text-slate-500">
          📋 المراكز المفتوحة
        </p>
        <span className="text-xs text-slate-500">
          {positions.length} مركز
          {" · "}
          <span className={connected ? "text-green-500" : "text-red-500"}>
            {connected ? "● متصل" : "● منقطع"}
          </span>
        </span>
      </div>

      {positions.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-600">
          لا توجد مراكز مفتوحة حالياً
        </p>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const isBuy = pos.type === "BUY";
            const profitPositive = pos.profit >= 0;
            return (
              <div
                key={pos.ticket}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2 text-xs"
              >
                {/* Left: symbol + type + ticket */}
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={isBuy ? "text-green-400" : "text-red-400"}>
                      {isBuy ? "▲ BUY" : "▼ SELL"}
                    </span>
                    <span className="font-bold text-white">{pos.symbol}</span>
                    <span className="text-slate-500">#{pos.ticket}</span>
                  </div>
                  <div className="text-slate-400">
                    دخل: <span className="font-mono text-slate-300">{pos.price_open.toFixed(2)}</span>
                    {" · "}
                    حالي: <span className="font-mono text-slate-300">{pos.price_current.toFixed(2)}</span>
                    {" · "}
                    {pos.volume.toFixed(2)} Lot
                  </div>
                  <div className="text-slate-400">
                    SL: <span className="font-mono text-red-400">{pos.sl.toFixed(2)}</span>
                    {" · "}
                    TP: <span className="font-mono text-green-400">{pos.tp.toFixed(2)}</span>
                  </div>
                </div>

                {/* Right: profit + close button */}
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={`font-mono text-base font-bold ${
                      profitPositive ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {profitPositive ? "+" : ""}
                    {pos.profit.toFixed(2)} $
                  </span>
                  <button
                    onClick={() => handleClose(pos.ticket)}
                    disabled={closing === pos.ticket}
                    className="rounded bg-red-900 px-2 py-1 text-[11px] text-red-300 hover:bg-red-800 disabled:opacity-50"
                  >
                    {closing === pos.ticket ? "⏳ إغلاق…" : "✕ إغلاق"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {closeError && (
        <p className="mt-2 rounded border border-red-800 bg-red-950 p-2 text-xs text-red-400">
          ⚠️ {closeError}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/components/gold-pro/OpenPositionsPanel.tsx
git commit -m "feat(stage14): OpenPositionsPanel — live polling + close button"
```

---

## Task 8: Wire GoldProLab + Final Build

**Files:**
- Modify: `src/components/gold-pro/GoldProLab.tsx`

- [ ] **Step 1: Import OpenPositionsPanel and add it to GoldProLab**

In `src/components/gold-pro/GoldProLab.tsx`, add the import after `ConvexSafeWrapper`:

```typescript
import { OpenPositionsPanel } from "./OpenPositionsPanel";
```

Then inside the `{analysis && (...)}` block, add `<OpenPositionsPanel />` just before the `<ConvexSafeWrapper>` block:

```tsx
          {/* Row 5: Open Positions — Live polling */}
          <OpenPositionsPanel />

          {/* Row 4: History — معزول بـ Error Boundary حماية من أخطاء Convex */}
          <ConvexSafeWrapper>
            <HistorySection />
          </ConvexSafeWrapper>
```

- [ ] **Step 2: Run final tsc + build**

```bash
pnpm exec tsc --noEmit
pnpm run build
```

Expected: zero errors, all pages including `/lab/gold-pro` build successfully

- [ ] **Step 3: Commit**

```bash
git add src/components/gold-pro/GoldProLab.tsx
git commit -m "feat(stage14): wire OpenPositionsPanel into GoldProLab"
```

---

## Task 9: Final Verification Checklist

- [ ] **Step 1: Start execution service**

```bash
cd mt5_execution_service
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8011 --reload
```

Expected: `Application startup complete.`

- [ ] **Step 2: Test health endpoint**

```bash
curl http://127.0.0.1:8011/health
```

Expected:
```json
{"connected": true, "demo_only": true, "max_lot": 0.1, "account_type": "demo", ...}
```

- [ ] **Step 3: Test positions endpoint**

```bash
curl http://127.0.0.1:8011/execute/positions
```

Expected: `{"positions": [...], "connected": true}`

- [ ] **Step 4: Manual browser test**
  - Open `http://localhost:3000/lab/gold-pro`
  - Click "تحليل الآن"
  - If score ≥ 70: verify ManualTradeAlert shows with green/red Execute button
  - Click Execute button → verify modal opens with Review step
  - Check all parameters match analysis values
  - Click "متابعة للتأكيد النهائي" → verify Confirm step shows
  - (Optional with MT5 Demo connected) click final confirm → verify ticket appears

- [ ] **Step 5: Verify RTL, Arabic text, no English UI**

- [ ] **Step 6: Final git status check**

```bash
git status --short
git log --oneline -8
```

Expected: clean working tree, 8 clean commits for Stage 14

---

## Quick Reference — Running Both Services

```bash
# Terminal 1 — Read-only bridge (port 8010)
cd mt5_readonly_service
uvicorn main:app --host 127.0.0.1 --port 8010 --reload

# Terminal 2 — Execution service (port 8011)
cd mt5_execution_service
uvicorn main:app --host 127.0.0.1 --port 8011 --reload

# Terminal 3 — Next.js
pnpm dev
```
