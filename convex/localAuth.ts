/**
 * localAuth.ts
 * Provides a fallback user identity for local-mode operation.
 * When ctx.auth.getUserIdentity() returns null (no Clerk JWT),
 * requireLocalUserId returns LOCAL_ADMIN_USER_ID so all queries/mutations
 * work without cloud authentication.
 */

export const LOCAL_ADMIN_USER_ID = "local_admin";

type AuthCtx = {
  auth: { getUserIdentity: () => Promise<unknown> };
};

/**
 * Returns the Clerk subject (userId) if the user is authenticated,
 * or LOCAL_ADMIN_USER_ID when running without cloud auth.
 * Never returns null -- use this everywhere instead of raw getUserIdentity().
 */
export async function requireLocalUserId(ctx: AuthCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (
    identity &&
    typeof identity === "object" &&
    "subject" in identity &&
    typeof (identity as { subject: unknown }).subject === "string"
  ) {
    return (identity as { subject: string }).subject;
  }
  return LOCAL_ADMIN_USER_ID;
}
