"""
MT5 Execution Service — Stage 14
Port 8011 — يُفرَّق عن الخدمة القراءة فقط (8010)

SAFETY CONSTANTS — لا تُعدَّل إلا بموافقة صريحة:
  DEMO_ONLY       = True   → يمنع الحسابات الحقيقية
  MAX_LOT_SIZE    = 0.10   → حد صارم لحجم الصفقة
  MAX_OPEN_TRADES = 3      → أقصى عدد صفقات مفتوحة
"""

from __future__ import annotations

import MetaTrader5 as mt5
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# ── Safety constants (hardcoded — must not be weakened) ──────────────────────
DEMO_ONLY: bool = True
MAX_LOT_SIZE: float = 0.10
MAX_OPEN_TRADES: int = 3
STAGE14_MAGIC: int = 141400  # يُميِّز أوامر Stage-14 في سجل MT5

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
            detail="DEMO_ONLY=True — يُمنع التنفيذ على الحسابات الحقيقية",
        )

    # Safety: open positions cap
    existing = mt5.positions_get(symbol=req.symbol)
    if existing and len(existing) >= MAX_OPEN_TRADES:
        raise HTTPException(
            status_code=429,
            detail=f"الحد الأقصى {MAX_OPEN_TRADES} صفقات مفتوحة — أغلق صفقة أولاً",
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
            detail=f"فشل التنفيذ: {comment} (retcode={retcode})",
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
            detail=f"فشل الإغلاق: {comment} (retcode={retcode})",
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
