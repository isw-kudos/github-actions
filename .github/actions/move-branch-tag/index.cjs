// Move branch tag forward: Node implementation (see README.md).
//
// Points a branch tag on ghcr.io at the image a build just pushed, but only
// when that keeps the tag on the newest commit of the branch. Zero npm
// dependencies: the registry is read and written through
// `docker buildx imagetools` (which uses the job's docker login), the GitHub
// API through the global fetch of the node24 runtime. The decision and the
// move loop take their registry and GitHub access as arguments, so
// index.test.cjs runs them against in-memory fakes.

"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { setTimeout: sleep } = require("node:timers/promises");

const REVISION_LABEL = "org.opencontainers.image.revision";
const UNLABELLED = "unlabelled";
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
// <registry>/<path>:<tag> with no registry port, so exactly one colon.
const BRANCH_TAG = /^[a-z0-9./_-]+:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// Both answer in well under a second. Kept short because a slow write is
// part of an older build's check-to-write time (see moveBranchTag).
const CALL_TIMEOUT_MS = 30_000;
// Pauses before reading the tag again after a transient failure or a stale
// decision; their count is the number of such restarts allowed per run.
const RETRY_DELAYS_MS = [5_000, 10_000];

// Compare API status (`<base>...<head>`, as the head relative to the base)
// for "is <commit> on the branch", asked as `<commit>...<branch head>`.
const ON_BRANCH_STATUSES = new Set(["ahead", "identical"]);
// `<tag commit>...<this commit>` once this commit is known to be on the
// branch. `diverged`: the tag's commit cannot be on the branch too, so it
// left it (an amend and force-push). `unknown` is a 404: the tag's commit is
// not in the repository any more. `behind` needs one more check, see decide.
const ACTION_FOR_STATUS_ON_BRANCH = { ahead: "move", diverged: "move", unknown: "move", identical: "keep" };
// The same compare when the branch head cannot be read (branch deleted).
const ACTION_FOR_STATUS_NO_HEAD = { ahead: "move", unknown: "move", identical: "keep", behind: "skip", diverged: "skip" };

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

class NotFoundError extends Error {
  constructor(what) {
    super(`${what}: not found`);
    this.name = "NotFoundError";
  }
}

// A registry or API failure; `isTransient` ones restart the pass.
class CallError extends Error {
  constructor(what, detail, isTransient) {
    super(`${what}: ${detail}`);
    this.name = "CallError";
    this.isTransient = isTransient;
  }
}

// The decision took so long that an older build's write could land after
// the newer build's settle; the pass restarts with a fresh read.
class StaleDecisionError extends Error {
  constructor(elapsedMs, freshMs) {
    super(`deciding took ${elapsedMs / 1000} s, more than ${freshMs / 1000} s`);
    this.name = "StaleDecisionError";
    this.isTransient = true;
  }
}

class UnexpectedCompareStatusError extends Error {
  constructor(status) {
    super(`unexpected compare status '${status}'`);
    this.name = "UnexpectedCompareStatusError";
  }
}

class BranchTagContestedError extends Error {
  constructor(branchTag, holder, sha, maxMoves) {
    super(`${branchTag} was moved away from ${sha} (to ${holder ?? "nothing"}) after each of ${maxMoves} moves`);
    this.name = "BranchTagContestedError";
  }
}

/**
 * The commit an image was built from, from its revision label, or
 * `unlabelled` when there is no 40-hex label. `image` is the `.image` of
 * `imagetools inspect --format '{{json .}}'`: the image config for a
 * single-platform image (attestation manifests are left out) and a
 * platform-keyed map of configs for a multi-platform one, whose platforms
 * share one label.
 */
function revisionOf(image) {
  const config = image && "rootfs" in image ? image : Object.values(image ?? {})[0];
  const revision = config?.config?.Labels?.[REVISION_LABEL] ?? "";
  return COMMIT_SHA.test(revision) ? revision : UNLABELLED;
}

function actionFor(table, status) {
  const action = table[status];
  if (!action) throw new UnexpectedCompareStatusError(status);
  return action;
}

/**
 * Decides what to do with the branch tag; see the table in README.md.
 *
 * @param {object} state
 * @param {string} state.sha this build's commit
 * @param {string} state.digest this build's image digest
 * @param {string|null} state.head the branch head, null when unknown
 * @param {string|null} state.holder the tag's commit, null when the tag does not exist
 * @param {string} state.holderDigest the tag's digest
 * @param {boolean} state.isFirstPass false once this build has moved the tag
 * @param {(base: string, head: string) => Promise<string>} compare compare API status
 * @returns {Promise<{action: "move"|"keep"|"skip", reason: string}>}
 * @throws {UnexpectedCompareStatusError} for a compare status outside the known set
 */
async function decide({ sha, digest, head, holder, holderDigest, isFirstPass }, compare) {
  const result = (action, reason) => ({ action, reason });
  if (holder === sha) {
    // A re-run of a commit pushes a new digest (the `created` label changes)
    // and replaces the earlier build. Only on the first pass: after this
    // build's own move, another digest of this commit is a build of it from
    // another caller workflow running at the same time, and the later one
    // keeps the tag instead of the two moving it back and forth.
    if (holderDigest === digest || !isFirstPass) return result("keep", "it holds this commit");
    return result("move", "it holds an earlier build of this commit");
  }
  // The head's build moves the tag even when the tag is newer than this
  // commit, so a branch reset to an older commit is followed.
  if (sha === head) return result("move", "this commit is the branch head");
  if (holder === null) return result("move", "the tag does not exist");
  if (holder === UNLABELLED) return result("move", "its image has no revision label");
  if (holder === head) return result("skip", "it holds the branch head");
  if (head === null) {
    const status = await compare(holder, sha);
    return result(actionFor(ACTION_FOR_STATUS_NO_HEAD, status), `the branch head is unknown; compare: ${status}`);
  }

  const isOnBranch = async (commit) => ON_BRANCH_STATUSES.has(await compare(commit, head));
  if (!(await isOnBranch(sha))) return result("skip", "this commit is no longer on the branch");
  const status = await compare(holder, sha);
  if (status === "behind") {
    if (await isOnBranch(holder)) return result("skip", "it holds a newer commit on the branch");
    return result("move", "it holds a newer commit that is no longer on the branch");
  }
  return result(actionFor(ACTION_FOR_STATUS_ON_BRANCH, status), `compare: ${status}`);
}

/**
 * Keeps `branchTag` on the newest commit of the branch; see README.md.
 *
 * ghcr.io has no compare-and-set on a tag: an older build that read the tag
 * before this build's write can still write after it, within its own
 * check-to-write time. So after each move this waits `settleMs`, reads the
 * tag again and moves it back if needed; the older build's own second read
 * then sees the newer commit and leaves it. To keep every build's
 * check-to-write well under `settleMs`, a pass whose decision took longer
 * than `settleMs / 2` writes nothing and starts again with a fresh read, and
 * a transient failure restarts the whole pass rather than retrying one call
 * on a stale decision.
 *
 * @returns {Promise<{result: "kept"|"left", moves: number}>}
 * @throws {BranchTagContestedError} when the tag is still moved away after `maxMoves` moves
 */
async function moveBranchTag({ sha, digest, branchTag, settleMs, maxMoves, registry, github, wait = sleep, now = Date.now, log = console.log }) {
  const source = `${branchTag.slice(0, branchTag.lastIndexOf(":"))}@${digest}`;
  const freshMs = settleMs / 2;
  let moves = 0;
  let restarts = 0;
  for (;;) {
    let decision;
    let holder;
    let isWriting = false;
    try {
      const readAt = now();
      const current = await registry.inspect(branchTag);
      holder = current ? current.holder : null;
      const state = {
        sha,
        digest,
        holder,
        holderDigest: current ? current.holderDigest : "",
        head: await github.head(),
        isFirstPass: moves === 0,
      };
      decision = await decide(state, github.compare);
      if (decision.action === "move") {
        if (moves === maxMoves) throw new BranchTagContestedError(branchTag, holder, sha, maxMoves);
        const elapsedMs = now() - readAt;
        if (elapsedMs > freshMs) throw new StaleDecisionError(elapsedMs, freshMs);
        if (moves > 0) log(`::warning::${branchTag} was set to ${holder ?? "nothing"} after this build moved it; moving it again`);
        log(`Moving ${branchTag} from ${holder ?? "(new tag)"} to ${sha} (${digest}): ${decision.reason}`);
        isWriting = true;
        await registry.create(branchTag, source);
      }
    } catch (err) {
      if (!err.isTransient || restarts >= RETRY_DELAYS_MS.length) throw err;
      // A failed write (a timeout, say) may still have landed, so it counts
      // as a move and gets the full settle before the next read.
      const pauseMs = isWriting ? settleMs : RETRY_DELAYS_MS[restarts];
      if (isWriting) moves += 1;
      log(`${err.message}; reading the tag again in ${pauseMs / 1000} s`);
      await wait(pauseMs);
      restarts += 1;
      continue;
    }

    if (decision.action === "keep") {
      if (moves === 0) log(`${branchTag} already holds ${sha} (${digest})`);
      return { result: "kept", moves };
    }
    if (decision.action === "skip") {
      log(`::notice::${branchTag} left at ${holder}: ${decision.reason}`);
      return { result: "left", moves };
    }
    moves += 1;
    await wait(settleMs);
  }
}

// The last `ERROR:` line (buildx writes progress lines to stderr first), or
// the last line.
function errorLineOf(stderr) {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  return [...lines].reverse().find((line) => line.startsWith("ERROR:")) ?? lines.at(-1) ?? "";
}

/** Registry access through `docker buildx imagetools`. */
function dockerRegistry({ exec = promisify(execFile) } = {}) {
  const imagetools = async (args, ref) => {
    try {
      const { stdout } = await exec("docker", ["buildx", "imagetools", ...args], {
        timeout: CALL_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      const message = errorLineOf(String(err.stderr ?? "")) || err.message;
      // Only the reference itself: a missing child manifest or blob of an
      // existing tag also ends in "not found" and is not a missing tag.
      if (message === `ERROR: ${ref}: not found`) throw new NotFoundError(ref);
      throw new CallError(ref, message, true);
    }
  };

  return {
    /** @returns {Promise<{holder: string, holderDigest: string}|null>} null when the tag does not exist */
    async inspect(ref) {
      let stdout;
      try {
        stdout = await imagetools(["inspect", ref, "--format", "{{json .}}"], ref);
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
      const inspected = JSON.parse(stdout);
      return { holder: revisionOf(inspected.image), holderDigest: String(inspected.manifest?.digest ?? "") };
    },
    // --prefer-index=false re-points the tag at a single manifest as is
    // instead of wrapping it in a new index with another digest.
    async create(tag, source) {
      await imagetools(["create", "--prefer-index=false", "--tag", tag, source], source);
    },
  };
}

/** Branch-ref and compare calls on the calling repository. */
function githubApi({ apiUrl, repository, ref, token, fetchImpl = fetch }) {
  const refPath = ref.replace(/^refs\//, "").split("/").map(encodeURIComponent).join("/");
  const get = async (path) => {
    let response;
    try {
      response = await fetchImpl(`${apiUrl}/repos/${repository}/${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new CallError(path, err.message, true);
    }
    if (response.status === 404) throw new NotFoundError(path);
    if (!response.ok) {
      // 5xx and rate limits pass: 429, a 403 with no requests left, or a
      // secondary rate limit (403 with retry-after). Any other 4xx will not
      // change on retry.
      const isRateLimited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")));
      throw new CallError(path, `HTTP ${response.status}`, response.status >= 500 || isRateLimited);
    }
    return response.json();
  };

  return {
    /** @returns {Promise<string|null>} the branch head, null when the branch does not exist */
    async head() {
      try {
        const sha = (await get(`git/ref/${refPath}`))?.object?.sha;
        return COMMIT_SHA.test(sha ?? "") ? sha : null;
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
    /** @returns {Promise<string>} the compare status, `unknown` when either commit is not found */
    async compare(base, head) {
      try {
        return String((await get(`compare/${base}...${head}?per_page=1`))?.status);
      } catch (err) {
        if (err instanceof NotFoundError) return "unknown";
        throw err;
      }
    },
  };
}

/**
 * Reads and validates the action inputs and the runner's GITHUB_* variables.
 * @throws {InputError} naming the first invalid value
 */
function readInputs(env) {
  const input = (name) => String(env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
  const integer = (name, min, max) => {
    const value = Number(input(name));
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new InputError(`${name} '${input(name)}' is not an integer from ${min} to ${max}`);
    }
    return value;
  };
  const inputs = {
    branchTag: input("branch-tag"),
    digest: input("digest"),
    settleMs: integer("settle-seconds", 0, 600) * 1000,
    maxMoves: integer("max-moves", 1, 10),
    token: input("github-token"),
    sha: String(env.GITHUB_SHA ?? ""),
    ref: String(env.GITHUB_REF ?? ""),
    repository: String(env.GITHUB_REPOSITORY ?? ""),
    apiUrl: String(env.GITHUB_API_URL || "https://api.github.com"),
  };
  const checks = [
    ["branch-tag", inputs.branchTag, BRANCH_TAG.test(inputs.branchTag)],
    ["digest", inputs.digest, IMAGE_DIGEST.test(inputs.digest)],
    ["GITHUB_SHA", inputs.sha, COMMIT_SHA.test(inputs.sha)],
    ["GITHUB_REF", inputs.ref, inputs.ref.startsWith("refs/heads/")],
    ["GITHUB_REPOSITORY", inputs.repository, REPOSITORY.test(inputs.repository)],
    ["github-token", "(empty)", inputs.token !== ""],
  ];
  for (const [name, value, isValid] of checks) {
    if (!isValid) throw new InputError(`unexpected ${name} '${value}'`);
  }
  return inputs;
}

async function main() {
  const inputs = readInputs(process.env);
  await moveBranchTag({
    ...inputs,
    registry: dockerRegistry(),
    github: githubApi(inputs),
  });
}

if (require.main === module) {
  main().catch((err) => {
    // A workflow command ends at a newline, so keep the whole message.
    console.log(`::error title=move-branch-tag::${String(err.message).replace(/\r?\n/g, "%0A")}`);
    process.exit(1);
  });
}

module.exports = {
  BranchTagContestedError,
  CallError,
  InputError,
  NotFoundError,
  StaleDecisionError,
  UNLABELLED,
  UnexpectedCompareStatusError,
  decide,
  dockerRegistry,
  errorLineOf,
  githubApi,
  moveBranchTag,
  readInputs,
  revisionOf,
};
