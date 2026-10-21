/**
 * Prettier gate for files changed relative to the merge base.
 *
 * `prettier --check .` has failed since the second CI run because the repository
 * never kept a clean formatting baseline (1400+ tracked files). This script keeps
 * enforcement for new and modified files without rewriting that historical debt.
 *
 * CI sets:
 *   PRETTIER_EVENT     pull_request | push
 *   PRETTIER_BASE_SHA  PR base SHA, or github.event.before on push
 *   PRETTIER_HEAD_SHA  commit being checked
 *   PRETTIER_BASE_REF  fallback ref when the push has no previous SHA
 *
 * Locally, the fallback ref is origin/nyaya/integration-checkpoint.
 * Uncommitted changes are included when the checkout is the commit being checked.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as prettier from "prettier";

const EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const LOCAL_BASE_CANDIDATES = [
  "origin/nyaya/integration-checkpoint",
  "nyaya/integration-checkpoint",
  "origin/main",
  "main",
];

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function tryGit(args) {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

function isUnsetSha(sha) {
  return !sha || /^0+$/.test(sha);
}

function commitExists(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function assertSafeRef(ref) {
  if (!/^origin\/[A-Za-z0-9._/-]+$/.test(ref)) {
    throw new Error(`Refusing to fetch unsafe base ref: ${ref}`);
  }
}

function ensureRef(ref) {
  if (tryGit(["rev-parse", "--verify", "--quiet", ref])) {
    return;
  }
  assertSafeRef(ref);
  const branch = ref.slice("origin/".length);
  execFileSync("git", ["fetch", "--no-tags", "origin", branch], { stdio: "inherit" });
  if (!tryGit(["rev-parse", "--verify", "--quiet", ref])) {
    throw new Error(`Base ref ${ref} is not available after fetch.`);
  }
}

function resolveBase(head) {
  const event = process.env.PRETTIER_EVENT || "local";
  const requested = process.env.PRETTIER_BASE_SHA || "";

  if (!isUnsetSha(requested)) {
    if (!commitExists(requested)) {
      const ref = process.env.PRETTIER_BASE_REF;
      if (ref) {
        ensureRef(ref);
      }
    }
    if (!commitExists(requested)) {
      throw new Error(`Base commit ${requested} is not available.`);
    }
    const base = git(["rev-parse", `${requested}^{commit}`]).trim();
    return {
      base,
      mode: event === "push" ? "push" : "merge-base",
    };
  }

  const configured = process.env.PRETTIER_BASE_REF;
  const candidates = configured ? [configured, ...LOCAL_BASE_CANDIDATES] : LOCAL_BASE_CANDIDATES;
  let ref = null;
  for (const candidate of candidates) {
    if (tryGit(["rev-parse", "--verify", "--quiet", candidate])) {
      ref = candidate;
      break;
    }
  }
  if (!ref && configured) {
    ensureRef(configured);
    ref = configured;
  }
  if (!ref) {
    throw new Error("Could not resolve a Prettier base ref.");
  }

  const base = tryGit(["merge-base", ref, head]);
  if (!base) {
    throw new Error(`Could not resolve merge-base of ${ref} and ${head}.`);
  }
  return { base, mode: "merge-base" };
}

function pathsFrom(args) {
  let out = "";
  try {
    out = git(args);
  } catch {
    return [];
  }
  return out
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function changedPaths(base, head, mode, includeWorktree) {
  const committed =
    mode === "push"
      ? pathsFrom(["diff", "--name-only", "--diff-filter=ACMR", "-z", base, head])
      : pathsFrom(["diff", "--name-only", "--diff-filter=ACMR", "-z", `${base}...${head}`]);

  const worktree = includeWorktree
    ? [
        ...pathsFrom(["diff", "--name-only", "--diff-filter=ACMR", "-z"]),
        ...pathsFrom(["diff", "--name-only", "--cached", "--diff-filter=ACMR", "-z"]),
        ...pathsFrom(["ls-files", "--others", "--exclude-standard", "-z"]),
      ]
    : [];

  return [...new Set([...committed, ...worktree])].sort();
}

function extensionOf(filePath) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = filePath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

async function filesInScope(paths) {
  const scoped = [];
  for (const filePath of paths) {
    if (!EXTENSIONS.has(extensionOf(filePath)) || !existsSync(filePath)) {
      continue;
    }
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      continue;
    }
    const info = await prettier.getFileInfo(filePath, {
      ignorePath: ".prettierignore",
      resolveConfig: true,
    });
    if (info.ignored || info.inferredParser == null) {
      continue;
    }
    scoped.push(filePath);
  }
  return scoped;
}

async function unformatted(filePath) {
  const config = (await prettier.resolveConfig(filePath, { editorconfig: true })) ?? {};
  const source = readFileSync(filePath, "utf8");
  const formatted = await prettier.format(source, { ...config, filepath: filePath });
  return formatted !== source;
}

async function main() {
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(root);

  const currentHead = git(["rev-parse", "HEAD"]).trim();
  const requestedHead = process.env.PRETTIER_HEAD_SHA;
  const head =
    !requestedHead || requestedHead === "HEAD"
      ? currentHead
      : git(["rev-parse", `${requestedHead}^{commit}`]).trim();
  const { base, mode } = resolveBase(head);
  const includeWorktree = head === currentHead;
  const changed = changedPaths(base, head, mode, includeWorktree);
  const scoped = await filesInScope(changed);

  console.log(
    `prettier-changed: mode=${mode} base=${base.slice(0, 12)} head=${head.slice(0, 12)} files=${scoped.length}`,
  );

  if (scoped.length === 0) {
    console.log("No changed files require Prettier.");
    return;
  }

  const failures = [];
  for (const filePath of scoped) {
    try {
      if (await unformatted(filePath)) {
        failures.push(filePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[error] ${filePath}: ${message}`);
      failures.push(filePath);
    }
  }

  if (failures.length > 0) {
    for (const filePath of failures) {
      console.error(`[warn] ${filePath}`);
    }
    console.error(
      `Code style issues found in ${failures.length} changed file(s). Format those files with Prettier.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`All ${scoped.length} changed file(s) use Prettier code style.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
