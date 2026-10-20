/**
 * Presence-only. Never prints secret values.
 */
const keys = [
  "STORAGE_PROVIDER",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
];
const report = {};
for (const key of keys) {
  const value = process.env[key];
  report[key] = value && String(value).trim() ? "set" : "missing";
}
if (process.env.STORAGE_PROVIDER) {
  report.STORAGE_PROVIDER_VALUE = process.env.STORAGE_PROVIDER;
}
if (process.env.S3_FORCE_PATH_STYLE) {
  report.S3_FORCE_PATH_STYLE_VALUE = process.env.S3_FORCE_PATH_STYLE;
}
const endpoint = process.env.S3_ENDPOINT || "";
if (!endpoint) report.endpointHostClass = "missing";
else if (/localhost|127\.0\.0\.1/i.test(endpoint)) report.endpointHostClass = "localhost";
else if (/r2\.cloudflarestorage\.com/i.test(endpoint)) report.endpointHostClass = "r2";
else if (/amazonaws\.com/i.test(endpoint)) report.endpointHostClass = "s3";
else if (/^https:\/\//i.test(endpoint)) report.endpointHostClass = "https-remote";
else report.endpointHostClass = "opaque";
report.localhostMinioDefault = process.env.S3_ACCESS_KEY_ID === "nyayagrid";
console.log(JSON.stringify(report));
