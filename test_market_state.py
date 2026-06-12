import sys
import os
from datetime import datetime, timezone, timedelta

sys.path.append(r"e:\PROJACT-AHMED\MT5-gold-clone\mt5_readonly_service")
from agents import is_market_open

print("\n=== محاكاة وقت إغلاق السوق (يوم السبت) ===")
fake_now_saturday = datetime(2026, 6, 13, 12, 0, tzinfo=timezone.utc) # يوم السبت
print(f"Time: {fake_now_saturday}")

def test_simulation(symbol: str, trade_mode_val: int):
    print(f"\n--- Testing {symbol} ---")
    
    # 1. Logic
    market_open_logic = is_market_open(symbol, fake_now_saturday)
    print(f"is_market_open('{symbol}') returned: {market_open_logic}")
    
    # 2. MT5 trade_mode
    is_stale = (trade_mode_val != 4)
    print(f"Simulated trade_mode for {symbol}: {trade_mode_val}")
    print(f"is_stale (trade_mode != FULL): {is_stale}")
    
    # 3. Decision
    if market_open_logic and not is_stale:
        print(f"✅ RESULT: System WILL send Telegram alerts for {symbol}")
    else:
        print(f"❌ RESULT: System WILL NOT send Telegram alerts for {symbol} (Market is CLOSED)")

test_simulation("EURUSD", 0) # 0 means disabled/closed in MT5
test_simulation("XAUUSD", 0)

print("\n--- Testing OKX Crypto (BTC-USDT) ---")
crypto_open = is_market_open("BTC-USDT", fake_now_saturday)
is_stale = False # OKX passes False by default
print(f"is_market_open('BTC-USDT') returned: {crypto_open}")
if crypto_open and not is_stale:
    print(f"✅ RESULT: System WILL send Telegram alerts for BTC-USDT")
else:
    print(f"❌ RESULT: System WILL NOT send Telegram alerts for BTC-USDT")
