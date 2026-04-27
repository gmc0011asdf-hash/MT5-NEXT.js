/**
 * MT5 Read-only Bridge — Foundation layer (Next.js / app).
 *
 * SAFETY CONTRACT (تنفيذ):
 * - This module is for read-only market/account/position snapshot SHAPES and future
 *   non-executing collection. It must never import or re-export trade execution,
 *   order_send, close, modify, pending, or any path that enables live trading.
 * - If a real MT5 socket/EA is added later, it may only feed this module with
 *   read paths; execution must live in a separate package with a different
 *   review process.
 */
export const MT5_BRIDGE_READ_ONLY = true as const;

/**
 * Runtime guard: if the read-only flag is ever set to a different value, fail fast in dev.
 * Trading code must not import this to "bypass" — there is no trading entry here.
 */
export function assertMt5BridgeReadOnlyMode(): void {
  if (MT5_BRIDGE_READ_ONLY !== true) {
    throw new Error("mt5-bridge: read-only policy was disabled; this build is invalid.");
  }
}

/** Public label for UI and snapshot `source` field alignment (not a live link). */
export const MT5_BRIDGE_STUB_SOURCE = "mt5-bridge-read-only-stub" as const;
