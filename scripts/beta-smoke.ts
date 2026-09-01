#!/usr/bin/env npx tsx
/**
 * Controlled-beta smoke / canary. SYNTHETIC data only.
 *
 * Requires a running app:
 *   BETA_BASE_URL           default http://localhost:3000
 *   SMOKE_AUTH_HEADER       optional raw Cookie or Authorization header value
 *   SMOKE_MATTER_ID         required for write steps
 *
 *   npm run beta:smoke
 *   npm run beta:smoke -- --canary   (live + ready + unauthorized only)
 */
import { randomUUID } from "node:crypto";

const base = (process.env.BETA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const matterId = process.env.SMOKE_MATTER_ID;
const authHeader = process.env.SMOKE_AUTH_HEADER;
const canaryOnly = process.argv.includes("--canary");

type Check = { name: string; ok: boolean; status?: number; detail?: string };
const checks: Check[] = [];

async function probe(name: string, path: string, init: RequestInit = {}) {
  try {
    const headers = new Headers(init.headers);
    if (authHeader && !headers.has("authorization") && !headers.has("cookie")) {
      if (authHeader.toLowerCase().startsWith("bearer ")) headers.set("authorization", authHeader);
      else headers.set("cookie", authHeader);
    }
    const res = await fetch(`${base}${path}`, { ...init, headers });
    const ok = res.ok;
    checks.push({ name, ok, status: res.status });
    return res;
  } catch (error) {
    checks.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : "fetch failed",
    });
    return null;
  }
}

async function main() {
const live = await probe("live", "/api/health/live");
const ready = await probe("ready", "/api/health/ready");
if (ready && ready.status === 200) {
  const body = (await ready.json()) as { checks?: { ingest?: string } };
  checks.push({
    name: "ingest_configured",
    ok: body.checks?.ingest !== "disabled",
    detail: String(body.checks?.ingest ?? "unknown"),
  });
}

const denied = await fetch(`${base}/api/v1/matters`, { method: "GET" });
checks.push({
  name: "unauthorized_denied",
  ok: denied.status === 401 || denied.status === 403,
  status: denied.status,
});

if (!canaryOnly && matterId && authHeader) {
  const file = new Blob(["SYNTH smoke document for NyayaGrid beta.\n"], { type: "text/plain" });
  const form = new FormData();
  form.append("file", file, `synth-smoke-${randomUUID().slice(0, 8)}.txt`);
  const upload = await probe("upload", `/api/v1/matters/${matterId}/documents`, {
    method: "POST",
    body: form,
  });
  if (upload) {
    checks.push({
      name: "upload_accepted_202",
      ok: upload.status === 202,
      status: upload.status,
    });
    const payload = (await upload.json().catch(() => ({}))) as {
      document?: { id?: string; processingState?: string };
    };
    const documentId = payload.document?.id;
    if (documentId) {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const list = await fetch(`${base}/api/v1/matters/${matterId}/documents`, {
          headers: authHeader.toLowerCase().startsWith("bearer ")
            ? { authorization: authHeader }
            : { cookie: authHeader },
        });
        const json = (await list.json().catch(() => ({}))) as {
          documents?: Array<{ id: string; processingState: string }>;
        };
        const doc = json.documents?.find((row) => row.id === documentId);
        if (doc?.processingState === "ready") {
          checks.push({ name: "processing_ready", ok: true });
          const ask = await probe("ask_nyaya", `/api/v1/matters/${matterId}/ask`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: "What does the SYNTH smoke document say?" }),
          });
          checks.push({
            name: "ask_nyaya",
            ok: Boolean(ask?.ok),
            status: ask?.status,
          });
          break;
        }
        if (
          doc &&
          ["failed", "scan_blocked", "extraction_failed", "malware_scan_failed"].includes(
            doc.processingState,
          )
        ) {
          checks.push({
            name: "processing_ready",
            ok: false,
            detail: doc.processingState,
          });
          break;
        }
      }
    }
  }
} else if (!canaryOnly) {
  checks.push({
    name: "write_steps_skipped",
    ok: true,
    detail: "Set SMOKE_MATTER_ID and SMOKE_AUTH_HEADER to run upload/Ask steps",
  });
}

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ ok: failed.length === 0, base, checks }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
