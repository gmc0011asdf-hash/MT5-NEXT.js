"""
okx_bridge.py -- OKX Public Market Data Bridge (Read-Only).

Fetches public OHLCV candles and ticker data from OKX REST API v5.
No authentication required -- public market data endpoints only.

READ-ONLY CONTRACT:
    - Public candle/price data ONLY (no account, no auth token, no API key).
    - ABSOLUTE PROHIBITION: no order_send, no order_close, no withdrawals,
      no Futures, no Leverage, no Live Trading execution of any kind.
    - This module is informational analysis only.

OKX REST API v5 docs: https://www.okx.com/docs-v5/en/
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import requests

logger = logging.getLogger(__name__)

OKX_BASE_URL  = "https://www.okx.com"
OKX_TIMEOUT   = 12.0  # seconds per HTTP request

# Mapping from OKX bar strings to our internal timeframe display names.
OKX_BAR_DISPLAY: dict[str, str] = {
    "1m":  "M1",
    "5m":  "M5",
    "15m": "M15",
    "30m": "M30",
    "1H":  "H1",
    "4H":  "H4",
    "1D":  "D1",
}

# Default crypto instruments fed into the agent council scan.
DEFAULT_OKX_SYMBOLS: list[str] = [
    "BTC-USDT",
    "ETH-USDT",
    "SOL-USDT",
    "DOGE-USDT",
    "XRP-USDT",
    "BCH-USDT",
    "ADA-USDT",
    "AVAX-USDT",
    "LINK-USDT",
    "DOT-USDT",
    "LTC-USDT",
    "MATIC-USDT"
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ts_ms_to_iso(ts_ms: str | int) -> str:
    """Convert OKX epoch-milliseconds timestamp to ISO-8601 UTC string."""
    try:
        return datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError):
        return ""


def _safe_float(d: dict[str, Any], key: str, default: float = 0.0) -> float:
    try:
        val = d.get(key, default)
        return float(val) if val not in (None, "", "0") else default
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Candle fetching
# ---------------------------------------------------------------------------

def fetch_okx_candles(
    inst_id: str,
    bar:     str = "1H",
    limit:   int = 250,
) -> list[dict[str, Any]]:
    """
    Fetch OHLCV candles from OKX public REST API (no auth required).

    Parameters
    ----------
    inst_id : OKX instrument ID, e.g. "BTC-USDT"
    bar     : OKX bar string -- "1m", "5m", "15m", "30m", "1H", "4H", "1D"
    limit   : number of candles (1-300, OKX hard cap)

    Returns
    -------
    list of dicts sorted oldest-first with keys:
        symbol, timeframe, time (UTC ms int), time_iso, open, high, low,
        close, tick_volume
    Returns an empty list on any network or API error (never raises).
    """
    url    = f"{OKX_BASE_URL}/api/v5/market/candles"
    params = {
        "instId": inst_id,
        "bar":    bar,
        "limit":  str(min(max(1, limit), 300)),
    }

    try:
        resp = requests.get(url, params=params, timeout=OKX_TIMEOUT)
        resp.raise_for_status()
        body: dict[str, Any] = resp.json()
    except requests.exceptions.Timeout:
        logger.error("fetch_okx_candles: timeout for %s", inst_id)
        return []
    except requests.exceptions.RequestException as exc:
        logger.error("fetch_okx_candles: request failed for %s -- %s", inst_id, exc)
        return []
    except Exception as exc:
        logger.error("fetch_okx_candles: unexpected error for %s -- %s", inst_id, exc)
        return []

    if str(body.get("code", "")) != "0":
        logger.warning(
            "fetch_okx_candles: OKX API error code=%s msg=%s for %s",
            body.get("code"), body.get("msg"), inst_id,
        )
        return []

    # OKX returns rows newest-first; reverse to oldest-first for
    # time-series indicators (EMA, ATR) that expect chronological order.
    raw: list[list[str]] = body.get("data", [])
    tf  = OKX_BAR_DISPLAY.get(bar, bar)

    candles: list[dict[str, Any]] = []
    for row in reversed(raw):
        # row format: [ts_ms, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
        if len(row) < 5:
            continue
        ts_ms = int(row[0])
        candles.append({
            "symbol":      inst_id,
            "timeframe":   tf,
            "time":        ts_ms,
            "time_iso":    _ts_ms_to_iso(row[0]),
            "open":        float(row[1]),
            "high":        float(row[2]),
            "low":         float(row[3]),
            "close":       float(row[4]),
            "tick_volume": int(float(row[5])) if len(row) > 5 else 0,
        })

    return candles


# ---------------------------------------------------------------------------
# Ticker fetching
# ---------------------------------------------------------------------------

def fetch_okx_tickers(inst_ids: list[str]) -> list[dict[str, Any]]:
    """
    Fetch current ticker snapshot for a list of OKX instruments.
    Uses the public /api/v5/market/ticker endpoint (no auth required).
    Symbols that fail are silently skipped; the list is always returned.
    """
    url     = f"{OKX_BASE_URL}/api/v5/market/ticker"
    results: list[dict[str, Any]] = []

    for inst_id in inst_ids:
        try:
            resp = requests.get(url, params={"instId": inst_id}, timeout=OKX_TIMEOUT)
            resp.raise_for_status()
            body: dict[str, Any] = resp.json()
        except Exception as exc:
            logger.warning("fetch_okx_tickers: failed for %s -- %s", inst_id, exc)
            continue

        if str(body.get("code", "")) != "0":
            continue

        data = body.get("data", [])
        if not data:
            continue

        d = data[0]
        last     = _safe_float(d, "last")
        open_24h = _safe_float(d, "open24h")
        change_pct = ((last - open_24h) / open_24h * 100) if open_24h else 0.0

        results.append({
            "symbol":     inst_id,
            "last":       last,
            "bid":        _safe_float(d, "bidPx"),
            "ask":        _safe_float(d, "askPx"),
            "high_24h":   _safe_float(d, "high24h"),
            "low_24h":    _safe_float(d, "low24h"),
            "vol_24h":    _safe_float(d, "vol24h"),
            "open_24h":   open_24h,
            "change_pct": round(change_pct, 4),
            "ts":         _ts_ms_to_iso(d.get("ts", "0")),
            "source":     "okx-public",
        })

    return results


# ---------------------------------------------------------------------------
# DataFrame conversion
# ---------------------------------------------------------------------------

def okx_candles_to_dataframe(candles: list[dict[str, Any]]) -> pd.DataFrame:
    """
    Convert the list returned by fetch_okx_candles() to a pandas DataFrame
    in the format expected by CouncilEngine / agent indicators.

    Returns an empty DataFrame if input is empty or missing required columns.
    """
    if not candles:
        return pd.DataFrame()

    df = pd.DataFrame(candles)

    required = ("open", "high", "low", "close")
    for col in required:
        if col not in df.columns:
            logger.warning("okx_candles_to_dataframe: missing column '%s'", col)
            return pd.DataFrame()
        df[col] = pd.to_numeric(df[col], errors="coerce")

    if "tick_volume" in df.columns:
        df["tick_volume"] = (
            pd.to_numeric(df["tick_volume"], errors="coerce").fillna(0).astype(int)
        )

    return df.dropna(subset=list(required)).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Instrument scanning
# ---------------------------------------------------------------------------

def fetch_okx_spot_instruments() -> list[dict[str, Any]]:
    """
    Fetch all active SPOT instruments from OKX.
    Uses the public /api/v5/public/instruments endpoint.
    """
    url = f"{OKX_BASE_URL}/api/v5/public/instruments"
    params = {"instType": "SPOT"}
    
    try:
        resp = requests.get(url, params=params, timeout=OKX_TIMEOUT)
        resp.raise_for_status()
        body: dict[str, Any] = resp.json()
    except Exception as exc:
        logger.error("fetch_okx_spot_instruments: request failed -- %s", exc)
        return []

    if str(body.get("code", "")) != "0":
        logger.warning(
            "fetch_okx_spot_instruments: OKX API error code=%s msg=%s",
            body.get("code"), body.get("msg")
        )
        return []

    return body.get("data", [])
