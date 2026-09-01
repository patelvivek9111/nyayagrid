/**
 * Worker entrypoint documentation.
 *
 * Domain job logic lives in `@nyayagrid/jobs`.
 * Inngest functions are registered by the Next.js app at `/api/inngest`.
 *
 * Local development:
 *   1. Start the web app: `npm run dev`
 *   2. Start the Inngest dev server: `npm run dev:worker` (127.0.0.1:8288)
 *
 * This package exists so job transport can later move to a dedicated worker
 * process without rewriting domain handlers.
 */
export const workerPackage = {
  name: "@nyayagrid/worker",
  transport: "inngest-local",
} as const;
