/**
 * Presence-only REDIS_URL shape. Never prints the URL, host, or password.
 */
function readEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  return String(raw);
}

function classifyHost(host) {
  if (!host) return "missing";
  if (/^localhost$|^127\.0\.0\.1$|^::1$/i.test(host)) return "localhost";
  if (/\.upstash\.io$/i.test(host)) return "upstash";
  return "remote";
}

const raw = readEnv("REDIS_URL") ?? "";
const trimmed = raw.trim();
const unquoted = trimmed.replace(/^['"]+|['"]+$/g, "");
let parsed = null;
try {
  parsed = new URL(unquoted);
} catch {
  parsed = null;
}

const report = {
  rawLength: raw.length,
  trimmedLength: trimmed.length,
  leadingQuote: trimmed.startsWith('"') || trimmed.startsWith("'"),
  trailingQuote: trimmed.endsWith('"') || trimmed.endsWith("'"),
  whitespace: /\s/.test(trimmed),
  atCount: (trimmed.match(/@/g) || []).length,
  scheme: unquoted.startsWith("rediss://") ? "rediss" : unquoted.startsWith("redis://") ? "redis" : "other",
  parseOk: Boolean(parsed),
  usernameLen: parsed ? parsed.username.length : 0,
  passwordLen: parsed ? parsed.password.length : 0,
  hostClass: parsed ? classifyHost(parsed.hostname) : "none",
  port: parsed ? parsed.port || "default" : "none",
  pathname: parsed && parsed.pathname && parsed.pathname !== "/" ? "present" : "none",
  search: parsed && parsed.search ? "present" : "none",
};

console.log(JSON.stringify(report));
if (!report.parseOk || report.passwordLen < 16) process.exit(1);
