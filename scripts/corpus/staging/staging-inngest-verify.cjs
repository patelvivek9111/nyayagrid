/**
 * Staging Inngest Cloud proof. Runs on the Fly machine so secrets never leave the host.
 * Prints statuses, function ids, retry numbers, and run state — never keys, tokens, or URLs.
 */
const { createHmac, createHash } = require("node:crypto");

const EXPECTED_FUNCTION_IDS = [
  "nyayagrid-ping",
  "nyayagrid-document-malware-scan",
  "nyayagrid-matter-extract-intelligence",
  "nyayagrid-matter-materialize-graph",
  "nyayagrid-matter-analyze-contract",
  "nyayagrid-matter-compare-documents",
  "nyayagrid-matter-analyze-deposition",
  "nyayagrid-matter-detect-contradictions",
  "nyayagrid-matter-classify-discovery",
  "nyayagrid-matter-detect-near-duplicates",
  "nyayagrid-research-ingest-authority",
  "nyayagrid-research-index-authority",
  "nyayagrid-research-run-query",
  "nyayagrid-agent-execute-run",
  "nyayagrid-agent-continue-run",
  "nyayagrid-student-ingest-case",
  "nyayagrid-guide-ingest-document",
];

function readEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function presence(name) {
  return readEnv(name) ? "set" : "missing";
}

function removePrefix(signingKey) {
  return signingKey.replace(/^signkey-[\w]+-/, "");
}

function signatureHeader(body, signingKey) {
  const ts = Math.round(Date.now() / 1000).toString();
  const encoded = typeof body === "string" ? body : JSON.stringify(body);
  const sig = createHmac("sha256", removePrefix(signingKey))
    .update(encoded)
    .update(ts)
    .digest("hex");
  return `t=${ts}&s=${sig}`;
}

function hashSigningKey(signingKey) {
  const prefix = signingKey.match(/^signkey-[\w]+-/)?.[0] || "";
  const key = removePrefix(signingKey);
  return `${prefix}${createHash("sha256").update(Buffer.from(key, "hex")).digest("hex")}`;
}

function functionIdOf(value) {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value.id || value.function_id || value.slug || value.name;
}

function collectFunctionIds(payload) {
  const found = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    if (typeof node.id === "string" && /nyayagrid-/.test(node.id)) found.push(node.id);
    if (typeof node.function_id === "string" && /nyayagrid-/.test(node.function_id)) {
      found.push(node.function_id);
    }
    if (Array.isArray(node.functions)) visit(node.functions);
    if (Array.isArray(node.data)) visit(node.data);
  };
  visit(payload);
  return [...new Set(found)].sort();
}

function retryNumbers(payload) {
  const retries = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const attempts = node.retries ?? node.retryLimit ?? node.maxAttempts ?? node.n;
    if (typeof attempts === "number") retries.push(attempts);
    if (node.retries && typeof node.retries.attempts === "number") retries.push(node.retries.attempts);
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(payload);
  return retries;
}

async function signedLocal(method, body) {
  const signingKey = readEnv("INNGEST_SIGNING_KEY");
  if (!signingKey) return { ok: false, error: "signing-key-missing" };
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers = {
    "x-inngest-signature": signatureHeader(payload === "" ? "" : JSON.parse(payload), signingKey),
    "x-inngest-sdk": "inngest-js:v3",
  };
  if (payload !== "") headers["content-type"] = "application/json";
  const res = await fetch("http://127.0.0.1:3000/api/inngest", {
    method,
    headers,
    body: payload === "" ? undefined : payload,
  });
  const json = await res.json().catch(() => ({}));
  return {
    status: res.status,
    sdkHandled: res.headers.get("x-inngest-sdk-handled"),
    functionCount: json.function_count,
    mode: json.mode,
    hasEventKey: json.has_event_key,
    hasSigningKey: json.has_signing_key,
    authenticationSucceeded: json.authentication_succeeded,
    functionIds: collectFunctionIds(json),
    retryAttempts: retryNumbers(json),
  };
}

async function inngestFetch(url, signingKey) {
  const headersList = [
    { Authorization: `Bearer ${signingKey}` },
    { Authorization: `Bearer ${hashSigningKey(signingKey)}` },
  ];
  let lastStatus = 0;
  for (const headers of headersList) {
    const res = await fetch(url, { headers });
    lastStatus = res.status;
    if (res.status >= 200 && res.status < 300) {
      return { status: res.status, json: await res.json().catch(() => ({})) };
    }
  }
  return { status: lastStatus, json: {} };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const report = {
    inngestDev: presence("INNGEST_DEV"),
    eventKey: presence("INNGEST_EVENT_KEY"),
    signingKey: presence("INNGEST_SIGNING_KEY"),
  };

  report.handshake = await signedLocal("GET");

  const eventKey = readEnv("INNGEST_EVENT_KEY");
  const signingKey = readEnv("INNGEST_SIGNING_KEY");
  if (!eventKey || !signingKey) {
    report.eventSend = "missing-keys";
    console.log(JSON.stringify(report));
    process.exit(1);
  }

  const idempotencyKey = `staging-inngest-ping-${Date.now()}`;
  const sendRes = await fetch(`https://inn.gs/e/${eventKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "nyayagrid/ping",
      data: { idempotencyKey },
    }),
  });
  const sendJson = await sendRes.json().catch(() => ({}));
  const eventIds = Array.isArray(sendJson.ids) ? sendJson.ids : [];
  report.eventSend = {
    httpStatus: sendRes.status,
    eventIdCount: eventIds.length,
    eventIdClass: eventIds[0] && /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(eventIds[0]) ? "ulid" : "none",
  };

  let run = { status: "not-polled" };
  if (eventIds[0]) {
    for (let i = 0; i < 24; i += 1) {
      await sleep(2500);
      const listed = await inngestFetch(
        `https://api.inngest.com/v1/events/${eventIds[0]}/runs`,
        signingKey,
      );
      const rows = Array.isArray(listed.json.data) ? listed.json.data : [];
      report.runsApiStatus = listed.status;
      if (rows.length > 0) {
        const row = rows[0];
        run = {
          status: row.status,
          functionId: functionIdOf(row) || row.function_id || row.function?.id,
          outputOk: row.output?.ok ?? row.output?.data?.ok,
          outputMessage: typeof row.output?.message === "string" ? row.output.message : undefined,
        };
        if (["Completed", "COMPLETED", "Failed", "FAILED", "Cancelled", "CANCELLED"].includes(String(row.status))) {
          break;
        }
      }
    }
  }
  report.syntheticPing = run;

  const apps = await inngestFetch("https://api.inngest.com/v2/apps", signingKey);
  report.appsApiStatus = apps.status;
  const appRows = Array.isArray(apps.json.data) ? apps.json.data : [];
  const appIds = appRows.map((app) => app.id).filter(Boolean);
  const cloudFunctionIds = [];
  for (const appId of appIds.slice(0, 3)) {
    const fns = await inngestFetch(`https://api.inngest.com/v2/apps/${appId}/functions`, signingKey);
    report.functionsApiStatus = fns.status;
    cloudFunctionIds.push(...collectFunctionIds(fns.json));
  }
  if (cloudFunctionIds.length === 0) {
    const fnsV1 = await inngestFetch("https://api.inngest.com/v1/functions", signingKey);
    report.functionsApiStatus = report.functionsApiStatus || fnsV1.status;
    cloudFunctionIds.push(...collectFunctionIds(fnsV1.json));
  }

  const handshakeIds = report.handshake.functionIds || [];
  const registered = [...new Set([...handshakeIds, ...cloudFunctionIds])].sort();
  const missing = EXPECTED_FUNCTION_IDS.filter((id) => !registered.some((got) => String(got).endsWith(id)));
  report.registeredFunctionCount =
    report.handshake.functionCount ?? registered.length;
  report.expectedFunctionCount = EXPECTED_FUNCTION_IDS.length;
  report.registeredFunctionIds = registered.length > 0 ? registered : undefined;
  report.missingExpectedIds = missing;
  report.syncOk =
    report.handshake.status === 200 &&
    report.handshake.mode === "cloud" &&
    report.handshake.authenticationSucceeded === true &&
    report.handshake.hasEventKey === true &&
    report.handshake.hasSigningKey === true &&
    Number(report.handshake.functionCount) >= EXPECTED_FUNCTION_IDS.length;
  report.inngestDevUnset = report.inngestDev === "missing";

  console.log(JSON.stringify(report));
  if (!report.syncOk || !report.inngestDevUnset || report.eventSend.httpStatus >= 300) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: error.name }));
  process.exit(1);
});
