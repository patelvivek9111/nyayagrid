/**
 * Platform foundation: the deployment-level concerns that every workspace shares — which environment
 * this is and whether it is safe to run, which model serves each capability, which features are on,
 * how requests are throttled, what AI use cost, what a plan includes, and how mail leaves the system.
 *
 * Nothing here makes an access-control decision. Authentication lives in @nyayagrid/auth,
 * authorization in @nyayagrid/permissions, and this package deliberately never substitutes for
 * either: a feature flag, a plan entitlement and a rate limit are all evaluated after a user has
 * already been authenticated and authorized for the thing they asked for.
 */
export * from "./config";
export * from "./models";
export * from "./features";
export * from "./rate-limit";
export * from "./usage";
export * from "./billing";
export * from "./email";
export * from "./lifecycle";
export * from "./pagination";
export * from "./ai-usage";
