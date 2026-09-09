import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";

export type PutObjectInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
};

export type StoredObject = {
  key: string;
  etag?: string;
};

export type StoredObjectHead = {
  key: string;
  byteSize: number;
  contentType?: string;
  metadata: Record<string, string>;
};

export type SignedDownloadUrlInput = {
  key: string;
  /** Defaults to 300 seconds. Callers should keep this short-lived. */
  expiresInSeconds?: number;
  /** RFC 6266 Content-Disposition header value to attach to the presigned response. */
  contentDisposition?: string;
};

export interface StorageProvider {
  readonly name: string;
  ensureBucket(): Promise<void>;
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(key: string): Promise<Buffer>;
  /** Returns null when the object is absent. Does not download the body. */
  headObject(key: string): Promise<StoredObjectHead | null>;
  getSignedDownloadUrl(input: SignedDownloadUrlInput): Promise<string>;
}

export type S3CompatibleConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
  /** Requests SSE-S3 (AES256) encryption at rest on every put. */
  serverSideEncryption?: boolean;
};

const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 300;
const MAX_SIGNED_URL_EXPIRES_SECONDS = 3600;

export class S3CompatibleStorageProvider implements StorageProvider {
  readonly name: string;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly serverSideEncryption: boolean;

  constructor(config: S3CompatibleConfig, name = "s3-compatible") {
    this.name = name;
    this.bucket = config.bucket;
    this.serverSideEncryption = config.serverSideEncryption ?? false;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      // Managed buckets (R2/S3) already exist. Creating from the app token is usually
      // denied and would hide the real HeadBucket failure behind a second error.
      if (this.name === "aws-s3") throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    // Objects are never written with an ACL, so buckets stay private-by-default regardless of
    // caller input; access is only ever granted via short-lived presigned URLs.
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
        ...(this.serverSideEncryption ? { ServerSideEncryption: "AES256" as const } : {}),
      }),
    );
    return { key: input.key, etag: result.ETag };
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object not found: ${key}`);
    return Buffer.from(bytes);
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        key,
        byteSize: result.ContentLength ?? 0,
        contentType: result.ContentType,
        metadata: result.Metadata ?? {},
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const httpStatus = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === "NotFound" || name === "NoSuchKey" || httpStatus === 404) return null;
      throw error;
    }
  }

  async getSignedDownloadUrl(input: SignedDownloadUrlInput): Promise<string> {
    const expiresInSeconds = Math.min(
      Math.max(1, input.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS),
      MAX_SIGNED_URL_EXPIRES_SECONDS,
    );
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ResponseContentDisposition: input.contentDisposition,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

/**
 * Indexed `process.env[name]` access so Next.js cannot replace these with build-time
 * `undefined` the way it does for `process.env.S3_BUCKET` member expressions.
 */
function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveAppEnv(): string {
  return readEnv("APP_ENV") ?? readEnv("NODE_ENV") ?? "development";
}

export function createStorageProviderFromEnv(): StorageProvider {
  const appEnv = resolveAppEnv();
  const usesS3Provider = readEnv("STORAGE_PROVIDER") === "s3";
  const name = usesS3Provider ? "aws-s3" : "minio";
  const endpoint = readEnv("S3_ENDPOINT") ?? "http://localhost:9000";
  const accessKeyId = readEnv("S3_ACCESS_KEY_ID") ?? "nyayagrid";
  const secretAccessKey = readEnv("S3_SECRET_ACCESS_KEY") ?? "nyayagridsecret";
  const bucket = readEnv("S3_BUCKET") ?? "nyayagrid-documents";
  const region = readEnv("S3_REGION") ?? "us-east-1";

  if (usesS3Provider && (appEnv === "production" || appEnv === "staging")) {
    const usesDefaultDevCredentials =
      !readEnv("S3_ACCESS_KEY_ID") ||
      !readEnv("S3_SECRET_ACCESS_KEY") ||
      !readEnv("S3_BUCKET") ||
      accessKeyId === "nyayagrid" ||
      secretAccessKey === "nyayagridsecret" ||
      endpoint.includes("localhost") ||
      endpoint.includes("127.0.0.1");
    if (usesDefaultDevCredentials) {
      throw new Error(
        "STORAGE_PROVIDER=s3 in production/staging requires real S3 configuration " +
          "(S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, non-local S3_ENDPOINT). " +
          "Refusing to start with default development credentials.",
      );
    }
  }

  return new S3CompatibleStorageProvider(
    {
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      bucket,
      forcePathStyle: (readEnv("S3_FORCE_PATH_STYLE") ?? "true") === "true",
      serverSideEncryption: usesS3Provider && appEnv === "production",
    },
    name,
  );
}

export function sha256Buffer(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export class InMemoryStorageProvider implements StorageProvider {
  readonly name = "memory";
  private readonly objects = new Map<
    string,
    { body: Buffer; contentType?: string; metadata: Record<string, string> }
  >();

  async ensureBucket(): Promise<void> {}

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      metadata: input.metadata ?? {},
    });
    return { key: input.key };
  }

  async getObject(key: string): Promise<Buffer> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`Object not found: ${key}`);
    return value.body;
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      key,
      byteSize: value.body.length,
      contentType: value.contentType,
      metadata: value.metadata,
    };
  }

  /**
   * Signed URLs are meaningless without a real object store fronting them. Tests can still
   * exercise download-signing code paths against this fake, deterministic URL — it is never a
   * real fetchable link and must never be treated as one outside tests.
   */
  async getSignedDownloadUrl(input: SignedDownloadUrlInput): Promise<string> {
    if (!this.objects.has(input.key)) {
      throw new Error(`Object not found: ${input.key}`);
    }
    const expiresInSeconds = Math.min(
      Math.max(1, input.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS),
      MAX_SIGNED_URL_EXPIRES_SECONDS,
    );
    const params = new URLSearchParams({
      expiresAt: String(Date.now() + expiresInSeconds * 1000),
    });
    if (input.contentDisposition) params.set("disposition", input.contentDisposition);
    return `memory://signed/${encodeURIComponent(input.key)}?${params.toString()}`;
  }
}
