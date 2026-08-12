/**
 * Next.js instrumentation hook (https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
 * `register()` runs once, before this server starts accepting requests, in every runtime Next.js
 * boots (including the edge runtime for middleware) — the `NEXT_RUNTIME` guard restricts the
 * config gate to the Node.js server runtime, since `validateConfigForEnv` reads process env and
 * throws for an unsafe production configuration, which only makes sense to run (and only needs to
 * run) once per Node.js process.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runConfigBootstrap } = await import("@/lib/bootstrap");
    runConfigBootstrap();
  }
}
