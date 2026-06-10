/**
 * clerk-mock/server.ts
 * Mock implementation of @clerk/nextjs/server for local development.
 * auth() always returns local_admin userId so API routes pass without real Clerk.
 * Injected via Turbopack resolveAlias in next.config.ts.
 */

import type { NextRequest, NextResponse } from "next/server";

export const LOCAL_ADMIN_USER_ID = "local_admin";

// --------------------------------------------------------------------------
// auth() -- used in API route handlers: const { userId } = await auth();
// --------------------------------------------------------------------------
export function auth() {
  return Promise.resolve({
    userId: LOCAL_ADMIN_USER_ID,
    sessionId: "local_session",
    orgId: null as string | null,
    protect: async () => {},
    redirectToSignIn: () => {
      throw new Error("redirectToSignIn: should not be called in local mode");
    },
  });
}

// --------------------------------------------------------------------------
// currentUser() -- used by some API routes to get full user object
// --------------------------------------------------------------------------
export function currentUser() {
  return Promise.resolve({
    id: LOCAL_ADMIN_USER_ID,
    firstName: "المدير",
    lastName: "المحلي",
    emailAddresses: [{ emailAddress: "local@localhost" }],
  });
}

// --------------------------------------------------------------------------
// clerkMiddleware -- passthrough, no auth redirects
// --------------------------------------------------------------------------
type LocalAuthResult = {
  userId: string;
  sessionId: string;
  orgId: string | null;
  protect: () => Promise<void>;
  redirectToSignIn: () => never;
};

type MiddlewareHandler = (
  auth: LocalAuthResult,
  req: NextRequest,
) => void | Promise<void>;

export function clerkMiddleware(handler?: MiddlewareHandler) {
  return async function proxy(req: NextRequest) {
    // No auth gate -- let all requests through
    const { NextResponse: NR } = await import("next/server");
    return NR.next();
  };
}

// --------------------------------------------------------------------------
// createRouteMatcher -- returns a matcher that never matches (no protected routes)
// --------------------------------------------------------------------------
export function createRouteMatcher(_patterns: string[]) {
  return (_req: NextRequest) => false;
}

// --------------------------------------------------------------------------
// getAuth -- server-side equivalent of useAuth
// --------------------------------------------------------------------------
export function getAuth(_req: NextRequest) {
  return {
    userId: LOCAL_ADMIN_USER_ID,
    sessionId: "local_session",
    orgId: null as string | null,
  };
}
