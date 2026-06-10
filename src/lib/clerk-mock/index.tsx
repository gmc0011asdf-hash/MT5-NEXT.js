/**
 * clerk-mock/index.tsx
 * Mock implementation of @clerk/nextjs for local development.
 * Replaces cloud Clerk auth with a static local-admin identity.
 * Injected via Turbopack resolveAlias in next.config.ts.
 */
"use client";

import type { ReactNode } from "react";

export const LOCAL_ADMIN_USER_ID = "local_admin";

// --------------------------------------------------------------------------
// ClerkProvider -- renders children as-is, no auth gate
// --------------------------------------------------------------------------
export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// --------------------------------------------------------------------------
// useAuth -- always signed-in local admin
// --------------------------------------------------------------------------
export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: true as const,
    userId: LOCAL_ADMIN_USER_ID,
    sessionId: "local_session",
    orgId: null,
    getToken: async (_opts?: unknown) => "local_bypass_token",
  };
}

// --------------------------------------------------------------------------
// useUser -- local admin user object
// --------------------------------------------------------------------------
export function useUser() {
  return {
    isLoaded: true,
    isSignedIn: true as const,
    user: {
      id: LOCAL_ADMIN_USER_ID,
      firstName: "المدير",
      lastName: "المحلي",
      fullName: "المدير المحلي",
      username: "local_admin",
      emailAddresses: [
        { emailAddress: "local@localhost", id: "local_email" },
      ],
      primaryEmailAddressId: "local_email",
      imageUrl: "",
      publicMetadata: {},
    },
  };
}

// --------------------------------------------------------------------------
// UserButton -- simple local avatar badge
// --------------------------------------------------------------------------
export function UserButton(_props?: { afterSignOutUrl?: string; appearance?: unknown }) {
  return (
    <div
      title="المدير المحلي"
      className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-white select-none"
    >
      م
    </div>
  );
}

// --------------------------------------------------------------------------
// SignedIn / SignedOut / AuthLoading
// --------------------------------------------------------------------------
export function SignedIn({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export function SignedOut(_props: { children: ReactNode }) {
  return null;
}
export function AuthLoading(_props: { children: ReactNode }) {
  return null;
}

// --------------------------------------------------------------------------
// SignInButton / SignUpButton / SignOutButton -- no-ops locally
// --------------------------------------------------------------------------
export function SignInButton({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function SignUpButton({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function SignOutButton({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

// --------------------------------------------------------------------------
// useClerk -- partial mock for any component that calls signOut etc.
// --------------------------------------------------------------------------
export function useClerk() {
  return {
    signOut: async () => {},
    openSignIn: () => {},
    openSignUp: () => {},
  };
}

// --------------------------------------------------------------------------
// useSession -- session mock
// --------------------------------------------------------------------------
export function useSession() {
  return {
    isLoaded: true,
    isSignedIn: true as const,
    session: {
      id: "local_session",
      userId: LOCAL_ADMIN_USER_ID,
      status: "active" as const,
    },
  };
}
