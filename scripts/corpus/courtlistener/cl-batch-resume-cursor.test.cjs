"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resumeCursorUrl, pageResumeUrl } = require("./cl-batch-resume-cursor.cjs");

const discover =
  "https://www.courtlistener.com/api/rest/v4/opinions/?cluster__docket__court=mich&cursor=cD0xMTI1MDg2Nw%3D%3D&order_by=-id&page_size=5";
const providerNext =
  "https://www.courtlistener.com/api/rest/v4/opinions/?cluster__docket__court=mich&cursor=cD0xMDg0MjkxNg%3D%3D&order_by=-id&page_size=5";

test("partial page resumes after the last handled opinion", () => {
  const url = pageResumeUrl({
    processedCount: 5,
    hitCount: 20,
    nextPage: providerNext,
    discoverUrl: discover,
    lastSeenExternalId: "cl-opinion-11108127",
    pageSize: 5,
  });
  const parsed = new URL(url);
  assert.equal(Buffer.from(parsed.searchParams.get("cursor"), "base64").toString(), "p=11108127");
  assert.notEqual(parsed.searchParams.get("cursor"), new URL(providerNext).searchParams.get("cursor"));
});

test("fully consumed page keeps the provider next link", () => {
  const url = pageResumeUrl({
    processedCount: 5,
    hitCount: 5,
    nextPage: providerNext,
    discoverUrl: discover,
    lastSeenExternalId: "cl-opinion-11108127",
    pageSize: 5,
  });
  assert.equal(url, providerNext);
});

test("partial page must not jump to provider next (worker regression)", () => {
  const discover =
    "https://www.courtlistener.com/api/rest/v4/opinions/?cluster__docket__court=vt&order_by=-id&page_size=20";
  const providerNext =
    "https://www.courtlistener.com/api/rest/v4/opinions/?cluster__docket__court=vt&cursor=cD0xMDk5OTk5OQ%3D%3D&order_by=-id&page_size=20";
  const url = pageResumeUrl({
    processedCount: 2,
    hitCount: 20,
    nextPage: providerNext,
    discoverUrl: discover,
    lastSeenExternalId: "cl-opinion-11123456",
    pageSize: 5,
  });
  assert.notEqual(url, providerNext);
  assert.equal(Buffer.from(new URL(url).searchParams.get("cursor"), "base64").toString(), "p=11123456");
  const worker = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "staging-cl-batch-job.ts"),
    "utf8",
  );
  assert.match(worker, /pageResumeUrl/);
  assert.match(worker, /processedThisBatch/);
});
