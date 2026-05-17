import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const AUTH_MSG = "يجب تسجيل الدخول لاستخدام هذه الوظائف";

function requireUserId(identity: { subject: string } | null): string {
  if (!identity) {
    throw new ConvexError(AUTH_MSG);
  }
  return identity.subject;
}

export const createTestEvent = mutation({
  args: {
    title: v.string(),
    source: v.string(),
  },
  handler: async (ctx, { title, source }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError(AUTH_MSG);
    }
    return await ctx.db.insert("testEvents", {
      title,
      source,
      userId: identity.subject,
      email: identity.email ?? undefined,
      createdAt: Date.now(),
    });
  },
});

export const listTestEvents = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireUserId(identity);
    const items = await ctx.db
      .query("testEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const latestTestEvent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = requireUserId(identity);
    const items = await ctx.db
      .query("testEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (items.length === 0) return null;
    return items.reduce((best, cur) => (cur.createdAt > best.createdAt ? cur : best));
  },
});
