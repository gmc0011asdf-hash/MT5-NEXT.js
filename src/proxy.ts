import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

// Pages that require a signed-in Clerk session.
// /api/mt5-readonly/* is intentionally NOT listed here — the routes are publicly
// reachable. Convex persistence inside each route handles its own auth check.
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/lab(.*)",
  "/reports(.*)",
  "/monitoring(.*)",
  "/replay(.*)",
  "/settings(.*)",
  "/convex-test(.*)",
  "/convex-core(.*)",
]);

// Next.js 16 renamed middleware to "proxy". The file must export either a
// default export or a named `proxy` export. We export both to satisfy all
// versions of the Clerk + Next.js integration.
const clerkHandler = clerkMiddleware(async (auth, req: NextRequest) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

// Named export — required by Next.js 16 proxy convention.
export const proxy = clerkHandler;

// Default export — kept for backward compatibility with Clerk's internal checks.
export default clerkHandler;

export const config = {
  matcher: [
    // Run proxy on all routes except Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run on API and tRPC routes (Clerk needs to set auth headers).
    "/(api|trpc)(.*)",
  ],
};
