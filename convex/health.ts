import { query } from "./_generated/server";

export const status = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    return {
      ok: true,
      authenticated: Boolean(identity),
      subject: identity?.subject ?? null,
      email: identity?.email ?? null,
      timestamp: Date.now(),
    };
  },
});
