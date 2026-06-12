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
MIN_RR_HARD_FLOOR = 2.0   # حد أدنى صارم لـ RR لا يمكن تجاوزه عبر system_config (فيتو RiskAgent دونه)

MAX_RISK_PERCENT = 3.0   # أقصى نسبة مخاطرة من رأس المال لكل صفقة (سقف صارم 3%)

SIGNAL_COOLDOWN_HOURS = 4.0   # فترة تهدئة بين إشارتين متطابقتين (نفس الرمز + الاتجاه)

DEFAULT_CONTRACT_SIZE = 100_000.0   # حجم العقد القياسي للفوركس (احتياطي عند غياب tick_value/tick_size)

SWING_LOOKBACK = 30   # نطاق البحث عن آخر قمة/قاع تأرجحي وكتلة تنفيذية (Order Block)
SWING_STRENGTH = 2    # عدد الشموع على كل جانب لتأكيد القمة/القاع التأرجحي (فركتل)

MIN_CANDLES_EMA = EMA_LENGTH + 10   # 210 bars
MIN_CANDLES_BB  = BB_LENGTH  + 5    # 25 bars
MIN_CANDLES_RSI = RSI_LENGTH + 5    # 19 bars
MIN_CANDLES_ATR = ATR_LENGTH + 5    # 19 bars

# ---------------------------------------------------------------------------
# Runtime configuration (overrides module constants — loaded from SystemConfig
# DB table at analysis time so user changes take effect without restarts)
# ---------------------------------------------------------------------------

_runtime_cfg: dict[str, float] = {}

# In-memory cooldown tracker: (symbol, direction) -> last alert timestamp (UTC).
# Resets on service restart -- acceptable for a radar-style duplicate-signal guard.
_LAST_SIGNAL_ALERT_TIMES: dict[tuple[str, str], datetime] = {}


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


def is_market_open(symbol: str, now_utc: datetime | None = None) -> bool:
    """
    Check if the market is open for a given symbol.
    Crypto is open 24/7.
    Forex/Indices/Metals are closed from Friday 21:00 UTC to Sunday 21:00 UTC,
    and also closed when no major session is active.
    """
    sym = symbol.upper()
    crypto_keywords = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "LTC", "ADA", "DOT", "MATIC"]
    if any(k in sym for k in crypto_keywords) or "CRYPTO" in sym:
        return True
        
    now = now_utc or datetime.now(timezone.utc)
    wd = now.weekday()
    hour = now.hour
    
    # Friday is 4. Closed after 21:00 UTC.
    if wd == 4 and hour >= 21:
        return False
    # Saturday is 5. Always closed.
    if wd == 5:
        return False
    # Sunday is 6. Closed before 21:00 UTC.
    if wd == 6 and hour < 21:
        return False
        
    # Forex is only active during major exchanges
    active = [
        name for name, (start, end) in _SESSION_WINDOWS_UTC.items()
        if start <= hour < end
    ]
    if not active:
        return False
        
    return True


def notify_market_open() -> None:
    """Send a broadcast notification to the bot when the market opens."""
    if not _TELEGRAM_TOKEN or not _TELEGRAM_CHAT_ID:
        return
    text = (
        "🔔 <b>إشعار افتتاح السوق</b>\n\n"
        "السوق الآن مفتوح!\n"
        "أوقات التداول: من الإثنين إلى الجمعة (بتوقيت الخادم).\n"
        "العملات الرقمية (Crypto) متاحة للتداول 24/7."
    )
    try:
        import requests
        requests.post(
            f"https://api.telegram.org/bot{_TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": _TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=8.0,
        )
    except Exception as exc:
        logger.warning("Telegram market open alert failed: %s", exc)

def notify_market_closed() -> None:
    if not _TELEGRAM_TOKEN or not _TELEGRAM_CHAT_ID:
        return
    text = (
        "🔕 <b>السوق مغلق الآن</b>\n\n"
        "تم إيقاف إرسال التوصيات لأسواق الفوركس والمعادن لأن السوق مغلق.\n"
        "سوق الكريبتو (Crypto) مستمر 24/7."
    )
    try:
        import requests
        requests.post(
            f"https://api.telegram.org/bot{_TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": _TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=8.0,
        )
    except Exception as exc:
        logger.warning("Telegram market closed alert failed: %s", exc)

def notify_session_opened(sessions: list[str]) -> None:
    if not _TELEGRAM_TOKEN or not _TELEGRAM_CHAT_ID:
        return
    
    labels = []
    for s in sessions:
        label = _SESSION_LABELS_AR.get(s, s)
        labels.append(label)
    
    text = f"🔔 <b>افتتاح بورصة جديدة</b>\n\nتم افتتاح: {', '.join(labels)}."
    
    try:
        import requests
        requests.post(
            f"https://api.telegram.org/bot{_TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": _TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=8.0,
        )
    except Exception as exc:
        logger.warning("Telegram session open alert failed: %s", exc)



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
    contract_size: float = DEFAULT_CONTRACT_SIZE,
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

    If trade_tick_value/trade_tick_size are unavailable (0), falls back to the
    standard forex formula using contract_size:
        pointValue = point * contract_size

    The result is rounded to volume_step and clipped to [volume_min, volume_max].
    Returns a dict with raw/normalized lot, riskUsd, and any warnings —
    never raises.
    """
    warnings: list[str] = []

    risk_usd = account_equity * risk_percent / 100.0
    if risk_usd <= 0:
        warnings.append("riskUsd <= 0 -- account_equity أو risk_percent غير صالح")
        return {"raw_lot": 0.0, "normalized_lot": 0.0, "risk_usd": risk_usd, "warnings": warnings}

    if point <= 0:
        warnings.append("نقطة السعر (point) غير صالحة -- لا يمكن حساب اللوت")
        return {"raw_lot": 0.0, "normalized_lot": 0.0, "risk_usd": risk_usd, "warnings": warnings}

    sl_dist_points = abs(entry_price - stop_loss) / point
    if sl_dist_points <= 0:
        warnings.append("المسافة بين الدخول ووقف الخسارة = صفر -- لا يمكن حساب اللوت")
        return {"raw_lot": 0.0, "normalized_lot": 0.0, "risk_usd": risk_usd, "warnings": warnings}

    if trade_tick_value > 0 and trade_tick_size > 0:
        point_value_per_lot = trade_tick_value * (point / trade_tick_size)
    else:
        # احتياطي: معادلة الفوركس القياسية بحجم العقد عند غياب tick_value/tick_size
        warnings.append(
            f"tick_value/tick_size غير متاحة -- استُخدمت معادلة احتياطية بحجم عقد {contract_size:.0f}"
        )
        point_value_per_lot = point * contract_size

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
    entry:           float | None = None
    sl:              float | None = None
    tp:              float | None = None
    theoretical_sl:  float | None = None     # مستوى SL نظري (RiskAgent) -- يُعرض حتى عند WAIT
    theoretical_tp:  float | None = None     # مستوى TP نظري (RiskAgent) -- يُعرض حتى عند WAIT
    atr:             float | None = None
    risk_amount:     float | None = None
    risk_percent:    float | None = None      # نسبة المخاطرة المستخدمة من رأس المال (1-3%)
    profit_amount:   float | None = None
    lot_size:        float | None = None
    digits:          int | None = None        # دقة سعر الرمز في MT5 (symbol_info.digits)
    duration:        str | None = None
    timeframe:       str | None = None
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
    Market Structure (ICT) trend alignment filter -- VETO power.

    BUY  approved when: Bullish BOS is detected or Bullish FVG exists recently.
    SELL approved when: Bearish BOS is detected or Bearish FVG exists recently.
    """

    NAME = "TrendAgent"

    def _detect_fvg_bos(self, df: pd.DataFrame) -> dict:
        """Helper to detect ICT elements on the most recent candles."""
        c1 = df.iloc[-3]
        c2 = df.iloc[-2]
        c3 = df.iloc[-1]

        bullish_fvg = bool((c3['low'] > c1['high']) and (c2['close'] > c2['open']))
        bearish_fvg = bool((c3['high'] < c1['low']) and (c2['close'] < c2['open']))

        # Simplified Break of Structure (BOS) over a 20-candle lookback
        recent_window = df.iloc[-20:-1]
        recent_high = recent_window['high'].max()
        recent_low = recent_window['low'].min()
        
        bullish_bos = bool(c3['close'] > recent_high)
        bearish_bos = bool(c3['close'] < recent_low)

        # Fallback EMAs for general trend
        ema50 = df['close'].ewm(span=50, adjust=False).mean().iloc[-1] if len(df) >= 50 else c3['close']
        ema200 = df['close'].ewm(span=200, adjust=False).mean().iloc[-1] if len(df) >= 200 else c3['close']

        return {
            "bullish_fvg": bullish_fvg,
            "bearish_fvg": bearish_fvg,
            "bullish_bos": bullish_bos,
            "bearish_bos": bearish_bos,
            "recent_high": recent_high,
            "recent_low": recent_low,
            "close": c3['close'],
            "ema50": ema50,
            "ema200": ema200
        }

    def _find_swing_points(
        self, df: pd.DataFrame, lookback: int, strength: int,
    ) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
        """
        رصد القمم والقيعان التأرجحية (Swing Highs/Lows) عبر فركتل بسيط:
        الشمعة i تُعتبر قمة تأرجحية إذا كان ارتفاعها أعلى من (أو يساوي) ارتفاع
        `strength` شموع قبلها و`strength` شموع بعدها (والعكس للقاع التأرجحي).
        تُستثنى آخر `strength` شمعة لعدم وجود تأكيد كافٍ بعدها بعد.
        """
        n = len(df)
        highs = df["high"].to_numpy()
        lows  = df["low"].to_numpy()

        start = max(strength, n - lookback - strength)
        end   = n - strength  # استثناء الشموع الأخيرة غير المؤكدة

        swing_highs: list[tuple[int, float]] = []
        swing_lows:  list[tuple[int, float]] = []

        for i in range(start, end):
            h_window = highs[i - strength: i + strength + 1]
            l_window = lows[i - strength: i + strength + 1]
            if highs[i] == h_window.max():
                swing_highs.append((i, float(highs[i])))
            if lows[i] == l_window.min():
                swing_lows.append((i, float(lows[i])))

        return swing_highs, swing_lows

    def _detect_liquidity_sweep(
        self,
        df: pd.DataFrame,
        swing_highs: list[tuple[int, float]],
        swing_lows: list[tuple[int, float]],
    ) -> dict:
        """
        رصد سحب السيولة (Liquidity Sweep / Stop Hunt):
        تجاوز ذيل الشمعة الحالية (High أو Low) لآخر قمة/قاع تأرجحي سابق
        (سحب أوامر وقف الخسارة المتراكمة)، مع إغلاق جسم الشمعة قسرياً
        داخل النطاق السعري القديم -- كسر كاذب (False Breakout) يُعد
        إشارة انعكاس مؤسسية قوية.
        """
        c = df.iloc[-1]
        result = {
            "bullish_sweep": False,
            "bearish_sweep": False,
            "swept_low":  None,
            "swept_high": None,
        }

        if swing_lows:
            swept_low = swing_lows[-1][1]
            if c["low"] < swept_low and c["close"] > swept_low:
                result["bullish_sweep"] = True
                result["swept_low"] = round(float(swept_low), 5)

        if swing_highs:
            swept_high = swing_highs[-1][1]
            if c["high"] > swept_high and c["close"] < swept_high:
                result["bearish_sweep"] = True
                result["swept_high"] = round(float(swept_high), 5)

        return result

    def _detect_order_blocks(self, df: pd.DataFrame, lookback: int) -> dict:
        """
        رصد الكتل التنفيذية (Order Blocks):
        - Bullish OB: آخر شمعة هابطة قبل حركة صعودية عنيفة كسرت أعلى نطاق سابق
          (Break of Structure صاعد).
        - Bearish OB: آخر شمعة صاعدة قبل حركة هبوطية عنيفة كسرت أدنى نطاق سابق
          (Break of Structure هابط).
        كما يُحدَّد ما إذا كان السعر الحالي قد عاد لاختبار (Mitigation) هذه
        الكتلة -- منطقة دخول عالية الاحتمالية.
        """
        result = {
            "bullish_ob_high": None, "bullish_ob_low": None, "bullish_ob_mitigated": False,
            "bearish_ob_high": None, "bearish_ob_low": None, "bearish_ob_mitigated": False,
        }

        n = len(df)
        window_size = min(lookback, n - 1)
        if window_size < 3:
            return result

        window = df.iloc[-window_size - 1: -1]  # استثناء الشمعة الحالية
        highs  = window["high"].to_numpy()
        lows   = window["low"].to_numpy()
        opens  = window["open"].to_numpy()
        closes = window["close"].to_numpy()

        # Bullish OB: آخر اختراق صعودي عنيف (إغلاق أعلى من أعلى ما سبقه)
        for i in range(len(window) - 1, 0, -1):
            prior_high = highs[:i].max()
            if closes[i] > opens[i] and closes[i] > prior_high:
                j = i - 1
                while j >= 0 and closes[j] > opens[j]:
                    j -= 1
                if j >= 0:
                    result["bullish_ob_high"] = round(float(highs[j]), 5)
                    result["bullish_ob_low"]  = round(float(lows[j]), 5)
                break

        # Bearish OB: آخر اختراق هبوطي عنيف (إغلاق أدنى من أدنى ما سبقه)
        for i in range(len(window) - 1, 0, -1):
            prior_low = lows[:i].min()
            if closes[i] < opens[i] and closes[i] < prior_low:
                j = i - 1
                while j >= 0 and closes[j] < opens[j]:
                    j -= 1
                if j >= 0:
                    result["bearish_ob_high"] = round(float(highs[j]), 5)
                    result["bearish_ob_low"]  = round(float(lows[j]), 5)
                break

        c = df.iloc[-1]
        if result["bullish_ob_high"] is not None:
            result["bullish_ob_mitigated"] = bool(
                c["low"] <= result["bullish_ob_high"] and c["close"] >= result["bullish_ob_low"]
            )
        if result["bearish_ob_high"] is not None:
            result["bearish_ob_mitigated"] = bool(
                c["high"] >= result["bearish_ob_low"] and c["close"] <= result["bearish_ob_high"]
            )

        return result

    def vote(self, direction: str, df: pd.DataFrame) -> AgentVote:
        if len(df) < 20:
            return AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason="بيانات غير كافية لتحليل هيكلة السوق (ICT)",
                metadata={}
            )

        ict = self._detect_fvg_bos(df)

        # Convert np.bool_ to regular bool for JSON serialization
        clean_ict = {k: bool(v) if isinstance(v, (bool, np.bool_)) else float(v) if isinstance(v, (float, np.floating, int, np.integer)) else v for k, v in ict.items()}

        swing_highs, swing_lows = self._find_swing_points(df, SWING_LOOKBACK, SWING_STRENGTH)
        sweep = self._detect_liquidity_sweep(df, swing_highs, swing_lows)
        ob    = self._detect_order_blocks(df, SWING_LOOKBACK)

        clean_ict.update(sweep)
        clean_ict.update(ob)

        approved = False
        reason = ""
        confidence = 0.0

        if direction == "BUY":
            if ict["bullish_bos"]:
                approved = True
                confidence = 1.0
                reason = f"مقبول: كسر هيكل صاعد (Bullish BOS) إغلاق أعلى من القمة {ict['recent_high']:.5f}"
            elif sweep["bullish_sweep"]:
                approved = True
                confidence = 1.0
                reason = (
                    f"مقبول بامتياز: رصد سحب سيولة مؤسسية (Liquidity Sweep) تحت القاع "
                    f"التأرجحي السابق {sweep['swept_low']:.5f} مع إغلاق الجسم داخل النطاق "
                    f"القديم -- كسر كاذب لتجميع أوامر البيع (Stop Hunt)"
                )
            elif ob["bullish_ob_mitigated"]:
                approved = True
                confidence = 1.0
                reason = (
                    f"مقبول بامتياز: عودة السعر لاختبار كتلة تنفيذية صاعدة (Bullish Order "
                    f"Block) بين {ob['bullish_ob_low']:.5f} و {ob['bullish_ob_high']:.5f} "
                    f"-- منطقة دخول عالية الاحتمالية (Mitigation)"
                )
            elif ict["bullish_fvg"]:
                approved = True
                confidence = 0.8
                reason = "مقبول: رصد فجوة سعرية عادلة صاعدة (Bullish FVG)"
            elif ict["close"] > ict["ema50"] and ict["ema50"] >= ict["ema200"]:
                approved = True
                confidence = 0.5
                reason = "مقبول جزئياً: لا يوجد هيكل واضح ولكن السعر في اتجاه عام صاعد (أعلى من EMA 50 و 200)"
            else:
                reason = "مرفوض: لا يوجد كسر هيكل صاعد (BOS)، ولا سحب سيولة، ولا كتلة تنفيذية مفعّلة، ولا اتجاه عام صاعد (EMA)"
        else:
            if ict["bearish_bos"]:
                approved = True
                confidence = 1.0
                reason = f"مقبول: كسر هيكل هابط (Bearish BOS) إغلاق أدنى من القاع {ict['recent_low']:.5f}"
            elif sweep["bearish_sweep"]:
                approved = True
                confidence = 1.0
                reason = (
                    f"مقبول بامتياز: رصد سحب سيولة مؤسسية (Liquidity Sweep) فوق القمة "
                    f"التأرجحية السابقة {sweep['swept_high']:.5f} مع إغلاق الجسم داخل النطاق "
                    f"القديم -- كسر كاذب لتجميع أوامر الشراء (Stop Hunt)"
                )
            elif ob["bearish_ob_mitigated"]:
                approved = True
                confidence = 1.0
                reason = (
                    f"مقبول بامتياز: عودة السعر لاختبار كتلة تنفيذية هابطة (Bearish Order "
                    f"Block) بين {ob['bearish_ob_low']:.5f} و {ob['bearish_ob_high']:.5f} "
                    f"-- منطقة دخول عالية الاحتمالية (Mitigation)"
                )
            elif ict["bearish_fvg"]:
                approved = True
                confidence = 0.8
                reason = "مقبول: رصد فجوة سعرية عادلة هابطة (Bearish FVG)"
            elif ict["close"] < ict["ema50"] and ict["ema50"] <= ict["ema200"]:
                approved = True
                confidence = 0.5
                reason = "مقبول جزئياً: لا يوجد هيكل واضح ولكن السعر في اتجاه عام هابط (أدنى من EMA 50 و 200)"
            else:
                reason = "مرفوض: لا يوجد كسر هيكل هابط (BOS)، ولا سحب سيولة، ولا كتلة تنفيذية مفعّلة، ولا اتجاه عام هابط (EMA)"

        return AgentVote(
            agent=self.NAME, direction=direction,
            approved=approved, confidence=confidence,
            reason=reason,
            metadata=clean_ict,
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
        mid_val = (upper + lower) / 2.0

        if direction == "BUY":
            approved    = close >= mid_val
            penetration = _clamp((close - mid_val) / (upper - mid_val), 0.0, 1.0) if approved else 0.0
            band_label  = "الأوسط إلى العلوي"
            band_val    = upper
        else:
            approved    = close <= mid_val
            penetration = _clamp((mid_val - close) / (mid_val - lower), 0.0, 1.0) if approved else 0.0
            band_label  = "الأوسط إلى السفلي"
            band_val    = lower

        confidence = _clamp(0.5 + penetration * 0.5, 0.5, 1.0) if approved else 0.0

        if approved:
            reason = (
                f"السعر {close:.5f} في النطاق {band_label}, "
                f"قوة الزخم {penetration * 100:.1f}% نحو الطرف"
            )
        else:
            reason = f"السعر {close:.5f} لا يدعم الاتجاه (عكس النطاق الأوسط)"

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
            approved   = rsi_val >= 50.0
            distance   = _clamp((rsi_val - 50.0) / 20.0, 0.0, 1.0) if approved else 0.0
            zone_label = "زخم إيجابي (>50)" if approved else "زخم سلبي"
        else:
            approved   = rsi_val <= 50.0
            distance   = _clamp((50.0 - rsi_val) / 20.0, 0.0, 1.0) if approved else 0.0
            zone_label = "زخم سلبي (<50)" if approved else "زخم إيجابي"

        confidence = _clamp(0.5 + distance * 0.5, 0.5, 1.0) if approved else 0.0

        reason = f"RSI(14) = {rsi_val:.2f} -- {zone_label}"

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
        account_balance: float | None = None,
    ) -> tuple[AgentVote, float | None, float | None, float | None, float | None, float | None, float | None, str | None]:
        if len(df) < MIN_CANDLES_ATR:
            vote = AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason=(
                    f"بيانات غير كافية -- يلزم {MIN_CANDLES_ATR} شمعة "
                    f"(متوفر: {len(df)})"
                ),
            )
            return vote, None, None, None, None, None, None, None

        _atr_len  = int(_cfg("atr_length",  ATR_LENGTH))
        _sl_mult  = float(_cfg("atr_sl_mult", ATR_SL_MULT))
        _tp_mult  = float(_cfg("atr_tp_mult", ATR_TP_MULT))
        # حد أدنى صارم لـ RR = 2.0 لا يمكن تجاوزه عبر system_config -- أي قيمة أقل
        # تُستبدل بالحد الأدنى الصارم MIN_RR_HARD_FLOOR (يفعّل فيتو RiskAgent دونه).
        _min_rr   = max(float(_cfg("min_rr", MIN_RR)), MIN_RR_HARD_FLOOR)

        atr_val = _last(_atr(df["high"], df["low"], df["close"], _atr_len))
        close   = _last(df["close"])

        if atr_val is None or atr_val <= 0.0 or close is None:
            vote = AgentVote(
                agent=self.NAME, direction=direction,
                approved=False, confidence=0.0,
                reason="فشل حساب ATR أو القيمة صفر",
            )
            return vote, None, None, None, None, None, None, None

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

        # رأس المال الفعلي لحساب المخاطرة: رصيد المنصة الحي إن توفر، وإلا قيمة افتراضية
        effective_balance = account_balance if account_balance and account_balance > 0 else 10000.0
        risk_percent = 0.01
        risk_amount = effective_balance * risk_percent
        profit_amount = risk_amount * rr

        tf = str(df.attrs.get("timeframe", "H1")).lower()
        # مطابقة دقيقة (equality) لـ M1/M5 لتجنب تطابق جزئي خاطئ مع M15/M30
        # (مثلاً "m1" هي بداية "m15" -- لذلك لا تُستخدم "in" هنا).
        if tf in ("1m", "m1"):
            duration = "5 إلى 20 دقيقة"
        elif tf in ("5m", "m5"):
            duration = "15 إلى 60 دقيقة"
        elif "15" in tf:
            duration = "45 دقيقة إلى 3 ساعات"
        elif "30" in tf:
            duration = "2 إلى 6 ساعات"
        elif "h4" in tf or "4h" in tf:
            duration = "16 إلى 48 ساعة"
        elif "d1" in tf or "1d" in tf:
            duration = "4 إلى 12 يوماً"
        else: # Default H1
            duration = "4 إلى 12 ساعة"

        rr_verdict = "موافق -- يتجاوز 1:2" if approved else "مرفوض -- دون الحد 1:2"
        reason = (
            f"دخول {close:.5f} | SL {sl:.5f} | TP {tp:.5f} | "
            f"RR {rr:.2f} | مخاطرة ${risk_amount:.2f} | ربح المتوقع ${profit_amount:.2f}"
        )

        # نصيحة رافعة معلوماتية للكريبتو (OKX) فقط -- بناءً على تقلب ATR/سعر:
        # تقلب عالٍ (>= 1% من السعر) => 1x، تقلب مستقر => 3x.
        # ملاحظة: قيمة معلوماتية بحتة لا تُستخدم في أي حساب لوت/مركز فعلي،
        # ولا تُفعّل أي رافعة حقيقية -- العقود الآجلة والرافعة الحقيقية ممنوعة على OKX.
        symbol_name = str(df.attrs.get("symbol", ""))
        leverage_advice = None
        if "-" in symbol_name:  # تنسيق رمز OKX مثل BTC-USDT
            volatility_ratio = atr_val / close if close else 0.0
            if volatility_ratio >= 0.01:
                leverage_advice = "1x (تقلب مرتفع -- معلوماتي فقط، غير تنفيذي)"
            else:
                leverage_advice = "3x (تقلب مستقر -- معلوماتي فقط، غير تنفيذي)"

        metadata = {"atr": atr_val, "entry": close, "sl": sl, "tp": tp, "rr": rr, "risk": risk_amount, "profit": profit_amount, "duration": duration}
        if leverage_advice is not None:
            metadata["leverage_advice"] = leverage_advice

        vote = AgentVote(
            agent=self.NAME, direction=direction,
            approved=approved, confidence=confidence,
            reason=reason,
            metadata=metadata,
        )
        return vote, close, sl, tp, atr_val, risk_amount, profit_amount, duration


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

    def _evaluate(
        self,
        direction: str,
        df: pd.DataFrame,
        account_balance: float | None = None,
        symbol_info: dict | None = None,
    ) -> CouncilVerdict:
        """Run all four agents for one direction and apply voting rules."""
        symbol = str(df.attrs.get("symbol", "UNKNOWN"))

        trend_vote                       = self._trend.vote(direction, df)
        volatility_vote                  = self._volatility.vote(direction, df)
        momentum_vote                    = self._momentum.vote(direction, df)
        risk_vote, entry, sl, tp, atr, risk_amt, profit_amt, dur = self._risk.vote(direction, df, account_balance)

        all_votes = [trend_vote, volatility_vote, momentum_vote, risk_vote]

        veto_ok   = trend_vote.approved and risk_vote.approved
        quorum_ok = volatility_vote.approved or momentum_vote.approved
        approved  = veto_ok and quorum_ok

        if not veto_ok:
            signal_strength = 0.0
        else:
            aligned_agents = [v for v in all_votes if v.approved]
            if aligned_agents:
                signal_strength = sum(v.confidence for v in aligned_agents) / len(aligned_agents)
            else:
                signal_strength = 0.0

        lot_size = None
        risk_percent_used = None
        digits = symbol_info.get("digits") if symbol_info else None

        # Price decimals: استخدام دقة الرمز الحقيقية من MT5 (symbol_info.digits)
        # عند توفرها، وإلا تقدير حسب حجم السعر (متوافق مع OKX وغيرها).
        if digits is not None:
            def fmt(val: float | None) -> float | None:
                return round(val, digits) if val is not None else None
        else:
            def fmt(val: float | None) -> float | None:
                if val is None: return None
                if val > 1000: return round(val, 2)
                if val > 10: return round(val, 3)
                return round(val, 5)

        # مستويات نظرية (من RiskAgent) -- تُحفظ دائماً للعرض المعلوماتي على
        # الواجهة حتى عند رفض الإشارة (WAIT)، بصرف النظر عن approved.
        theoretical_sl = fmt(sl)
        theoretical_tp = fmt(tp)

        if approved:
            # Dynamic Risk 1% to 3%
            if signal_strength >= 0.85:
                risk_multiplier = 3.0
            elif signal_strength >= 0.65:
                risk_multiplier = 2.0
            else:
                risk_multiplier = 1.0

            # سقف صارم: لا تتجاوز نسبة المخاطرة الفعلية MAX_RISK_PERCENT (3%) من رأس المال
            # بصرف النظر عن قوة الإشارة (risk_multiplier أساسه 1% لكل وحدة).
            risk_percent_used = min(risk_multiplier, MAX_RISK_PERCENT)  # base risk per RiskAgent.vote = 1%
            risk_amt = (risk_amt or 0) * risk_percent_used
            profit_amt = (profit_amt or 0) * risk_percent_used

            # Estimated Lot/Quantity
            sl_dist = abs(entry - sl) if entry and sl else 0
            if sl_dist > 0:
                if symbol_info:
                    # رمز MT5: استخدام الحجم القياسي (لوت) عبر calculate_position_size
                    # الذي يأخذ بعين الاعتبار حجم العقد عبر trade_tick_value/trade_tick_size
                    effective_balance = account_balance if account_balance and account_balance > 0 else 10000.0
                    sizing = calculate_position_size(
                        account_equity=effective_balance,
                        risk_percent=risk_percent_used,
                        entry_price=entry,
                        stop_loss=sl,
                        trade_tick_value=symbol_info.get("trade_tick_value", 0.0),
                        trade_tick_size=symbol_info.get("trade_tick_size", 0.0),
                        point=symbol_info.get("point", 0.0),
                        volume_min=symbol_info.get("volume_min", 0.01),
                        volume_max=symbol_info.get("volume_max", 1000.0),
                        volume_step=symbol_info.get("volume_step", 0.01),
                        contract_size=symbol_info.get("contract_size", DEFAULT_CONTRACT_SIZE),
                    )
                    if sizing["normalized_lot"] > 0:
                        lot_size = sizing["normalized_lot"]
                else:
                    # بدون بيانات رمز MT5 (مثل OKX): كمية الأصل الأساسي مباشرة (مناسبة للسبوت)
                    lot_size = round(risk_amt / sl_dist, 4)

            entry = fmt(entry)
            sl = fmt(sl)
            tp = fmt(tp)

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

        # -- Market Session Alignment ------------------------------------------
        session_info = get_market_session()
        active_sessions = session_info.get("active", [])
        symbol_upper = symbol.upper()
        
        session_aligned = False
        aligned_reason = ""
        
        if "Sydney" in active_sessions and ("AUD" in symbol_upper or "NZD" in symbol_upper):
            session_aligned = True
            aligned_reason = "سوق سيدني مفتوح (سيولة استرالية/نيوزيلندية)"
        elif "Tokyo" in active_sessions and "JPY" in symbol_upper:
            session_aligned = True
            aligned_reason = "سوق طوكيو مفتوح (سيولة آسيوية)"
        elif "London" in active_sessions and ("EUR" in symbol_upper or "GBP" in symbol_upper or "CHF" in symbol_upper):
            session_aligned = True
            aligned_reason = "سوق لندن مفتوح (سيولة أوروبية)"
        elif "New York" in active_sessions and ("USD" in symbol_upper or "CAD" in symbol_upper):
            session_aligned = True
            aligned_reason = "سوق نيويورك مفتوح (السيولة الأمريكية)"
            
        if session_aligned and approved:
            signal_strength = min(1.0, signal_strength + 0.1) # 10% bonus for session alignment
            confluence["session_bonus"] = True
            confluence["session_reason"] = aligned_reason

        return CouncilVerdict(
            symbol          = symbol,
            direction       = direction if approved else None,
            approved        = approved,
            signal_strength = signal_strength,
            votes           = all_votes,
            entry           = entry if approved else None,
            sl              = sl if approved else None,
            tp              = tp if approved else None,
            theoretical_sl  = theoretical_sl,
            theoretical_tp  = theoretical_tp,
                atr             = atr,
                risk_amount     = risk_amt if approved else None,
                risk_percent    = risk_percent_used if approved else None,
                profit_amount   = profit_amt if approved else None,
                lot_size        = lot_size if approved else None,
                digits          = digits,
                duration        = dur if approved else None,
                timeframe       = df.attrs.get("timeframe", "H1"),
                confluence      = confluence,
                session         = session_info,
            )

    def _persist(self, verdict: CouncilVerdict, db: Session, record_signal: bool = True) -> None:
        """Write verdict to SQLite.
        - Always saves to DecisionJournal (approved + rejected history).
        - Only saves to StrategySignal when verdict.approved is True AND
          record_signal is True (False during the 4-hour signal cooldown
          for an identical symbol+direction, to avoid radar flooding).
        """
        try:
            signal_id: str | None = None

            if verdict.approved and record_signal:
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

            technical_breakdown = {
                v.agent: v.metadata
                for v in verdict.votes
            }

            context_payload = json.dumps({
                "symbol":          verdict.symbol,
                "direction":       verdict.direction,
                "signal_strength": round(verdict.signal_strength, 4),
                "entry":           round(verdict.entry, 5) if verdict.entry is not None else None,
                "sl":              round(verdict.sl,  5) if verdict.sl  is not None else None,
                "tp":              round(verdict.tp,  5) if verdict.tp  is not None else None,
                "atr":             round(verdict.atr, 5) if verdict.atr is not None else None,
                "risk_amount":     round(verdict.risk_amount, 2) if verdict.risk_amount is not None else None,
                "profit_amount":   round(verdict.profit_amount, 2) if verdict.profit_amount is not None else None,
                "lot_size":        verdict.lot_size,
                "duration":        verdict.duration,
                "timeframe":       verdict.timeframe,
                "confluence":      verdict.confluence,
                "session":         verdict.session,
                "technical_breakdown": technical_breakdown,
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
            # تنسيق الأسعار حسب دقة الرمز الحقيقية في MT5 (digits) لتطابق
            # ما يظهر في المنصة ويكون قابلاً للنسخ مباشرة إلى حقول SL/TP.
            _digits = verdict.digits if verdict.digits is not None else 5
            entry_str = f"{verdict.entry:.{_digits}f}" if verdict.entry is not None else "—"
            sl_str    = f"{verdict.sl:.{_digits}f}" if verdict.sl is not None else "—"
            tp_str    = f"{verdict.tp:.{_digits}f}" if verdict.tp is not None else "—"
            
            strength_val = verdict.signal_strength * 100
            if strength_val >= 85:
                strength_label = "قوية جداً ⚡️⚡️⚡️"
            elif strength_val >= 65:
                strength_label = "قوية ⚡️⚡️"
            elif strength_val >= 50:
                strength_label = "متوسطة ⚡️"
            else:
                strength_label = "ضعيفة ⚠️"
                
            dir_emoji = "🟢" if verdict.direction == "BUY" else "🔴"
            dir_label = "شراء BUY" if verdict.direction == "BUY" else "بيع SELL"

            risk_pct = verdict.risk_percent if verdict.risk_percent is not None else 1.0
            risk_str = f"{risk_pct:.1f}% (≈ ${verdict.risk_amount:.2f} من رصيد المنصة الحي)" if verdict.risk_amount else "—"
            profit_str = f"${verdict.profit_amount:.2f}" if verdict.profit_amount else "—"
            lot_str = f"{verdict.lot_size}" if verdict.lot_size else "—"
            duration_str = verdict.duration or "—"

            from datetime import timedelta
            baghdad_time = verdict.timestamp + timedelta(hours=3)
            time_str = baghdad_time.strftime("%I:%M %p").lstrip('0') + " بتوقيت بغداد"

            tf_display = verdict.timeframe.lower() if verdict.timeframe else "1h"

            # تمييز المنصة في بداية الرسالة: تنسيق رمز OKX يحتوي "-" (مثل BTC-USDT)
            # أما رموز MT5 (فوركس/الذهب) فلا تحتوي "-" (مثل XAUUSD).
            platform_tag = "[OKX - CRYPTO]" if "-" in verdict.symbol else "[MT5 - FOREX/GOLD]"

            # فواصل ASCII فقط (بدون رموز Unicode رسومية) لحماية Turbopack من الانهيار
            text = (
                f"{platform_tag}\n"
                f"===================\n"
                f"🪙 الزوج: {verdict.symbol}  —  {tf_display}\n"
                f"{dir_emoji} الإشارة: {dir_label}   |   القوة: {strength_label}\n"
                f"-------------------\n"
                f"📥 سعر الدخول: <code>{entry_str}</code>\n"
                f"🛑 وقف الخسارة (SL): <code>{sl_str}</code>\n"
                f"🏆 الهدف الذكي (TP): <code>{tp_str}</code>\n"
                f"-------------------\n"
                f"💰 حجم اللوت/العقد: <code>{lot_str}</code>\n"
                f"⚠️ المبلغ المعرض للمخاطرة: {risk_str}\n"
                f"🎯 الربح المتوقع: {profit_str}\n"
                f"⏳ مدة الصفقة المتوقعة: {duration_str}\n"
                f"-------------------\n"
                f"⏰ وقت صدور الإشارة: {time_str}\n"
                f"\n"
                f"تحليل معلوماتي مؤسسي — ليس توصية مالية"
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
        symbol:          str,
        candles_df:      pd.DataFrame,
        db:              Session | None = None,
        account_balance: float | None = None,
        symbol_info:     dict | None = None,
        send_alert:      bool = True,
        market_closed:   bool = False,
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
        account_balance : float | None
            Live account balance/equity (USD) used to size risk_amount,
            profit_amount and lot_size. Falls back to a $10,000 reference
            balance when not provided (e.g. OKX without a live account).
        symbol_info : dict | None
            MT5 symbol properties (trade_tick_value, trade_tick_size, point,
            volume_min, volume_max, volume_step) used to convert the risk
            amount into a real, broker-normalized lot size via
            calculate_position_size(). When None (e.g. OKX symbols), the
            lot_size falls back to a base-asset quantity estimate.
        send_alert : bool
            When False, suppresses the Telegram alert even if the signal is
            approved (used by broad ranking scans that should not notify).

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

        buy_verdict  = self._evaluate("BUY",  df, account_balance, symbol_info)
        sell_verdict = self._evaluate("SELL", df, account_balance, symbol_info)

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

        record_signal = True

        if winner.approved:
            # رادار رصين: تجنب تكرار نفس الإشارة (نفس الرمز + نفس الاتجاه) خلال
            # فترة تهدئة SIGNAL_COOLDOWN_HOURS (4 ساعات) -- لا تيليجرام ولا
            # StrategySignal جديد، لكن DecisionJournal/TripleFirewallSignal
            # تستمر كل دورة للتدقيق وتغذية الترشيح.
            cooldown_key = (symbol, winner.direction)
            last_alert_at = _LAST_SIGNAL_ALERT_TIMES.get(cooldown_key)
            now_utc = datetime.now(timezone.utc)
            on_cooldown = (
                last_alert_at is not None
                and (now_utc - last_alert_at).total_seconds() < SIGNAL_COOLDOWN_HOURS * 3600.0
            )

            if on_cooldown:
                record_signal = False
                logger.info(
                    "CouncilEngine: signal on cooldown -- symbol=%s direction=%s "
                    "(%.1f/%.1f hours elapsed) -- suppressing alert/StrategySignal",
                    symbol, winner.direction,
                    (now_utc - last_alert_at).total_seconds() / 3600.0,
                    SIGNAL_COOLDOWN_HOURS,
                )

            logger.info(
                "CouncilEngine: SIGNAL APPROVED -- symbol=%s direction=%s "
                "strength=%.0f%% votes=%s",
                symbol,
                winner.direction,
                winner.signal_strength * 100,
                winner.votes_summary(),
            )
            if send_alert and not on_cooldown:
                if not market_closed and is_market_open(symbol):
                    self._send_telegram_alert(winner)
                    _LAST_SIGNAL_ALERT_TIMES[cooldown_key] = now_utc
                    if db is not None:
                        from telegram_subscribers import broadcast_recommendation
                        broadcast_recommendation(winner, db)
                else:
                    logger.info("Market is closed for %s -- skipping Telegram alert.", symbol)
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
            self._persist(winner, db, record_signal=record_signal)

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
