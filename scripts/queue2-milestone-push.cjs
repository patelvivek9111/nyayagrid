/**
 * Queue #2 milestone git evidence helper (deterministic — no AI).
 *
 * Stages ONLY explicit canonical paths. Never `git add .` / `-A`.
 * Never stages benchmark dirt or the live worker lock.
 *
 * Usage:
 *   node scripts/queue2-milestone-push.cjs --dry-run
 *   node scripts/queue2-milestone-push.cjs --message "queue2: milestone"
 *   QUEUE2_MILESTONE_PUSH=1 node scripts/queue2-milestone-push.cjs --message "..."
 */
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  selectMilestoneGitPaths,
  MILESTONE_EVIDENCE_PATHS,
  heartbeatImpliesGitCommit,
} = require("./queue2-worker-lock.cjs");

const root = path.join(__dirname, "..");

function git(args, opts = {}) {
  return spawnSync("git", args, {
    encoding: "utf8",
    cwd: root,
    shell: false,
    ...opts,
  });
}

function listChangedEligible(paths) {
  const status = git(["status", "--short", "--", ...paths]);
  if (status.status !== 0) {
    return { ok: false, err: status.stderr || status.stdout || "git status failed", paths: [] };
  }
  const changed = [];
  for (const line of String(status.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)) {
    const p = line.slice(3).trim().replace(/\\/g, "/");
    if (!p) continue;
    // Guard again against benchmark leakage
    if (p.startsWith("benchmarks/") || p.includes("nyaya-bench")) continue;
    if (p.endsWith("queue2-worker.lock.json")) continue;
    changed.push(p);
  }
  return { ok: true, paths: changed };
}

function planMilestoneCommit(opts = {}) {
  const eligible = selectMilestoneGitPaths(opts.candidates || MILESTONE_EVIDENCE_PATHS);
  const changed = listChangedEligible(eligible);
  return {
    eligible,
    changed: changed.ok ? changed.paths : [],
    statusOk: changed.ok,
    err: changed.err || null,
    shouldCommit: Boolean(changed.ok && changed.paths.length > 0),
    heartbeatWouldCommit: heartbeatImpliesGitCommit(),
  };
}

function runMilestonePush(opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const message = opts.message || "queue2: persist worker milestone evidence";
  const plan = planMilestoneCommit(opts);
  if (!plan.statusOk) {
    return { ok: false, reason: "git_status_failed", err: plan.err, plan };
  }
  if (!plan.shouldCommit) {
    return { ok: true, committed: false, reason: "no_meaningful_change", plan, pushed: false };
  }
  if (dryRun) {
    return { ok: true, committed: false, reason: "dry_run", plan, push: false };
  }

  const add = git(["add", "--", ...plan.changed]);
  if (add.status !== 0) {
    return { ok: false, reason: "git_add_failed", err: add.stderr || add.stdout, plan };
  }
  const commit = git(["commit", "-m", message]);
  if (commit.status !== 0) {
    const combined = `${commit.stdout || ""}${commit.stderr || ""}`;
    if (/nothing to commit/i.test(combined)) {
      return { ok: true, committed: false, reason: "nothing_to_commit", plan, pushed: false };
    }
    return { ok: false, reason: "git_commit_failed", err: combined, plan };
  }

  let pushed = false;
  if (opts.push) {
    const push = git(["push", "origin", "HEAD"]);
    if (push.status !== 0) {
      return {
        ok: false,
        reason: "git_push_failed",
        err: push.stderr || push.stdout,
        plan,
        committed: true,
        pushed: false,
      };
    }
    pushed = true;
  }
  return { ok: true, committed: true, pushed, plan, message };
}

function parseArgs(argv) {
  const out = { dryRun: false, push: false, message: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--push") out.push = true;
    else if (a === "--message" || a === "-m") {
      out.message = argv[i + 1] || null;
      i += 1;
    }
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = runMilestonePush({
    dryRun: args.dryRun || process.env.QUEUE2_MILESTONE_DRY_RUN === "1",
    push: args.push || process.env.QUEUE2_MILESTONE_PUSH === "1",
    message: args.message,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  planMilestoneCommit,
  runMilestonePush,
  selectMilestoneGitPaths,
  MILESTONE_EVIDENCE_PATHS,
  heartbeatImpliesGitCommit,
};
