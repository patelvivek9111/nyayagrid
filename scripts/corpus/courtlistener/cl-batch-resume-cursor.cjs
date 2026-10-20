/**
 * CourtListener list pages often return more hits than the batch consumes.
 * Resume after the last opinion actually handled. Do not jump to the provider
 * next link until the current page is fully consumed.
 */
"use strict";

function resumeCursorUrl(discoverUrl, sourceExternalId, pageSize) {
  const id = String(sourceExternalId || "").replace(/^cl-opinion-/, "");
  if (!/^\d+$/.test(id)) return null;
  let url;
  try {
    url = new URL(String(discoverUrl || ""));
  } catch {
    return null;
  }
  const token = Buffer.from(`p=${id}`).toString("base64");
  url.searchParams.set("cursor", token);
  if (!url.searchParams.get("order_by")) url.searchParams.set("order_by", "-id");
  const size = Math.min(Math.max(Number(pageSize) || 5, 1), 50);
  url.searchParams.set("page_size", String(size));
  return url.toString();
}

function pageResumeUrl(opts) {
  const processed = Number(opts?.processedCount) || 0;
  const hits = Number(opts?.hitCount) || 0;
  if (hits > 0 && processed < hits) {
    return (
      resumeCursorUrl(opts.discoverUrl, opts.lastSeenExternalId, opts.pageSize) ||
      opts.discoverUrl ||
      opts.nextPage ||
      null
    );
  }
  return opts?.nextPage || null;
}

module.exports = { resumeCursorUrl, pageResumeUrl };
