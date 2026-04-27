import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  testEvents: defineTable({
    title: v.string(),
    source: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),
});
