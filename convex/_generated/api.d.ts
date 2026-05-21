/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as coreQueries from "../coreQueries.js";
import type * as coreSeed from "../coreSeed.js";
import type * as decisionJournal from "../decisionJournal.js";
import type * as demoExecutionJournal from "../demoExecutionJournal.js";
import type * as goldJournal from "../goldJournal.js";
import type * as health from "../health.js";
import type * as mt5Bridge from "../mt5Bridge.js";
import type * as mt5CandlesQuery from "../mt5CandlesQuery.js";
import type * as newsIngestion from "../newsIngestion.js";
import type * as newsReviews from "../newsReviews.js";
import type * as newsTranslation from "../newsTranslation.js";
import type * as technicalIndicators from "../technicalIndicators.js";
import type * as testEvents from "../testEvents.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  coreQueries: typeof coreQueries;
  coreSeed: typeof coreSeed;
  decisionJournal: typeof decisionJournal;
  demoExecutionJournal: typeof demoExecutionJournal;
  goldJournal: typeof goldJournal;
  health: typeof health;
  mt5Bridge: typeof mt5Bridge;
  mt5CandlesQuery: typeof mt5CandlesQuery;
  newsIngestion: typeof newsIngestion;
  newsReviews: typeof newsReviews;
  newsTranslation: typeof newsTranslation;
  technicalIndicators: typeof technicalIndicators;
  testEvents: typeof testEvents;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
