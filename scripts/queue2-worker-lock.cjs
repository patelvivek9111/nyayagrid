/**
 * Queue #2 durable worker ownership lock.
 *
 * Deterministic only — no AI / no network.
 * Canonical path: packages/research/corpus/reports/queue2-worker.lock.json
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const LOCK_SCHEMA_VERSION = 1;
const LOCK_FILENAME = "queue2-worker.lock.json";
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
const STALE_LOCK_MS = 45 * 60 * 1000;

const ACTIVE_REFUSAL_CODE = "QUEUE2_WORKER_ACTIVE";

/**
 * @typedef {object} Queue2WorkerLock
 * @property {number} schemaVersion
 * @property {string} workerId
 * @property {number} pid
 * @property {string} hostname
 * @property {string} startedAt
 * @property {string} lastHeartbeatAt
 * @property {string|null} currentLane
 * @property {string|null} currentTask
 * @property {string|null} court
 * @property {string|null} checkpoint
 * @property {string} processStartNonce
 */

function defaultReportsDir(root = path.join(__dirname, "..")) {
  return path.join(root, "packages", "research", "corpus", "reports");
}

function lockPathFor(reportsDir) {
  return path.join(reportsDir, LOCK_FILENAME);
}

function newWorkerId() {
  return `q2-${crypto.randomBytes(6).toString("hex")}`;
}

function newProcessStartNonce() {
  return crypto.randomBytes(8).toString("hex");
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but no permission (treat as alive)
    if (err && (err.code === "EPERM" || err.errno === 1)) return true;
    return false;
  }
}

function readLockFile(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch {
    return { __corrupt: true };
  }
}

function writeLockFile(lockPath, lock) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const tmp = `${lockPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lock, null, 2));
  fs.renameSync(tmp, lockPath);
  return lock;
}

function archiveLockFile(lockPath, reason = "stale") {
  if (!fs.existsSync(lockPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = path.join(
    path.dirname(lockPath),
    `queue2-worker.lock.archived.${stamp}.${reason}.json`,
  );
  fs.copyFileSync(lockPath, archived);
  fs.unlinkSync(lockPath);
  return archived;
}

/**
 * Classify lock: MISSING | CORRUPT | ACTIVE | STALE | MINE
 */
function classifyLock(lock, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const myWorkerId = opts.workerId || null;
  const myNonce = opts.processStartNonce || null;
  const staleMs = opts.staleMs ?? STALE_LOCK_MS;
  const pidAliveFn = opts.isPidAlive || isPidAlive;

  if (!lock) return { status: "MISSING", lock: null };
  if (lock.__corrupt) return { status: "CORRUPT", lock, reason: "unreadable_or_invalid_json" };

  if (
    myWorkerId &&
    lock.workerId === myWorkerId &&
    (!myNonce || lock.processStartNonce === myNonce)
  ) {
    return { status: "MINE", lock };
  }

  const pidAlive = pidAliveFn(lock.pid);
  const hb = lock.lastHeartbeatAt ? new Date(lock.lastHeartbeatAt).getTime() : NaN;
  const ageMs = Number.isFinite(hb) ? now.getTime() - hb : Number.POSITIVE_INFINITY;
  const heartbeatStale = !Number.isFinite(hb) || ageMs >= staleMs;

  // Live PID cannot be stolen regardless of heartbeat age.
  if (pidAlive) {
    return {
      status: "ACTIVE",
      lock,
      pidAlive: true,
      heartbeatAgeMs: Number.isFinite(ageMs) ? ageMs : null,
      reason: heartbeatStale ? "pid_alive_despite_stale_heartbeat" : "pid_alive",
    };
  }

  if (heartbeatStale) {
    return {
      status: "STALE",
      lock,
      pidAlive: false,
      heartbeatAgeMs: Number.isFinite(ageMs) ? ageMs : null,
      reason: "pid_dead_and_heartbeat_stale",
    };
  }

  // PID dead but heartbeat recent — treat as ACTIVE to avoid steal races during restart.
  return {
    status: "ACTIVE",
    lock,
    pidAlive: false,
    heartbeatAgeMs: Number.isFinite(ageMs) ? ageMs : null,
    reason: "recent_heartbeat_pid_unconfirmed",
  };
}

function formatActiveRefusal(lock) {
  const lines = [
    ACTIVE_REFUSAL_CODE,
    `workerId=${lock?.workerId || "unknown"}`,
    `lane=${lock?.currentLane || "unknown"}`,
    `task=${lock?.currentTask || "unknown"}`,
    `lastHeartbeat=${lock?.lastHeartbeatAt || "unknown"}`,
  ];
  return lines.join("\n");
}

function buildLock(fields = {}) {
  const nowIso = (fields.now || new Date()).toISOString();
  return {
    schemaVersion: LOCK_SCHEMA_VERSION,
    workerId: fields.workerId || newWorkerId(),
    pid: fields.pid ?? process.pid,
    hostname: fields.hostname || os.hostname(),
    startedAt: fields.startedAt || nowIso,
    lastHeartbeatAt: fields.lastHeartbeatAt || nowIso,
    currentLane: fields.currentLane ?? null,
    currentTask: fields.currentTask ?? null,
    court: fields.court ?? null,
    checkpoint: fields.checkpoint ?? null,
    processStartNonce: fields.processStartNonce || newProcessStartNonce(),
  };
}

/**
 * Acquire ownership. Never steals an ACTIVE lock. Recovers STALE/CORRUPT via archive.
 *
 * @returns {{ ok: boolean, code?: string, lock?: Queue2WorkerLock, recovered?: boolean, archivedPath?: string|null, refusal?: string, reviewReason?: string|null }}
 */
function acquireWorkerLock(opts = {}) {
  const reportsDir = opts.reportsDir || defaultReportsDir();
  const lockPath = opts.lockPath || lockPathFor(reportsDir);
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const workerId = opts.workerId || newWorkerId();
  const processStartNonce = opts.processStartNonce || newProcessStartNonce();
  const hostname = opts.hostname || os.hostname();
  const pid = opts.pid ?? process.pid;
  const classifyOpts = {
    now,
    workerId,
    processStartNonce,
    staleMs: opts.staleMs ?? STALE_LOCK_MS,
    isPidAlive: opts.isPidAlive || isPidAlive,
  };

  const existing = readLockFile(lockPath);
  const classified = classifyLock(existing, classifyOpts);

  if (classified.status === "MINE") {
    const refreshed = writeLockFile(lockPath, {
      ...classified.lock,
      pid,
      hostname,
      lastHeartbeatAt: now.toISOString(),
      currentLane: opts.currentLane ?? classified.lock.currentLane,
      currentTask: opts.currentTask ?? classified.lock.currentTask,
      court: opts.court ?? classified.lock.court,
      checkpoint: opts.checkpoint ?? classified.lock.checkpoint,
    });
    return { ok: true, lock: refreshed, recovered: false, code: "REENTRANT" };
  }

  if (classified.status === "ACTIVE") {
    // Hostname+PID mismatch with alive foreign lock → ownership inconsistency for review callers.
    let reviewReason = null;
    if (
      classified.lock?.hostname === hostname &&
      classified.pidAlive &&
      classified.lock.workerId !== workerId
    ) {
      reviewReason = "ACTIVE_PID_MISMATCHED_WORKER_ID";
    }
    return {
      ok: false,
      code: ACTIVE_REFUSAL_CODE,
      lock: classified.lock,
      refusal: formatActiveRefusal(classified.lock),
      reviewReason,
    };
  }

  let archivedPath = null;
  let recovered = false;
  if (classified.status === "STALE" || classified.status === "CORRUPT") {
    archivedPath = archiveLockFile(lockPath, classified.status === "CORRUPT" ? "corrupt" : "stale");
    recovered = true;
  }

  const lock = buildLock({
    workerId,
    pid,
    hostname,
    now,
    processStartNonce,
    currentLane: opts.currentLane ?? null,
    currentTask: opts.currentTask ?? null,
    court: opts.court ?? null,
    checkpoint: opts.checkpoint ?? null,
  });
  writeLockFile(lockPath, lock);
  return {
    ok: true,
    lock,
    recovered,
    archivedPath,
    code: recovered ? "LOCK_RECOVERED" : "LOCK_ACQUIRED",
  };
}

/**
 * Refresh heartbeat fields. Pure local FS — no AI, no git.
 */
function refreshWorkerHeartbeat(opts = {}) {
  const reportsDir = opts.reportsDir || defaultReportsDir();
  const lockPath = opts.lockPath || lockPathFor(reportsDir);
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const existing = readLockFile(lockPath);
  if (!existing || existing.__corrupt) {
    return { ok: false, reason: "missing_or_corrupt_lock" };
  }
  if (opts.workerId && existing.workerId !== opts.workerId) {
    return { ok: false, reason: "not_owner", lock: existing };
  }
  if (opts.processStartNonce && existing.processStartNonce !== opts.processStartNonce) {
    return { ok: false, reason: "nonce_mismatch", lock: existing };
  }

  const next = {
    ...existing,
    lastHeartbeatAt: now.toISOString(),
    currentLane: opts.currentLane ?? existing.currentLane,
    currentTask: opts.currentTask ?? existing.currentTask,
    court: opts.court ?? existing.court,
    checkpoint: opts.checkpoint ?? existing.checkpoint,
    pid: opts.pid ?? existing.pid ?? process.pid,
  };
  writeLockFile(lockPath, next);
  return { ok: true, lock: next, aiCalls: 0, gitPush: false };
}

/**
 * Release only if we own the lock (workerId + nonce).
 */
function releaseWorkerLock(opts = {}) {
  const reportsDir = opts.reportsDir || defaultReportsDir();
  const lockPath = opts.lockPath || lockPathFor(reportsDir);
  const existing = readLockFile(lockPath);
  if (!existing || existing.__corrupt) {
    return { ok: true, reason: "already_absent" };
  }
  if (opts.workerId && existing.workerId !== opts.workerId) {
    return { ok: false, reason: "not_owner", lock: existing };
  }
  if (opts.processStartNonce && existing.processStartNonce !== opts.processStartNonce) {
    return { ok: false, reason: "nonce_mismatch", lock: existing };
  }
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  return { ok: true, reason: "released" };
}

/**
 * Shared mutator guard.
 * mode: "mutate" | "readonly"
 *
 * @returns {{ allowed: boolean, code?: string, refusal?: string, lock?: object|null }}
 */
function assertQueue2Access(opts = {}) {
  const mode = opts.mode || "mutate";
  if (mode === "readonly") {
    return { allowed: true, mode: "readonly", lock: readLockFile(opts.lockPath || lockPathFor(opts.reportsDir || defaultReportsDir())) };
  }

  const reportsDir = opts.reportsDir || defaultReportsDir();
  const lockPath = opts.lockPath || lockPathFor(reportsDir);
  const existing = readLockFile(lockPath);
  const classified = classifyLock(existing, {
    now: opts.now || new Date(),
    workerId: opts.workerId || null,
    processStartNonce: opts.processStartNonce || null,
    staleMs: opts.staleMs ?? STALE_LOCK_MS,
    isPidAlive: opts.isPidAlive || isPidAlive,
  });

  if (classified.status === "MISSING" || classified.status === "STALE" || classified.status === "CORRUPT") {
    // No active owner — mutator must acquire via acquireWorkerLock (caller responsibility for one-shots).
    if (opts.requireExistingOwner) {
      return { allowed: false, code: "QUEUE2_NO_OWNER", reason: classified.status };
    }
    return { allowed: true, mode: "mutate", lock: existing, classified: classified.status };
  }

  if (classified.status === "MINE") {
    return { allowed: true, mode: "mutate", lock: classified.lock, classified: "MINE" };
  }

  // ACTIVE foreign lock
  return {
    allowed: false,
    code: ACTIVE_REFUSAL_CODE,
    refusal: formatActiveRefusal(classified.lock),
    lock: classified.lock,
    classified: "ACTIVE",
  };
}

/**
 * CLI-friendly: refuse mutating entry if another worker owns Queue #2.
 * Returns exit payload; does not kill the other worker.
 */
function refuseIfForeignOwner(opts = {}) {
  const check = assertQueue2Access({ ...opts, mode: "mutate" });
  if (check.allowed) return { ok: true, ...check };
  return {
    ok: false,
    code: check.code || ACTIVE_REFUSAL_CODE,
    message: check.refusal || ACTIVE_REFUSAL_CODE,
    lock: check.lock || null,
  };
}

/**
 * Canonical milestone evidence paths (relative to repo root).
 * Never includes benchmark dirt or live lock.
 */
const MILESTONE_EVIDENCE_PATHS = Object.freeze([
  "packages/research/corpus/reports/corpus-worker-status.json",
  "packages/research/corpus/reports/corpus-worker-daily.md",
  "packages/research/corpus/reports/corpus-worker-events.jsonl",
  "packages/research/corpus/reports/queue2-dual-lane-state.json",
  "packages/research/corpus/reports/queue2-dual-lane-final.json",
  "scripts/queue2-dual-lane-controller.cjs",
  "scripts/queue2-worker-observability.cjs",
  "scripts/queue2-worker-lock.cjs",
  "scripts/run-queue2-dual-lane.cjs",
  "scripts/queue2-milestone-push.cjs",
]);

const MILESTONE_BLOCKED_PREFIXES = Object.freeze([
  "benchmarks/",
  "benchmarks\\",
]);

const MILESTONE_BLOCKED_NAMES = Object.freeze([
  LOCK_FILENAME,
  "queue2-dual-lane-quota-probe.txt",
  "queue2-dual-lane-a.txt",
  "queue2-dual-lane-b.txt",
]);

/**
 * Select explicit git paths for a milestone commit. Never stages benchmarks or lock.
 */
function selectMilestoneGitPaths(candidatePaths = MILESTONE_EVIDENCE_PATHS, opts = {}) {
  const blockedPrefixes = opts.blockedPrefixes || MILESTONE_BLOCKED_PREFIXES;
  const blockedNames = new Set(opts.blockedNames || MILESTONE_BLOCKED_NAMES);
  const out = [];
  for (const p of candidatePaths) {
    const norm = String(p).replace(/\\/g, "/");
    const base = path.posix.basename(norm);
    if (blockedNames.has(base)) continue;
    if (blockedPrefixes.some((b) => norm.startsWith(b.replace(/\\/g, "/")))) continue;
    if (norm.includes("nyaya-bench")) continue;
    out.push(norm);
  }
  return out;
}

/**
 * Heartbeat must never imply a git commit. Pure policy helper for tests/runners.
 */
function heartbeatImpliesGitCommit() {
  return false;
}

module.exports = {
  LOCK_SCHEMA_VERSION,
  LOCK_FILENAME,
  HEARTBEAT_INTERVAL_MS,
  STALE_LOCK_MS,
  ACTIVE_REFUSAL_CODE,
  MILESTONE_EVIDENCE_PATHS,
  MILESTONE_BLOCKED_PREFIXES,
  MILESTONE_BLOCKED_NAMES,
  defaultReportsDir,
  lockPathFor,
  newWorkerId,
  newProcessStartNonce,
  isPidAlive,
  readLockFile,
  writeLockFile,
  archiveLockFile,
  classifyLock,
  formatActiveRefusal,
  buildLock,
  acquireWorkerLock,
  refreshWorkerHeartbeat,
  releaseWorkerLock,
  assertQueue2Access,
  refuseIfForeignOwner,
  selectMilestoneGitPaths,
  heartbeatImpliesGitCommit,
};
