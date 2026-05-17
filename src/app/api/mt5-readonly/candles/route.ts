/**
 * Read-only local MT5 proxy for candles.
 * Proxies GET http://127.0.0.1:8010/readonly/candles for same-origin browser fetch,
 * then persists the candles into Convex via syncReadOnlyCandlesFromLocalService (with dedup).
 *
 * Persistence is best-effort: if Convex is unreachable or the user is not authenticated,
 * the raw candle data is still returned to the caller — persistence errors do not fail the response.
 *
 * Auth flow (server-side):
 *   auth() from @clerk/nextjs/server reads the browser session from Next.js request headers.
 *   getToken({ template: "convex" }) mints a JWT whose aud === "convex" — this requires
 *   a JWT template named "convex" to exist in the Clerk dashboard.
 *   See README.md § "Clerk JWT Template" for dashboard setup steps.
 *
 * Debug: add ?debugAuth=1 to the request URL to get token claim diagnostics without
 * exposing the full JWT (iss, aud, sub-presence only).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const LOCAL_BASE = `${MT5_SERVICE_BASE}/readonly/candles`;
const FETCH_TIMEOUT_MS = 8000;
const CONVEX_CHUNK_SIZE = 1000; // matches MAX_CANDLES_PER_MUTATION in mt5Bridge.ts

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CandleRow = Record<string, unknown>;

type FreshnessSummary = {
  serverNowMs: number;
  latestCandleTime: Record<string, number>;
  newestCandleAgeMs: number;
  stalePairs: string[];
  brokerClockSkewDetected: boolean;
  brokerClockSkewMs: number;
};

type DataQuality = {
  totalReceived: number;
  totalValid: number;
  skippedInvalid: number;
  clockSkewAccepted: number;
  invalidReasonsSample: string[];
};

type PersistResult = {
  persisted: boolean;
  inserted: number;
  skippedIdentical: number;
  patchedRevisions: number;
  skippedInvalid: number;
  syncRunId: string | null;
  chunks: number;
  dataQuality: DataQuality;
  freshness: FreshnessSummary;
  stalePairs: string[];
  persistError?: string;
  persistErrorCode?: string;
};

type ConvexMutationResult = {
  ok: boolean;
  connected?: boolean;
  inserted?: {
    candles: number;
    skippedIdentical: number;
    patchedRevisions: number;
    skippedInvalid: number;
    syncRunId: string;
  };
  dataQuality?: DataQuality;
  freshness?: FreshnessSummary;
};

/** JWT claims decoded from the base64 payload — no secret required, no verification. */
type JwtClaims = {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  sub?: string;
};

// ---------------------------------------------------------------------------
// JWT claim decoder (no verification — diagnostics only)
// ---------------------------------------------------------------------------

function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // base64url → base64 → decode
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "=",
    );
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(decoded) as JwtClaims;
  } catch {
    return null;
  }
}

/** Returns safe diagnostics — never the raw token value. */
function buildAuthDiagnostics(
  token: string | null,
  templateUsed: string,
  persistErrorCode: string,
): Record<string, unknown> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!token) {
    return {
      template_used: templateUsed,
      token_present: false,
      convex_url_configured: !!convexUrl,
      persist_error_code: persistErrorCode,
      guidance: [
        "getToken returned null — user is not signed in, or the Clerk JWT template is missing.",
        "1. Sign in at /sign-in before calling this endpoint.",
        "2. Confirm a JWT template named 'convex' exists in the Clerk dashboard.",
      ],
    };
  }

  const claims = decodeJwtClaims(token);
  const iss = claims?.iss ?? "(could not decode)";
  const aud = claims?.aud ?? "(not set)";
  const azp = claims?.azp ?? undefined;
  const subPresent = !!claims?.sub;

  const convexExpectedDomain = "https://national-ant-59.clerk.accounts.dev";
  const issDomainMatch = typeof iss === "string" && iss.startsWith(convexExpectedDomain);
  const audIsConvex =
    aud === "convex" ||
    (Array.isArray(aud) && aud.includes("convex"));

  const guidance: string[] = [];
  if (!issDomainMatch) {
    guidance.push(
      `Issuer mismatch: token iss="${iss}" but Convex expects iss starting with "${convexExpectedDomain}".`,
      "Ensure your Clerk app's frontend API URL matches CLERK_FRONTEND_API_URL in the Convex environment.",
    );
  }
  if (!audIsConvex) {
    guidance.push(
      `Audience mismatch: token aud="${JSON.stringify(aud)}" but Convex requires aud="convex".`,
      "Create or fix the Clerk JWT template: Dashboard → JWT Templates → name='convex' → Audience='convex'.",
    );
  }
  if (guidance.length === 0) {
    guidance.push(
      "Token claims look correct (iss and aud match). The error may be transient or a Convex deployment mismatch.",
      "Try running: pnpm exec convex codegen",
    );
  }

  return {
    template_used: templateUsed,
    token_present: true,
    sub_present: subPresent,
    iss,
    aud,
    ...(azp !== undefined ? { azp } : {}),
    iss_matches_convex_config: issDomainMatch,
    aud_is_convex: audIsConvex,
    convex_url_configured: !!convexUrl,
    persist_error_code: persistErrorCode,
    guidance,
  };
}

// ---------------------------------------------------------------------------
// Convex persistence helper
// ---------------------------------------------------------------------------

const EMPTY_FRESHNESS: FreshnessSummary = {
  serverNowMs: 0,
  latestCandleTime: {},
  newestCandleAgeMs: -1,
  stalePairs: [],
  brokerClockSkewDetected: false,
  brokerClockSkewMs: 0,
};

const EMPTY_PERSIST: PersistResult = {
  persisted: false,
  inserted: 0,
  skippedIdentical: 0,
  patchedRevisions: 0,
  skippedInvalid: 0,
  syncRunId: null,
  chunks: 0,
  dataQuality: { totalReceived: 0, totalValid: 0, skippedInvalid: 0, clockSkewAccepted: 0, invalidReasonsSample: [] },
  freshness: EMPTY_FRESHNESS,
  stalePairs: [],
};

async function persistCandlesToConvex(
  candles: CandleRow[],
  pythonPayload: Record<string, unknown>,
): Promise<{ result: PersistResult; token: string | null; persistErrorCode: string }> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return {
      result: { ...EMPTY_PERSIST, persistError: "NEXT_PUBLIC_CONVEX_URL not configured", persistErrorCode: "no_convex_url" },
      token: null,
      persistErrorCode: "no_convex_url",
    };
  }

  // auth() reads the current Next.js request context (set by the framework from browser cookies/headers)
  const session = await auth();
  const TEMPLATE = "convex";
  const token = await session.getToken({ template: TEMPLATE });

  if (!token) {
    return {
      result: {
        ...EMPTY_PERSIST,
        persistError:
          "getToken returned null — user not signed in or Clerk JWT template 'convex' is missing in dashboard",
        persistErrorCode: "no_auth_token",
      },
      token: null,
      persistErrorCode: "no_auth_token",
    };
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  const syncRunId = `mt5-candles-api-${Date.now()}`;
  const totalChunks = Math.max(1, Math.ceil(candles.length / CONVEX_CHUNK_SIZE));

  const totals = {
    inserted: 0,
    skippedIdentical: 0,
    patchedRevisions: 0,
    skippedInvalid: 0,
    chunks: 0,
    lastSyncRunId: syncRunId,
    // dataQuality accumulators
    totalReceived: 0,
    totalValid: 0,
    clockSkewAccepted: 0,
    invalidReasonsSample: [] as string[],
    // freshness accumulators — keep max per pair, union stalePairs, max skew
    latestCandleTime: {} as Record<string, number>,
    serverNowMs: 0,
    newestCandleAgeMs: -1,
    stalePairs: new Set<string>(),
    brokerClockSkewDetected: false,
    brokerClockSkewMs: 0,
  };

  for (let i = 0; i < totalChunks; i++) {
    const chunk = candles.slice(i * CONVEX_CHUNK_SIZE, (i + 1) * CONVEX_CHUNK_SIZE);
    const isLast = i === totalChunks - 1;

    const result = (await client.mutation(
      api.mt5Bridge.syncReadOnlyCandlesFromLocalService,
      {
        connected: pythonPayload.connected === true,
        candles: chunk,
        symbols:
          Array.isArray(pythonPayload.symbols)
            ? (pythonPayload.symbols as string[])
            : undefined,
        timeframes:
          Array.isArray(pythonPayload.timeframes)
            ? (pythonPayload.timeframes as string[])
            : undefined,
        read_only_mode: true,
        error: typeof pythonPayload.error === "string" ? pythonPayload.error : undefined,
        syncRunId,
        chunkIndex: i,
        totalChunks,
      },
    )) as ConvexMutationResult;

    totals.chunks += 1;

    if (result?.ok && result.inserted) {
      totals.inserted += result.inserted.candles;
      totals.skippedIdentical += result.inserted.skippedIdentical;
      totals.patchedRevisions += result.inserted.patchedRevisions;
      totals.skippedInvalid += result.inserted.skippedInvalid;
      if (isLast && result.inserted.syncRunId) {
        totals.lastSyncRunId = result.inserted.syncRunId;
      }
    }

    // Accumulate dataQuality
    if (result?.dataQuality) {
      totals.totalReceived += result.dataQuality.totalReceived;
      totals.totalValid += result.dataQuality.totalValid;
      totals.clockSkewAccepted += result.dataQuality.clockSkewAccepted;
      if (totals.invalidReasonsSample.length < 5 && result.dataQuality.invalidReasonsSample.length > 0) {
        for (const r of result.dataQuality.invalidReasonsSample) {
          if (totals.invalidReasonsSample.length < 5) totals.invalidReasonsSample.push(r);
        }
      }
    }

    // Merge freshness — keep latest time per pair, union stalePairs, max skew
    if (result?.freshness) {
      if (result.freshness.serverNowMs > totals.serverNowMs) {
        totals.serverNowMs = result.freshness.serverNowMs;
      }
      for (const [pair, t] of Object.entries(result.freshness.latestCandleTime)) {
        if ((totals.latestCandleTime[pair] ?? 0) < t) {
          totals.latestCandleTime[pair] = t;
        }
      }
      if (result.freshness.newestCandleAgeMs >= 0 &&
        (totals.newestCandleAgeMs < 0 || result.freshness.newestCandleAgeMs < totals.newestCandleAgeMs)) {
        totals.newestCandleAgeMs = result.freshness.newestCandleAgeMs;
      }
      for (const p of result.freshness.stalePairs) {
        totals.stalePairs.add(p);
      }
      if (result.freshness.brokerClockSkewDetected) {
        totals.brokerClockSkewDetected = true;
      }
      if (result.freshness.brokerClockSkewMs > totals.brokerClockSkewMs) {
        totals.brokerClockSkewMs = result.freshness.brokerClockSkewMs;
      }
    }
  }

  const stalePairsArr = Array.from(totals.stalePairs);

  return {
    result: {
      persisted: true,
      inserted: totals.inserted,
      skippedIdentical: totals.skippedIdentical,
      patchedRevisions: totals.patchedRevisions,
      skippedInvalid: totals.skippedInvalid,
      syncRunId: totals.lastSyncRunId,
      chunks: totals.chunks,
      dataQuality: {
        totalReceived: totals.totalReceived,
        totalValid: totals.totalValid,
        skippedInvalid: totals.skippedInvalid,
        clockSkewAccepted: totals.clockSkewAccepted,
        invalidReasonsSample: totals.invalidReasonsSample,
      },
      freshness: {
        serverNowMs: totals.serverNowMs,
        latestCandleTime: totals.latestCandleTime,
        newestCandleAgeMs: totals.newestCandleAgeMs,
        stalePairs: stalePairsArr,
        brokerClockSkewDetected: totals.brokerClockSkewDetected,
        brokerClockSkewMs: totals.brokerClockSkewMs,
      },
      stalePairs: stalePairsArr,
    },
    token,
    persistErrorCode: "",
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const wantDebugAuth = sp.get("debugAuth") === "1";

  // Build Python service URL with forwarded query params
  const u = new URL(LOCAL_BASE);
  for (const key of ["symbols", "timeframes", "count"] as const) {
    const v = sp.get(key);
    if (v !== null && v !== "") u.searchParams.set(key, v);
  }

  // Fetch from Python service
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let pythonBody: Record<string, unknown>;
  let pythonStatus: number;

  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    pythonBody = (await res.json()) as Record<string, unknown>;
    pythonStatus = res.status;
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        connected: false,
        read_only_mode: true,
        source: "mt5-local-readonly-candles",
        candles: [],
        persisted: false,
        error: "خدمة MT5 المحلية غير متاحة أو MT5 غير متصل",
      },
      { status: 503 },
    );
  }

  const rawCandles = Array.isArray(pythonBody.candles)
    ? (pythonBody.candles as CandleRow[])
    : [];

  let persistResult: PersistResult = { ...EMPTY_PERSIST };
  let debugToken: string | null = null;
  let debugErrorCode = "";

  if (rawCandles.length > 0 && pythonBody.connected === true) {
    try {
      const { result, token, persistErrorCode } = await persistCandlesToConvex(rawCandles, pythonBody);
      persistResult = result;
      debugToken = token;
      debugErrorCode = persistErrorCode;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown persistence error";
      // Classify the error code for diagnostics
      let code = "convex_mutation_error";
      if (msg.includes("NoAuthProvider")) code = "convex_no_auth_provider";
      else if (msg.includes("Unauthenticated")) code = "convex_unauthenticated";
      else if (msg.includes("network")) code = "network_error";

      persistResult = {
        ...EMPTY_PERSIST,
        persisted: false,
        persistError: msg,
        persistErrorCode: code,
      };
      debugErrorCode = code;
    }
  }

  const response: Record<string, unknown> = {
    ...pythonBody,
    source: pythonBody.source ?? "mt5-local-readonly-candles",
    // --- Persistence counters (backward-compatible) ---
    persisted: persistResult.persisted,
    inserted: persistResult.inserted,
    skippedIdentical: persistResult.skippedIdentical,
    patchedRevisions: persistResult.patchedRevisions,
    skippedInvalid: persistResult.skippedInvalid,
    syncRunId: persistResult.syncRunId,
    persistChunks: persistResult.chunks,
    // --- Stage 4B: data quality + freshness ---
    dataQuality: persistResult.dataQuality,
    freshness: persistResult.freshness,
    stalePairs: persistResult.stalePairs,
    ...(persistResult.persistError !== undefined
      ? { persistError: persistResult.persistError }
      : {}),
    ...(persistResult.persistErrorCode !== undefined && persistResult.persistErrorCode !== ""
      ? { persistErrorCode: persistResult.persistErrorCode }
      : {}),
  };

  // ?debugAuth=1 — safe diagnostics only (no raw token)
  if (wantDebugAuth && !persistResult.persisted) {
    response.authDiagnostics = buildAuthDiagnostics(debugToken, "convex", debugErrorCode);
  }

  return NextResponse.json(response, { status: pythonStatus });
}
