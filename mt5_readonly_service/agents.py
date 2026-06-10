"""
agents.py -- Multi-Agent Analytical Engine (Phase 2 -- Local Multi-Agent Terminal).

Four specialist agents vote independently on a market direction.
The CouncilEngine aggregates votes using hard-veto + soft-quorum rules,
then persists approved signals to the local SQLite database.

Agents:
    TrendAgent      -- EMA(200)            : trend alignment filter  [VETO]
    VolatilityAgent -- Bollinger Bands(20) : price at extreme bands
    MomentumAgent   -- RSI(14)             : oversold / overbought zone
    RiskAgent       -- ATR(14)             : minimum 1:2 RR gate     [VETO]

Voting rules (ALL must hold for a signal to be approved):
    [VETO-1]   TrendAgent must approve.
    [VETO-2]   RiskAgent must approve.
    [QUORUM]   VolatilityAgent OR MomentumAgent must approve (at least one).

Signal strength = fraction of the four agents that approved (0.0 to 1.0).

Read-only contract:
    This module performs analysis and signal storage only.
    No trading execution, no order_send, no account modification of any kind.

Indicator implementation:
    All indicators (EMA, Bollinger Bands, RSI, ATR) are implemented using
    pure pandas / numpy calculations equivalent to standard TA-library output.
    This avoids external TA-library version conflicts on Windows.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests
from sqlalchemy.orm import Session

from database import DecisionJournal, StrategySignal, TripleFirewallSignal

# ---------------------------------------------------------------------------
# Telegram configuration (read from environment — never hardcode tokens)
# ---------------------------------------------------------------------------
_TELEGRAM_TOKEN:   str | None = os.environ.get("TELEGRAM_BOT_TOKEN")
_TELEGRAM_CHAT_ID: str | None = os.environ.get("TELEGRAM_CHAT_ID")
_TELEGRAM_TIMEOUT: float      = 8.0  # seconds

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Indicator constants
# ---------------------------------------------------------------------------

EMA_LENGTH = 200
BB_LENGTH  = 20
BB_STD     = 2.0
RSI_LENGTH = 14
ATR_LENGTH = 14

ATR_SL_MULT = 1.5   # SL placed at entry +/- ATR * ATR_SL_MULT
ATR_TP_MULT = 3.0   # TP placed at entry +/- ATR * ATR_TP_MULT
MIN_RR      = 2.0   # minimum reward-to-risk ratio required by RiskAgent

MIN_CANDLES_EMA = EMA_LENGTH + 10   # 210 bars
MIN_CANDLES_BB  = BB_LENGTH  + 5    # 25 bars
MIN_CANDLES_RSI = RSI_LENGTH + 5    # 19 bars
MIN_CANDLES_ATR = ATR_LENGTH + 5    # 19 bars

# ---------------------------------------------------------------------------
# Runtime configuration (overrides module constants — loaded from SystemConfig
# DB table at analysis time so user changes take effect without restarts)
# ---------------------------------------------------------------------------

_runtime_cfg: dict[str, float] = {}


def _cfg(key: str, default: float | int) -> float | int:
    """Read a config value from the runtime DB dict; fall back to module constant."""
    return _runtime_cfg.get(key, default)


def _refresh_cfg_from_db(db: Session) -> None:
    """
    Query SystemConfig and update _runtime_cfg + Telegram credentials.
    Called once per analyze_market() invocation when a DB session is provided.
    All errors are swallowed — the module-level defaults remain valid.
    """
    global _runtime_cfg, _TELEGRAM_TOKEN, _TELEGRAM_CHAT_ID
    try:
        from database import SystemConfig  # local import — avoids circular at module load
        rows: list[SystemConfig] = db.query(SystemConfig).all()
        numeric: dict[str, float] = {}
        for row in rows:
            if row.key == "telegram_bot_token":
                if row.value:
                    _TELEGRAM_TOKEN = row.value
            elif row.key == "telegram_chat_id":
                if row.value:
                    _TELEGRAM_CHAT_ID = row.value
            else:
                try:
                    numeric[row.key] = float(row.value)
                except (ValueError, TypeError):
                    pass
        _runtime_cfg = numeric
    except Exception as exc:
        logger.warning("_refresh_cfg_from_db: could not load config -- %s", exc)


# ---------------------------------------------------------------------------
# Pure indicator functions (pandas / numpy only)
# ---------------------------------------------------------------------------

def _ema(series: pd.Series, length: int) -> pd.Series:
    """Exponential Moving Average via pandas ewm (span = length)."""
    return series.ewm(span=length, adjust=False).mean()


def _sma(series: pd.Series, length: int) -> pd.Series:
    return series.rolling(window=length, min_periods=length).mean()


def _bollinger(
    series: pd.Series,
    length: int = BB_LENGTH,
    std_dev: float = BB_STD,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (upper_band, middle_band, lower_band)."""
    mid   = _sma(series, length)
    sigma = series.rolling(window=length, min_periods=length).std(ddof=0)
    return mid + std_dev * sigma, mid, mid - std_dev * sigma


def _rsi(series: pd.Series, length: int = RSI_LENGTH) -> pd.Series:
    """RSI using Wilder exponential smoothing -- matches most charting platforms."""
    delta    = series.diff()
    gain     = delta.clip(lower=0.0)
    loss     = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / length, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / length, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0.0, np.nan)
    return 100.0 - 100.0 / (1.0 + rs)


def _atr(
    high:  pd.Series,
    low:   pd.Series,
    close: pd.Series,
    length: int = ATR_LENGTH,
) -> pd.Series:
    """Average True Range using Wilder exponential smoothing."""
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / length, adjust=False).mean()


def _last(series: pd.Series) -> float | None:
    """Most recent non-NaN value, or None if series is all NaN."""
    clean = series.dropna()
    return float(clean.iloc[-1]) if not clean.empty else None


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _bool_to_int(value: bool | None) -> int | None:
    return None if value is None else (1 if value else 0)


# ---------------------------------------------------------------------------
# Market session clock (Baghdad / UTC+3 — no daylight saving)
#
# Standard FX session windows expressed in UTC:
#   Asian (Tokyo)   : 00:00 - 09:00 UTC
#   London          : 08:00 - 17:00 UTC
#   New York        : 13:00 - 22:00 UTC
#   London/NY overlap (highest liquidity for XAUUSD): 13:00 - 17:00 UTC
# ---------------------------------------------------------------------------

BAGHDAD_UTC_OFFSET_HOURS = 3

_SESSION_WINDOWS_UTC: dict[str, tuple[int, int]] = {
    "Asian":    (0, 9),
    "London":   (8, 17),
    "New York": (13, 22),
}

_SESSION_LABELS_AR: dict[str, str] = {
    "Asian":    "الجلسة الآسيوية",
    "London":   "جلسة لندن",
    "New York": "جلسة نيويورك",
}


def get_market_session(now_utc: datetime | None = None) -> dict:
    """
    Return the current FX market session(s) based on UTC time, with the
    equivalent Baghdad local time (UTC+3, no DST).

    This is informational only — used to annotate signals with the
    trading session during which they were generated.
    """
    now = now_utc or datetime.now(timezone.utc)
    hour_utc = now.hour

    active = [
        name for name, (start, end) in _SESSION_WINDOWS_UTC.items()
        if start <= hour_utc < end
    ]

    overlap = "London" in active and "New York" in active

    if overlap:
        label_ar = "تداخل لندن/نيويورك (أعلى سيولة)"
    elif active:
        label_ar = " + ".join(_SESSION_LABELS_AR[a] for a in active)
    else:
        label_ar = "خارج أوقات التداول الرئيسية"

    baghdad_hour = (hour_utc + BAGHDAD_UTC_OFFSET_HOURS) % 24

    return {
        "utc_time":            now.isoformat(),
        "baghdad_hour":        baghdad_hour,
        "active_sessions":     active,
        "is_overlap":          overlap,
        "label_ar":            label_ar,
    }


# ---------------------------------------------------------------------------
# Position sizing — risk % of equity -> normalized lot size
# ---------------------------------------------------------------------------

def calculate_position_size(
    account_equity: float,
    risk_percent: float,
    entry_price: float,
    stop_loss: float,
    *,
    trade_tick_value: float,
    trade_tick_size: float,
    point: float,
    volume_min: float = 0.01,
    volume_max: float = 1000.0,
    volume_step: float = 0.01,
) -> dict:
    """
    Compute a normalized lot size from a risk-percent-of-equity model.

    riskUsd       = account_equity * risk_percent / 100
    pointValue    = trade_tick_value * (point / trade_tick_size)
    slDistPoints  = |entry - stop_loss| / point
    rawLot        = riskUsd / (slDistPoints * pointValue)

    The result is rounded to volume_step and clipped to [volume_min, volume_max].
    Returns a dict with raw/normalized lot, riskUsd, and any warnings —
    never raises.
    """
    warnings: list[str] = []

    risk_usd = account_equity * risk_percent / 100.0
    if risk_usd <= 0:
        warnings.append("riskUsd <= 0 -- account_equity أو risk_percent غير صالح")
        return {"raw_lot": 0.0, "normalized_lot": 0.0, "risk_usd": risk_usd, "warnings": warnings}

    if point <= 0 or trade_tick_value <= 0 or trade_tick_size <= 0:
        warnings.append("خصائص الرمز غير صالحة (point/tick_value/tick_size) -- لا يمكن حساب اللوت")
        return {"raw_lot": 0.0, "normalized_lot": 0.0, "risk_usd": risk_usd, "warnings": warnings}

    sl_dist_points = abs(entry_price - stop_loss) / point
    if sl_dist_points <= 0:
        warnings.append("المسافة بين الدخول ووقف الخسارة = صفر -- لا يمكن حساب اللوت")
        return {"raw_lot": 0.0, "normalized_lot": 0.0, "risk_usd": risk_usd, "warnings": warnings}

    point_value_per_lot = trade_tick_value * (point / trade_tick_size)
    risk_per_lot = sl_dist_points * point_value_per_lot
    if risk_per_lot <= 0:
        warnings.append("risk_per_lot = صفر -- لا يمكن حساب اللوت")
        return {"raw_lot": 0.0, "normalized_lot": 0.0, "risk_usd": risk_usd, "warnings": warnings}

    raw_lot = risk_usd / risk_per_lot

    step = volume_step if volume_step > 0 else 0.01
    normalized = round(raw_lot / step) * step

    if normalized < volume_min:
        warnings.append(f"اللوت {normalized:.4f} أقل من الحد الأدنى {volume_min} -- تم التقريب للحد الأدنى")
        normalized = volume_min
    if volume_max > 0 and normalized > volume_max:
        warnings.append(f"اللوت {normalized:.4f} أكبر من الحد الأقصى {volume_max} -- تم التقريب للحد الأقصى")
        normalized = volume_max

    return {
        "raw_lot":        round(raw_lot, 4),
        "normalized_lot": round(normalized, 4),
        "risk_usd":       round(risk_usd, 2),
        "sl_dist_points": round(sl_dist_points, 2),
        "warnings":       warnings,
    }


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class AgentVote:
    """Single agent decision on one direction."""
    agent:      str
    direction:  str         # "BUY" or "SELL"
    approved:   bool
    confidence: float       # 0.0 - 1.0; always 0.0 when not approved
    reason:     str
    metadata:   dict = field(default_factory=dict)


@dataclass
class CouncilVerdict:
    """Final analytical output of the CouncilEngine for one symbol run."""
    symbol:          str
    direction:       str | None      # "BUY" | "SELL" | None (rejected)
    approved:        bool
    signal_strength: float           # fraction of agents that approved (0.0 - 1.0)
    votes:           list[AgentVote]
    sl:              float | None = None
    tp:              float | None = None
    atr:             float | None = None
    confluence:      dict | None = None       # Triple Firewall confluence rating
    session:         dict | None = None       # Market session clock (Baghdad UTC+3)
    timestamp:       datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    def votes_summary(self) -> dict[str, bool]:
        return {v.agent: v.approved for v in self.votes}


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

class TrendAgent:
    """
    EMA(200) trend alignment filter -- VETO power.

    BUY  approved when: close > EMA(200)
    SELL approved when: close < EMA(200)

    Confidence scales with the percentage distance from EMA(200):
        0.5 at EMA touch, 1.0 at 1% distance or more.
    """

    NAME = "TrendAgent"

    def vote(self, direction: str, df: pd.DataFrame) -> AgentVote:
        if len(df) < MIN_CANDLES_EMA:
            return AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason=(
                    f"بيانات غير كافية -- يلزم {MIN_CANDLES_EMA} شمعة "
                    f"(متوفر: {len(df)})"
                ),
            )

        ema200 = _last(_ema(df["close"], int(_cfg("ema_length", EMA_LENGTH))))
        close  = _last(df["close"])

        if ema200 is None or close is None:
            return AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason="فشل حساب EMA(200) -- قيمة NaN",
            )

        price_above = close > ema200
        approved    = price_above if direction == "BUY" else not price_above

        distance_pct = abs(close - ema200) / ema200
        confidence   = _clamp(0.5 + distance_pct * 50.0, 0.5, 1.0) if approved else 0.0

        side_ar = "فوق" if price_above else "تحت"
        reason  = (
            f"السعر {close:.5f} {side_ar} EMA(200) = {ema200:.5f} "
            f"(بُعد {distance_pct * 100:.3f}%)"
        )

        return AgentVote(
            agent=self.NAME, direction=direction,
            approved=approved, confidence=confidence,
            reason=reason,
            metadata={"close": close, "ema200": ema200, "distance_pct": distance_pct},
        )


class VolatilityAgent:
    """
    Bollinger Bands(20, 2) extreme-touch filter.

    BUY  approved when: close <= lower_band
    SELL approved when: close >= upper_band

    Confidence scales with penetration depth relative to band width.
    """

    NAME = "VolatilityAgent"

    def vote(self, direction: str, df: pd.DataFrame) -> AgentVote:
        if len(df) < MIN_CANDLES_BB:
            return AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason=(
                    f"بيانات غير كافية -- يلزم {MIN_CANDLES_BB} شمعة "
                    f"(متوفر: {len(df)})"
                ),
            )

        upper_s, _, lower_s = _bollinger(
            df["close"],
            int(_cfg("bb_length", BB_LENGTH)),
            float(_cfg("bb_std", BB_STD)),
        )
        upper = _last(upper_s)
        lower = _last(lower_s)
        close = _last(df["close"])

        if upper is None or lower is None or close is None:
            return AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason="فشل حساب Bollinger Bands -- قيمة NaN",
            )

        band_width = max(upper - lower, 1e-10)

        if direction == "BUY":
            approved    = close <= lower
            penetration = max(0.0, (lower - close) / band_width)
            band_label  = "السفلي"
            band_val    = lower
        else:
            approved    = close >= upper
            penetration = max(0.0, (close - upper) / band_width)
            band_label  = "العلوي"
            band_val    = upper

        confidence = _clamp(0.5 + penetration * 2.0, 0.5, 1.0) if approved else 0.0

        if approved:
            reason = (
                f"السعر {close:.5f} عند/خارج الحد {band_label} ({band_val:.5f}), "
                f"اختراق {penetration * 100:.2f}% من عرض النطاق ({band_width:.5f})"
            )
        else:
            reason = f"السعر {close:.5f} لم يصل للحد {band_label} ({band_val:.5f})"

        return AgentVote(
            agent=self.NAME, direction=direction,
            approved=approved, confidence=confidence,
            reason=reason,
            metadata={"close": close, "bb_upper": upper, "bb_lower": lower},
        )


class MomentumAgent:
    """
    RSI(14) momentum extreme filter.

    BUY  approved when: RSI < 30  (oversold zone)
    SELL approved when: RSI > 70  (overbought zone)

    Confidence scales with distance from the threshold (30 or 70).
    """

    NAME = "MomentumAgent"

    def vote(self, direction: str, df: pd.DataFrame) -> AgentVote:
        if len(df) < MIN_CANDLES_RSI:
            return AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason=(
                    f"بيانات غير كافية -- يلزم {MIN_CANDLES_RSI} شمعة "
                    f"(متوفر: {len(df)})"
                ),
            )

        rsi_val = _last(_rsi(df["close"], int(_cfg("rsi_length", RSI_LENGTH))))

        if rsi_val is None:
            return AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason="فشل حساب RSI(14) -- قيمة NaN",
            )

        if direction == "BUY":
            approved   = rsi_val < 30.0
            distance   = (30.0 - rsi_val) / 30.0 if approved else 0.0
            zone_label = "تشبع بيع (Oversold)" if rsi_val < 30 else "محايد أو تشبع شراء"
        else:
            approved   = rsi_val > 70.0
            distance   = (rsi_val - 70.0) / 30.0 if approved else 0.0
            zone_label = "تشبع شراء (Overbought)" if rsi_val > 70 else "محايد أو تشبع بيع"

        confidence = _clamp(0.5 + distance * 0.5, 0.5, 1.0) if approved else 0.0

        reason = f"RSI(14) = {rsi_val:.2f} -- {zone_label}"
        if approved:
            reason += f" (بُعد {distance * 100:.1f}% من حد التشبع)"

        return AgentVote(
            agent=self.NAME, direction=direction,
            approved=approved, confidence=confidence,
            reason=reason,
            metadata={"rsi": rsi_val},
        )


class RiskAgent:
    """
    ATR(14)-based Risk/Reward gate -- VETO power.

    SL = entry -/+ ATR * ATR_SL_MULT   (1.5x ATR)
    TP = entry +/- ATR * ATR_TP_MULT   (3.0x ATR)
    RR = ATR_TP_MULT / ATR_SL_MULT     (2.0 by construction)

    Approval requires RR >= MIN_RR (2.0).

    Returns (AgentVote, sl, tp, atr) so the CouncilEngine can embed
    the price levels in the CouncilVerdict.
    """

    NAME = "RiskAgent"

    def vote(
        self,
        direction: str,
        df: pd.DataFrame,
    ) -> tuple[AgentVote, float | None, float | None, float | None]:
        if len(df) < MIN_CANDLES_ATR:
            vote = AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason=(
                    f"بيانات غير كافية -- يلزم {MIN_CANDLES_ATR} شمعة "
                    f"(متوفر: {len(df)})"
                ),
            )
            return vote, None, None, None

        _atr_len  = int(_cfg("atr_length",  ATR_LENGTH))
        _sl_mult  = float(_cfg("atr_sl_mult", ATR_SL_MULT))
        _tp_mult  = float(_cfg("atr_tp_mult", ATR_TP_MULT))
        _min_rr   = float(_cfg("min_rr",      MIN_RR))

        atr_val = _last(_atr(df["high"], df["low"], df["close"], _atr_len))
        close   = _last(df["close"])

        if atr_val is None or atr_val <= 0.0 or close is None:
            vote = AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason="فشل حساب ATR أو القيمة صفر",
            )
            return vote, None, None, None

        sl_dist = atr_val * _sl_mult
        tp_dist = atr_val * _tp_mult
        rr      = tp_dist / sl_dist

        if direction == "BUY":
            sl = close - sl_dist
            tp = close + tp_dist
        else:
            sl = close + sl_dist
            tp = close - tp_dist

        approved   = rr >= _min_rr
        confidence = _clamp(rr / (_min_rr * 2.0), 0.0, 1.0) if approved else 0.0

        rr_verdict = "موافق -- يتجاوز 1:2" if approved else "مرفوض -- دون الحد 1:2"
        reason = (
            f"ATR(14) = {atr_val:.5f} | "
            f"SL = {sl:.5f} | "
            f"TP = {tp:.5f} | "
            f"RR = {rr:.2f} ({rr_verdict})"
        )

        vote = AgentVote(
            agent=self.NAME, direction=direction,
            approved=approved, confidence=confidence,
            reason=reason,
            metadata={"atr": atr_val, "sl": sl, "tp": tp, "rr": rr},
        )
        return vote, sl, tp, atr_val


# ---------------------------------------------------------------------------
# Council Engine
# ---------------------------------------------------------------------------

class CouncilEngine:
    """
    Orchestrates the four-agent vote and issues analytical signals.

    Voting rules (ALL must hold):
        [VETO-1]   TrendAgent must approve.
        [VETO-2]   RiskAgent must approve.
        [QUORUM]   VolatilityAgent OR MomentumAgent must approve.

    If both BUY and SELL pass (unusual), the direction with higher
    signal_strength wins; BUY is preferred on an exact tie.

    Persistence:
        When a signal is approved and a SQLAlchemy Session is supplied,
        the signal is written to StrategySignal.  The caller must call
        db.commit() afterwards -- this method only flushes.
    """

    def __init__(self) -> None:
        self._trend      = TrendAgent()
        self._volatility = VolatilityAgent()
        self._momentum   = MomentumAgent()
        self._risk       = RiskAgent()

    # -- private helpers --------------------------------------------------

    def _evaluate(self, direction: str, df: pd.DataFrame) -> CouncilVerdict:
        """Run all four agents for one direction and apply voting rules."""
        symbol = str(df.attrs.get("symbol", "UNKNOWN"))

        trend_vote                       = self._trend.vote(direction, df)
        volatility_vote                  = self._volatility.vote(direction, df)
        momentum_vote                    = self._momentum.vote(direction, df)
        risk_vote, sl, tp, atr           = self._risk.vote(direction, df)

        all_votes = [trend_vote, volatility_vote, momentum_vote, risk_vote]

        veto_ok   = trend_vote.approved and risk_vote.approved
        quorum_ok = volatility_vote.approved or momentum_vote.approved
        approved  = veto_ok and quorum_ok

        n_approved      = sum(v.approved for v in all_votes)
        signal_strength = n_approved / len(all_votes)

        # -- Triple Firewall confluence rating --------------------------------
        # The three independent "firewalls": trend (EMA200), volatility (BB
        # extreme), momentum (RSI extreme). RiskAgent is excluded -- it is a
        # SL/TP/RR gate, not a directional firewall.
        firewalls = {
            "trend":      trend_vote.approved,
            "volatility": volatility_vote.approved,
            "momentum":   momentum_vote.approved,
        }
        aligned = sum(firewalls.values())
        if aligned == 3:
            confluence_level = "STRONG"
        elif aligned == 2:
            confluence_level = "MEDIUM"
        elif aligned == 1:
            confluence_level = "WEAK"
        else:
            confluence_level = "NONE"

        confluence = {
            "level":         confluence_level,
            "aligned_count": aligned,
            "firewalls":     firewalls,
        }

        return CouncilVerdict(
            symbol          = symbol,
            direction       = direction if approved else None,
            approved        = approved,
            signal_strength = signal_strength,
            votes           = all_votes,
            sl              = sl if approved else None,
            tp              = tp if approved else None,
            atr             = atr,
            confluence      = confluence,
        )

    def _persist(self, verdict: CouncilVerdict, db: Session) -> None:
        """Write verdict to SQLite.
        - Always saves to DecisionJournal (approved + rejected history).
        - Only saves to StrategySignal when verdict.approved is True.
        """
        try:
            signal_id: str | None = None

            if verdict.approved:
                record = StrategySignal(
                    symbol     = verdict.symbol,
                    signal     = verdict.direction or "NEUTRAL",
                    confidence = round(verdict.signal_strength, 4),
                    status     = "PENDING",
                    timestamp  = verdict.timestamp,
                )
                db.add(record)
                db.flush()
                signal_id = str(record.id)

            context_payload = json.dumps({
                "symbol":          verdict.symbol,
                "direction":       verdict.direction,
                "signal_strength": round(verdict.signal_strength, 4),
                "sl":              round(verdict.sl,  5) if verdict.sl  is not None else None,
                "tp":              round(verdict.tp,  5) if verdict.tp  is not None else None,
                "atr":             round(verdict.atr, 5) if verdict.atr is not None else None,
                "confluence":      verdict.confluence,
                "session":         verdict.session,
            }, ensure_ascii=False)

            votes_payload = json.dumps({
                v.agent: {
                    "approved":   v.approved,
                    "confidence": round(v.confidence, 4),
                    "reason":     v.reason,
                    "direction":  v.direction,
                }
                for v in verdict.votes
            }, ensure_ascii=False)

            journal = DecisionJournal(
                trade_id     = signal_id,
                context      = context_payload,
                agents_votes = votes_payload,
                result       = "APPROVED" if verdict.approved else "REJECTED",
                timestamp    = verdict.timestamp,
            )
            db.add(journal)
            db.flush()

            confluence = verdict.confluence or {}
            firewalls  = confluence.get("firewalls", {})
            session    = verdict.session or {}
            risk_vote  = next((v for v in verdict.votes if v.agent == RiskAgent.NAME), None)
            rr         = risk_vote.metadata.get("rr") if risk_vote else None

            tf_record = TripleFirewallSignal(
                symbol              = verdict.symbol,
                direction           = verdict.direction,
                approved            = 1 if verdict.approved else 0,
                signal_strength     = round(verdict.signal_strength, 4),
                confluence_level    = confluence.get("level"),
                aligned_count       = confluence.get("aligned_count"),
                firewall_trend      = _bool_to_int(firewalls.get("trend")),
                firewall_volatility = _bool_to_int(firewalls.get("volatility")),
                firewall_momentum   = _bool_to_int(firewalls.get("momentum")),
                sl                  = round(verdict.sl,  5) if verdict.sl  is not None else None,
                tp                  = round(verdict.tp,  5) if verdict.tp  is not None else None,
                atr                 = round(verdict.atr, 5) if verdict.atr is not None else None,
                rr                  = round(rr, 4) if rr is not None else None,
                session_label       = session.get("label_ar"),
                baghdad_hour        = session.get("baghdad_hour"),
                timestamp           = verdict.timestamp,
            )
            db.add(tf_record)
            db.flush()

            logger.info(
                "CouncilEngine: persisted -- symbol=%s direction=%s "
                "strength=%.0f%% signal_id=%s approved=%s",
                verdict.symbol, verdict.direction,
                verdict.signal_strength * 100, signal_id, verdict.approved,
            )
        except Exception as exc:
            logger.error("CouncilEngine: DB write failed: %s", exc)
            db.rollback()

    def _send_telegram_alert(self, verdict: CouncilVerdict) -> None:
        """Send an Arabic Telegram notification for an approved signal.
        Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from environment.
        Never raises — errors are logged and silently discarded.
        """
        if not _TELEGRAM_TOKEN or not _TELEGRAM_CHAT_ID:
            logger.debug("Telegram not configured — skipping alert for %s", verdict.symbol)
            return

        try:
            # Compute entry from SL + ATR (mirrors ATR_SL_MULT in agents.py)
            atr_sl_mult = 1.5
            entry: float | None = None
            if verdict.sl is not None and verdict.atr is not None:
                if verdict.direction == "BUY":
                    entry = verdict.sl + atr_sl_mult * verdict.atr
                elif verdict.direction == "SELL":
                    entry = verdict.sl - atr_sl_mult * verdict.atr

            entry_str = f"{entry:.5f}" if entry is not None else "غير محسوب"
            sl_str    = f"{verdict.sl:.5f}" if verdict.sl is not None else "—"
            tp_str    = f"{verdict.tp:.5f}" if verdict.tp is not None else "—"
            strength  = round(verdict.signal_strength * 100, 1)

            text = (
                f"<b>إشارة جديدة — مجلس وكلاء النظام</b>\n"
                f"الرمز: <code>{verdict.symbol}</code>  |  الاتجاه: <b>{verdict.direction}</b>\n"
                f"قوة التصويت: <b>{strength}%</b>\n"
                f"الدخول المتوقع: <code>{entry_str}</code>\n"
                f"وقف الخسارة (SL): <code>{sl_str}</code>  |  الهدف (TP): <code>{tp_str}</code>\n"
                f"<i>نظام محكوم بالقواعد — تحليل معلوماتي فقط — ليس توصية مالية</i>"
            )

            resp = requests.post(
                f"https://api.telegram.org/bot{_TELEGRAM_TOKEN}/sendMessage",
                json={"chat_id": _TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
                timeout=_TELEGRAM_TIMEOUT,
            )
            if not resp.ok:
                logger.warning(
                    "Telegram alert HTTP %s: %s", resp.status_code, resp.text[:200]
                )
            else:
                logger.info(
                    "Telegram alert sent -- symbol=%s direction=%s",
                    verdict.symbol, verdict.direction,
                )
        except Exception as exc:
            logger.warning("Telegram alert failed (non-fatal): %s", exc)

    # -- public API -------------------------------------------------------

    def analyze_market(
        self,
        symbol:     str,
        candles_df: pd.DataFrame,
        db:         Session | None = None,
    ) -> CouncilVerdict:
        """
        Run the full agent-council analysis for a given symbol.

        Parameters
        ----------
        symbol : str
            Trading symbol identifier (e.g. "XAUUSD").
        candles_df : pd.DataFrame
            OHLCV DataFrame sorted oldest-first with columns:
                open, high, low, close, tick_volume
            Minimum 210 rows recommended (EMA 200 requirement).
        db : Session | None
            Optional SQLAlchemy session for persistence.
            If provided and signal is approved, the signal is stored.
            The caller must call db.commit() afterwards.

        Returns
        -------
        CouncilVerdict
            direction = "BUY" | "SELL" if approved, None if rejected.
            Includes per-agent votes, signal_strength, sl, tp, atr.
        """
        # Refresh indicator params + Telegram credentials from DB on every run
        if db is not None:
            _refresh_cfg_from_db(db)

        if candles_df is None or candles_df.empty:
            logger.warning(
                "CouncilEngine.analyze_market: empty DataFrame for %s", symbol
            )
            return CouncilVerdict(
                symbol=symbol, direction=None, approved=False,
                signal_strength=0.0, votes=[],
            )

        required_cols = {"open", "high", "low", "close"}
        missing = required_cols - set(candles_df.columns)
        if missing:
            logger.error(
                "CouncilEngine: DataFrame missing columns %s for %s", missing, symbol
            )
            return CouncilVerdict(
                symbol=symbol, direction=None, approved=False,
                signal_strength=0.0, votes=[],
            )

        df = candles_df.copy()
        df.attrs["symbol"] = symbol

        buy_verdict  = self._evaluate("BUY",  df)
        sell_verdict = self._evaluate("SELL", df)

        # Select winner
        if buy_verdict.approved and sell_verdict.approved:
            winner = (
                buy_verdict
                if buy_verdict.signal_strength >= sell_verdict.signal_strength
                else sell_verdict
            )
            logger.warning(
                "CouncilEngine: both BUY and SELL approved for %s -- "
                "choosing %s (BUY=%.0f%% SELL=%.0f%%)",
                symbol,
                winner.direction,
                buy_verdict.signal_strength * 100,
                sell_verdict.signal_strength * 100,
            )
        elif buy_verdict.approved:
            winner = buy_verdict
        elif sell_verdict.approved:
            winner = sell_verdict
        else:
            # Return the stronger rejected verdict for diagnostic purposes
            winner = (
                buy_verdict
                if buy_verdict.signal_strength >= sell_verdict.signal_strength
                else sell_verdict
            )
            winner.direction = None
            winner.approved  = False

        winner.session = get_market_session()

        if winner.approved:
            logger.info(
                "CouncilEngine: SIGNAL APPROVED -- symbol=%s direction=%s "
                "strength=%.0f%% votes=%s",
                symbol,
                winner.direction,
                winner.signal_strength * 100,
                winner.votes_summary(),
            )
            self._send_telegram_alert(winner)
        else:
            logger.debug(
                "CouncilEngine: signal rejected -- symbol=%s "
                "BUY=%.0f%% SELL=%.0f%%",
                symbol,
                buy_verdict.signal_strength * 100,
                sell_verdict.signal_strength * 100,
            )

        # Always persist to DecisionJournal (approved + rejected history)
        if db is not None:
            self._persist(winner, db)

        return winner


# ---------------------------------------------------------------------------
# Helper: MT5 candle dicts -> DataFrame
# ---------------------------------------------------------------------------

def candles_to_dataframe(candles: list[dict]) -> pd.DataFrame:
    """
    Convert the candle list from /readonly/candles into an analysis DataFrame.

    Expected dict keys (from MT5 bridge):
        symbol, timeframe, time, open, high, low, close, tick_volume

    Returns an empty DataFrame if input is empty or malformed.
    """
    if not candles:
        return pd.DataFrame()

    df = pd.DataFrame(candles)

    for col in ("open", "high", "low", "close"):
        if col not in df.columns:
            return pd.DataFrame()
        df[col] = pd.to_numeric(df[col], errors="coerce")

    if "tick_volume" in df.columns:
        df["tick_volume"] = (
            pd.to_numeric(df["tick_volume"], errors="coerce").fillna(0).astype(int)
        )

    if "time" in df.columns:
        df = df.sort_values("time", ascending=True).reset_index(drop=True)

    return df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
