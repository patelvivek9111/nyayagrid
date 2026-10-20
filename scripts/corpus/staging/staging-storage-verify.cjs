/**
 * Staging R2/S3 proof. Runs on the Fly machine so secrets never leave the host.
 * Prints only statuses, host class, and HTTP codes — never credentials, URLs, or keys.
 */
const {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
  ListObjectVersionsCommand,
  GetObjectAclCommand,
} = require("@aws-sdk/client-s3");

function redact(value) {
  return String(value).replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]");
}

function hostClass(value) {
  if (!value) return "missing";
  if (/localhost|127\.0\.0\.1/i.test(value)) return "localhost";
  if (/r2\.cloudflarestorage\.com/i.test(value)) return "r2";
  if (/amazonaws\.com/i.test(value)) return "s3";
  if (/^https:\/\//i.test(value)) return "https-remote";
  return "opaque";
}

function orgKey(organizationId, name) {
  return `org/${organizationId}/documents/staging-probe/versions/v1/${name}`;
}

function assertKeyBelongs(storageKey, organizationId) {
  const prefix = `org/${organizationId}/`;
  if (!storageKey.startsWith(prefix)) {
    throw new Error("Storage key is outside organization boundary");
  }
}

async function main() {
  const report = {
    storageProvider: process.env.STORAGE_PROVIDER ?? "unset",
    endpointHostClass: hostClass(process.env.S3_ENDPOINT),
    bucketConfigured: Boolean(process.env.S3_BUCKET?.trim()),
    regionConfigured: Boolean(process.env.S3_REGION?.trim()),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE ?? "unset",
    accessKeyConfigured: Boolean(process.env.S3_ACCESS_KEY_ID?.trim()),
    secretConfigured: Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim()),
    localhostCredentials: process.env.S3_ACCESS_KEY_ID === "nyayagrid",
  };

  if (report.storageProvider !== "s3") {
    throw new Error(`STORAGE_PROVIDER is ${report.storageProvider}, expected s3`);
  }
  if (report.endpointHostClass === "localhost" || report.localhostCredentials) {
    throw new Error("Refusing: storage still points at local MinIO defaults");
  }

  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  report.headBucket = "ok";

  let versioning = "unknown";
  try {
    const current = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    versioning = current.Status || "NotEnabled";
    if (versioning !== "Enabled") {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: "Enabled" },
        }),
      );
      const after = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
      versioning = after.Status || "enable-attempted";
    }
  } catch (error) {
    versioning = `unavailable:${error.name || "error"}`;
  }
  report.versioning = versioning;

  const orgA = "org_staging_a";
  const orgB = "org_staging_b";
  const keyA = orgKey(orgA, "probe.txt");
  const keyB = orgKey(orgB, "probe.txt");
  const bodyA = Buffer.from("nyayagrid-staging-storage-probe-a");
  const bodyA2 = Buffer.from("nyayagrid-staging-storage-probe-a-replaced");

  assertKeyBelongs(keyA, orgA);
  let crossOrgAssert = "fail";
  try {
    assertKeyBelongs(keyA, orgB);
  } catch {
    crossOrgAssert = "pass";
  }
  report.crossOrgKeyAssert = crossOrgAssert;

  const put1 = await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: keyA,
      Body: bodyA,
      ContentType: "text/plain",
      Metadata: { organizationid: orgA },
    }),
  );
  report.authorizedPut = put1.ETag ? "ok" : "ok-no-etag";

  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: keyA }));
  const gotBytes = Buffer.from(await got.Body.transformToByteArray());
  report.authorizedGet = gotBytes.equals(bodyA) ? "ok" : "mismatch";

  let aclPublic = "unknown";
  try {
    const acl = await client.send(new GetObjectAclCommand({ Bucket: bucket, Key: keyA }));
    const grants = acl.Grants || [];
    const publicGrant = grants.some((g) =>
      /AllUsers|AuthenticatedUsers/i.test(g.Grantee?.URI || g.Grantee?.Type || ""),
    );
    aclPublic = publicGrant ? "public-grant" : "private";
  } catch (error) {
    aclPublic = `unsupported:${error.name || "error"}`;
  }
  report.objectAcl = aclPublic;

  const anonymousStatuses = [];
  const pathUrl = `${String(endpoint).replace(/\/+$/, "")}/${bucket}/${keyA}`;
  try {
    const res = await fetch(pathUrl, { method: "GET", redirect: "manual" });
    anonymousStatuses.push(res.status);
  } catch {
    anonymousStatuses.push("network-error");
  }
  try {
    const host = new URL(endpoint).host;
    const virtual = `https://${bucket}.${host}/${keyA}`;
    const res = await fetch(virtual, { method: "GET", redirect: "manual" });
    anonymousStatuses.push(res.status);
  } catch {
    anonymousStatuses.push("network-error");
  }
  report.anonymousHttpStatuses = anonymousStatuses;
  report.anonymousDenied = anonymousStatuses.every(
    (s) => s === "network-error" || (typeof s === "number" && s >= 400),
  );

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: keyA,
      Body: bodyA2,
      ContentType: "text/plain",
    }),
  );
  const latest = await client.send(new GetObjectCommand({ Bucket: bucket, Key: keyA }));
  const latestBytes = Buffer.from(await latest.Body.transformToByteArray());
  report.overwriteGet = latestBytes.equals(bodyA2) ? "ok" : "mismatch";

  let recovery = "not-run";
  if (versioning === "Enabled") {
    const versions = await client.send(
      new ListObjectVersionsCommand({ Bucket: bucket, Prefix: keyA }),
    );
    const versionIds = (versions.Versions || [])
      .filter((v) => v.Key === keyA && v.VersionId)
      .map((v) => v.VersionId);
    report.listedVersions = versionIds.length;
    if (versionIds.length >= 2) {
      const older = versionIds[1];
      const restored = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: keyA, VersionId: older }),
      );
      const restoredBytes = Buffer.from(await restored.Body.transformToByteArray());
      recovery = restoredBytes.equals(bodyA) ? "pass" : "content-mismatch";
    } else {
      recovery = "insufficient-versions";
    }
  } else {
    recovery = `versioning-${versioning}`;
  }
  report.recovery = recovery;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: keyB,
      Body: Buffer.from("org-b-marker"),
      ContentType: "text/plain",
    }),
  );
  const guessed = await client.send(new GetObjectCommand({ Bucket: bucket, Key: keyB }));
  const guessedBytes = Buffer.from(await guessed.Body.transformToByteArray());
  report.guessedKeyReadableWithAppCreds = guessedBytes.length > 0;
  report.guessedKeyNote =
    "App IAM can read any key; NyayaGrid must still refuse cross-org via org-prefixed keys + DB/auth scope";

  const toDelete = [keyA, keyB];
  try {
    const listed = await client.send(
      new ListObjectVersionsCommand({ Bucket: bucket, Prefix: "org/org_staging_" }),
    );
    const objects = [];
    for (const v of listed.Versions || []) {
      if (v.Key && v.VersionId) objects.push({ Key: v.Key, VersionId: v.VersionId });
    }
    for (const m of listed.DeleteMarkers || []) {
      if (m.Key && m.VersionId) objects.push({ Key: m.Key, VersionId: m.VersionId });
    }
    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects },
        }),
      );
      report.cleanup = "versions-deleted";
    } else {
      for (const key of toDelete) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }
      report.cleanup = "objects-deleted";
    }
  } catch {
    for (const key of toDelete) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
    report.cleanup = "objects-deleted";
  }

  report.authorizedDelete = "ok";
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: redact(error.name + ": " + error.message) }));
  process.exit(1);
});
