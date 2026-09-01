import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";

const FIXTURE = path.join(
  process.cwd(),
  "packages/ai/src/evals/golden-fixtures/synth-master-lease-agreement.txt",
);

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

const FAILED_STATES = new Set([
  "failed",
  "extraction_failed",
  "scan_blocked",
  "quarantined",
  "malware_scan_failed",
  "requires_ocr",
]);

async function createMatter(request: APIRequestContext) {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const orgRes = await request.post("/api/v1/organizations", {
    data: { name: `Ingest E2E ${suffix}`, slug: `ingest-e2e-${suffix}`, type: "firm" },
  });
  expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
  const organizationId = (await orgRes.json()).organization.id as string;

  const clientRes = await request.post("/api/v1/clients", {
    data: {
      organizationId,
      clientType: "organization",
      displayName: "Ingest E2E Client",
      organizationName: "Ingest E2E Client",
    },
  });
  expect(clientRes.ok(), await clientRes.text()).toBeTruthy();
  const clientId = (await clientRes.json()).client.id as string;

  const matterRes = await request.post("/api/v1/matters", {
    data: { organizationId, clientId, title: "Ingest E2E Matter" },
  });
  expect(matterRes.ok(), await matterRes.text()).toBeTruthy();
  const matterId = (await matterRes.json()).matter.id as string;
  return { organizationId, matterId };
}

async function uploadFile(
  request: APIRequestContext,
  matterId: string,
  filePath: string,
  filename?: string,
) {
  const res = await request.post(`/api/v1/matters/${matterId}/documents`, {
    multipart: {
      file: {
        name: filename ?? path.basename(filePath),
        mimeType: filename?.endsWith(".pdf") ? "application/pdf" : "text/plain",
        buffer: readFileSync(filePath),
      },
    },
  });
  const body = await res.json();
  return { status: res.status(), body };
}

async function loadDocument(request: APIRequestContext, matterId: string, documentId: string) {
  const res = await request.get(`/api/v1/matters/${matterId}/documents`);
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  const doc = (json.documents as Array<Record<string, unknown>>).find(
    (row) => row.id === documentId,
  );
  return { doc, summary: json.processingSummary };
}

test.describe.serial("Document ingest pipeline", () => {
  test("supported synthetic text upload reaches Ready with chunks and embeddings", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const { organizationId, matterId } = await createMatter(request);
    const uploaded = await uploadFile(request, matterId, FIXTURE);
    expect(uploaded.status).toBe(202);
    expect(uploaded.body.processing?.accepted).toBe(true);
    const documentId = uploaded.body.document.id as string;
    const versionId = uploaded.body.version.id as string;
    const storageKey = uploaded.body.version.storageKey as string;
    expect(storageKey.startsWith(`org/${organizationId}/`)).toBeTruthy();

    await expect
      .poll(
        async () => {
          const { doc } = await loadDocument(request, matterId, documentId);
          return (doc?.processingState as string | undefined) ?? "missing";
        },
        { timeout: 60_000, intervals: [500, 1_000, 1_000] },
      )
      .toBe("ready");

    const { doc, summary } = await loadDocument(request, matterId, documentId);
    expect(doc?.processingState).toBe("ready");
    expect(doc?.processingError).toBeFalsy();
    expect(summary.ready).toBeGreaterThanOrEqual(1);
    expect(summary.attention).toBe(0);

    const downloadRes = await request.get(
      `/api/v1/matters/${matterId}/documents/${documentId}/download`,
    );
    expect(downloadRes.ok()).toBeTruthy();
    const download = (await downloadRes.json()).download;
    expect(download.url).toBeTruthy();
    const objectRes = await request.get(download.url as string);
    expect(objectRes.ok()).toBeTruthy();
    expect((await objectRes.text()).length).toBeGreaterThan(0);

    const sql = postgres(DATABASE_URL);
    try {
      const stored = await sql<Array<{ storage_key: string; processing_state: string }>>`
        select v.storage_key, d.processing_state
        from document_versions v
        join documents d on d.id = v.document_id
        where v.id = ${versionId}
          and v.organization_id = ${organizationId}
      `;
      expect(stored[0]?.storage_key).toBe(storageKey);
      expect(stored[0]?.processing_state).toBe("ready");

      const chunks = await sql<Array<{ n: number; embedded: number }>>`
        select
          count(*)::int as n,
          count(embedding)::int as embedded
        from document_chunks
        where organization_id = ${organizationId}
          and matter_id = ${matterId}
          and document_id = ${documentId}
          and document_version_id = ${versionId}
      `;
      expect(chunks[0]?.n).toBeGreaterThan(0);
      expect(chunks[0]?.embedded).toBe(chunks[0]?.n);

      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const again = await sql<Array<{ n: number }>>`
        select count(*)::int as n
        from document_chunks
        where document_version_id = ${versionId}
      `;
      expect(again[0]?.n).toBe(chunks[0]?.n);
    } finally {
      await sql.end({ timeout: 2 });
    }

    await expect
      .poll(
        async () => {
          const { doc: latest } = await loadDocument(request, matterId, documentId);
          return latest?.processingState;
        },
        { timeout: 15_000 },
      )
      .toBe("ready");
  });

  test("empty text file stays failed and is not Ready", async ({ request }) => {
    test.setTimeout(60_000);
    const { matterId } = await createMatter(request);
    const emptyPath = path.join(tmpdir(), `ingest-empty-${Date.now()}.txt`);
    writeFileSync(emptyPath, "   \n\n  ");
    const uploaded = await uploadFile(request, matterId, emptyPath);
    expect(uploaded.status).toBe(202);
    const documentId = uploaded.body.document.id as string;

    await expect
      .poll(
        async () => {
          const { doc } = await loadDocument(request, matterId, documentId);
          return (doc?.processingState as string | undefined) ?? "missing";
        },
        { timeout: 45_000, intervals: [500, 1_000] },
      )
      .toMatch(/extraction_failed|failed/);

    const { doc, summary } = await loadDocument(request, matterId, documentId);
    expect(FAILED_STATES.has(String(doc?.processingState))).toBeTruthy();
    expect(doc?.processingState).not.toBe("ready");
    expect(summary.ready).toBe(0);
    expect(summary.attention).toBeGreaterThanOrEqual(1);
  });

  test("unauthenticated upload is rejected", async ({ request }) => {
    const res = await request.post(
      "/api/v1/matters/00000000-0000-4000-8000-000000000000/documents",
      {
        headers: { "x-nyayagrid-dev-user": "anonymous" },
        multipart: {
          file: {
            name: "note.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("hello"),
          },
        },
      },
    );
    expect(res.status()).toBe(401);
  });

  test("unsupported archive is rejected at upload and never marked Ready", async ({ request }) => {
    const { matterId } = await createMatter(request);
    const res = await request.post(`/api/v1/matters/${matterId}/documents`, {
      multipart: {
        file: {
          name: "payload.zip",
          mimeType: "application/zip",
          buffer: Buffer.from("PK\u0003\u0004not-a-real-zip"),
        },
      },
    });
    expect(res.status()).toBe(400);
    const listed = await request.get(`/api/v1/matters/${matterId}/documents`);
    const json = await listed.json();
    expect(json.documents ?? []).toHaveLength(0);
  });
});
