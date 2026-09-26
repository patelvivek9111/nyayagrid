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

test("resume cursor encodes p=<opinion id>", () => {
  const url = resumeCursorUrl(discover, "cl-opinion-11250867", 5);
  assert.equal(Buffer.from(new URL(url).searchParams.get("cursor"), "base64").toString(), "p=11250867");
});
