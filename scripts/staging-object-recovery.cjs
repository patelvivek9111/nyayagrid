/**
 * Staging R2 recovery proof using NyayaGrid unique per-version keys.
 * Does not enable or assume bucket versioning. Never prints credentials, URLs, or object bodies.
 */
const {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { createHash } = require("node:crypto");

function hostClass(value) {
  if (!value) return "missing";
  if (/localhost|127\.0\.0\.1/i.test(value)) return "localhost";
  if (/r2\.cloudflarestorage\.com/i.test(value)) return "r2";
  if (/amazonaws\.com/i.test(value)) return "s3";
  return "opaque";
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function storageKey(organizationId, documentId, versionId, filename) {
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `org/${organizationId}/documents/${documentId}/versions/${versionId}/${safeName}`;
}

function assertKeyBelongs(storageKeyValue, organizationId) {
  if (!storageKeyValue.startsWith(`org/${organizationId}/`)) {
    throw new Error("Storage key is outside organization boundary");
  }
}

async function streamToBuffer(body) {
  return Buffer.from(await body.transformToByteArray());
}

async function main() {
  const report = {
    storageProvider: process.env.STORAGE_PROVIDER ?? "unset",
    endpointHostClass: hostClass(process.env.S3_ENDPOINT),
    bucketConfigured: Boolean(process.env.S3_BUCKET?.trim()),
  };
  if (report.storageProvider !== "s3") {
    throw new Error(`STORAGE_PROVIDER is ${report.storageProvider}, expected s3`);
  }
  if (report.endpointHostClass === "localhost") {
    throw new Error("Refusing: storage still points at local MinIO defaults");
  }

  const bucket = process.env.S3_BUCKET;
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  report.headBucket = "ok";

  const orgA = "00000000-0000-4000-8000-00000000rc1a";
  const orgB = "00000000-0000-4000-8000-00000000rc1b";
  const docId = "00000000-0000-4000-8000-00000000rc1d";
  const v1 = storageKey(orgA, docId, "00000000-0000-4000-8000-00000000rc11", "original.txt");
  const v2 = storageKey(orgA, docId, "00000000-0000-4000-8000-00000000rc12", "original.txt");
  const original = Buffer.from("rc1-original-object\n");
  const later = Buffer.from("rc1-later-version\n");
  const mismatchBody = Buffer.from("rc1-mismatch-body\n");

  assertKeyBelongs(v1, orgA);
  assertKeyBelongs(v2, orgA);
  let crossOrg = "fail";
  try {
    assertKeyBelongs(v1, orgB);
  } catch {
    crossOrg = "pass";
  }
  report.crossOrgKeyDenied = crossOrg;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: v1,
      Body: original,
      ContentType: "text/plain",
      Metadata: { sha256: sha256(original), organizationid: orgA },
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: v2,
      Body: later,
      ContentType: "text/plain",
      Metadata: { sha256: sha256(later), organizationid: orgA },
    }),
  );

  const gotV1 = await client.send(new GetObjectCommand({ Bucket: bucket, Key: v1 }));
  const gotV2 = await client.send(new GetObjectCommand({ Bucket: bucket, Key: v2 }));
  report.originalRecovered = Buffer.from(await streamToBuffer(gotV1.Body)).equals(original)
    ? "pass"
    : "fail";
  report.priorVersionAddressable = Buffer.from(await streamToBuffer(gotV2.Body)).equals(later)
    ? "pass"
    : "fail";

  const mismatchKey = storageKey(orgA, docId, "00000000-0000-4000-8000-00000000rc1m", "mismatch.txt");
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: mismatchKey,
      Body: mismatchBody,
      ContentType: "text/plain",
      Metadata: { sha256: "0".repeat(64) },
    }),
  );
  const mismatchHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: mismatchKey }));
  const storedSha = (mismatchHead.Metadata || {}).sha256;
  report.metadataMismatchDetected = storedSha && storedSha !== sha256(mismatchBody) ? "pass" : "fail";

  let missingFails = "fail";
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: storageKey(orgA, docId, "00000000-0000-4000-8000-00000000rc1x", "missing.txt"),
      }),
    );
  } catch (error) {
    const status = error.$metadata?.httpStatusCode;
    const errName = error && error.name ? String(error.name) : "";
    if (errName === "NotFound" || errName === "NoSuchKey" || status === 404) missingFails = "pass";
    else missingFails = errName || "error";
  }
  report.missingObjectFails = missingFails;

  for (const key of [v1, v2, mismatchKey]) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
  report.cleanup = "ok";
  report.versioningAssumed = false;
  report.ok =
    report.originalRecovered === "pass" &&
    report.priorVersionAddressable === "pass" &&
    report.metadataMismatchDetected === "pass" &&
    report.crossOrgKeyDenied === "pass" &&
    report.missingObjectFails === "pass";
  console.log(JSON.stringify(report));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  const message = String(error && error.message ? error.message : error).replace(
    /[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi,
    "[redacted]",
  );
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
});
