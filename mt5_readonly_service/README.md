# MT5 Read-only Local Connector

This folder contains a **small FastAPI service** that runs **next to MetaTrader 5 on Windows** and exposes **read-only HTTP endpoints** for account info, ticks, and open positions.

## Warning

**This service is read-only and must never expose trading endpoints.**  
Do not add routes or imports that call `order_send`, `order_close`, `order_modify`, `order_check`, or any execution APIs.

## Requirements

- Windows with MetaTrader 5 terminal installed.
- Python 3.10+ recommended.
- Optional: copy `.env.example` to `.env` and adjust `SYMBOLS` if needed (comma-separated).

## Run

```bat
cd mt5_readonly_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8010 --reload
```

Then open:

- `http://127.0.0.1:8010/health`
- `http://127.0.0.1:8010/readonly/account`
- `http://127.0.0.1:8010/readonly/ticks`
- `http://127.0.0.1:8010/readonly/positions`
- `http://127.0.0.1:8010/readonly/snapshot`

If MT5 is not running or not installed, responses return `connected: false` with an error message.

## Convex

This service is **not** wired to Convex yet; it is a standalone local foundation.
