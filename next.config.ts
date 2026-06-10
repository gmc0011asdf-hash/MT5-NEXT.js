import type { NextConfig } from "next";

/**
 * Local-mode: Turbopack resolveAlias replaces @clerk/nextjs + @clerk/nextjs/server
 * with local mock implementations so the app runs without cloud authentication.
 * The convex/react alias overrides useConvexAuth to always return isAuthenticated:true.
 *
 * Note: Turbopack resolveAlias uses paths relative to the project root (no drive letters).
 */
const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "@clerk/nextjs": "./src/lib/clerk-mock/index.tsx",
      "@clerk/nextjs/server": "./src/lib/clerk-mock/server.ts",
    },
  },
};

export default nextConfig;
