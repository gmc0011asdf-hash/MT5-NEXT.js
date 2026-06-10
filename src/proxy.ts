/**
 * proxy.ts — Next.js 16 middleware (renamed from middleware.ts)
 *
 * Local mode: Clerk is mocked via Turbopack alias, so this middleware
 * is a simple passthrough. All routes are accessible without cloud auth.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(_req: NextRequest) {
  return NextResponse.next();
}

// Named export required by Next.js 16 proxy convention.
export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
