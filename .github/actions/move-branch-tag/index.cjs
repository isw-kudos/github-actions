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
// Both answer in well under a second; anything near this is a hang.
const CALL_TIMEOUT_MS = 120_000;
const RETRY_DELAYS_MS = [5_000, 10_000];

// Compare API status for `<tag commit>...<this commit>`, read only when
// neither commit is the branch head. `unknown` is a 404: the tag's commit is
// not in the repository any more, so it cannot be newer. `diverged` means
// this commit left the branch (a force-push); the head's build moves the tag.
const ACTION_FOR_COMPARE_STATUS = {
  ahead: "move",
  unknown: "move",
  identical: "keep",
  behind: "skip",
  diverged: "skip",
};

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

// A registry or API failure; `isTransient` ones are retried.
class CallError extends Error {
  constructor(what, detail, isTransient) {
    super(`${what}: ${detail}`);
    this.name = "CallError";
    this.isTransient = isTransient;
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
    super(`${branchTag} still holds ${holder ?? "nothing"}, older than ${sha}, after ${maxMoves} moves`);
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

/**
 * Decides what to do with the branch tag.
 *
 * @param {object} state
 * @param {string} state.sha this build's commit
 * @param {string} state.digest this build's image digest
 * @param {string|null} state.head the branch head, null when unknown
 * @param {string|null} state.holder the tag's commit, null when the tag does not exist
 * @param {string} state.holderDigest the tag's digest
 * @param {string} [state.compareStatus] compare API status for holder...sha
 * @returns {"move"|"keep"|"skip"|"compare"} "compare" when the answer needs compareStatus
 * @throws {UnexpectedCompareStatusError} for a compare status outside the known set
 */
function decide({ sha, digest, head, holder, holderDigest, compareStatus }) {
  // A re-run of a commit pushes a new digest (the `created` label changes)
  // and replaces the earlier build; builds of one commit never overlap,
  // see the `concurrency` group in docker-build-ghcr.yml.
  if (holder === sha) return holderDigest === digest ? "keep" : "move";
  // The head's build moves the tag even when the tag is newer than this
  // commit, so a branch reset to an older commit is followed.
  if (holder === null || holder === UNLABELLED || sha === head) return "move";
  if (holder === head) return "skip";
  if (compareStatus === undefined) return "compare";
  const action = ACTION_FOR_COMPARE_STATUS[compareStatus];
  if (!action) throw new UnexpectedCompareStatusError(compareStatus);
  return action;
}

/**
 * Runs `call`, retrying a transient CallError after each delay in turn.
 * Any other error, and the last failure, is thrown.
 */
async function withRetry(call, { wait = sleep, delaysMs = RETRY_DELAYS_MS, log = console.log } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (err) {
      if (!err.isTransient || attempt >= delaysMs.length) throw err;
      log(`${err.message}; retrying in ${delaysMs[attempt] / 1000} s`);
      await wait(delaysMs[attempt]);
    }
  }
}

/**
 * Keeps `branchTag` on the newest commit of the branch; see README.md.
 * ghcr.io has no compare-and-set on a tag: an older build that read the tag
 * before this build's write can still write after it, within its own
 * check-to-write time. So after each move this waits `settleMs`, reads the
 * tag again and moves it back if needed; the older build's own second read
 * then sees the newer commit and leaves it. Only an older check-to-write
 * longer than `settleMs` can still win.
 *
 * @returns {Promise<{result: "kept"|"left", moves: number}>}
 * @throws {BranchTagContestedError} when the tag is still older after `maxMoves` moves
 */
async function moveBranchTag({ sha, digest, branchTag, settleMs, maxMoves, registry, github, wait = sleep, log = console.log }) {
  const source = `${branchTag.slice(0, branchTag.lastIndexOf(":"))}@${digest}`;
  for (let moves = 0; ; ) {
    const current = await registry.inspect(branchTag);
    const holder = current ? current.holder : null;
    const state = { sha, digest, head: await github.head(), holder, holderDigest: current ? current.holderDigest : "" };
    let action = decide(state);
    if (action === "compare") {
      action = decide({ ...state, compareStatus: await github.compare(holder, sha) });
    }

    if (action === "keep") {
      if (moves === 0) log(`${branchTag} already holds ${sha} (${digest})`);
      return { result: "kept", moves };
    }
    if (action === "skip") {
      log(`::notice::${branchTag} left at ${holder}, a newer commit than ${sha}`);
      return { result: "left", moves };
    }
    if (moves === maxMoves) throw new BranchTagContestedError(branchTag, holder, sha, maxMoves);
    if (moves > 0) log(`::warning::${branchTag} was set to ${holder ?? "nothing"} after this build moved it; moving it again`);
    log(`Moving ${branchTag} from ${holder ?? "(new tag)"} to ${sha} (${digest})`);
    await registry.create(branchTag, source);
    moves += 1;
    await wait(settleMs);
  }
}

/** Registry access through `docker buildx imagetools`. */
function dockerRegistry({ exec = promisify(execFile), wait = sleep, log = console.log } = {}) {
  const imagetools = (args, what) =>
    withRetry(
      async () => {
        try {
          const { stdout } = await exec("docker", ["buildx", "imagetools", ...args], {
            timeout: CALL_TIMEOUT_MS,
            maxBuffer: 16 * 1024 * 1024,
          });
          return stdout;
        } catch (err) {
          const stderr = String(err.stderr ?? "").trim();
          if (/: not found$/m.test(stderr)) throw new NotFoundError(what);
          throw new CallError(what, stderr || err.message, true);
        }
      },
      { wait, log },
    );

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
function githubApi({ apiUrl, repository, ref, token, fetchImpl = fetch, wait = sleep, log = console.log }) {
  const refPath = ref.replace(/^refs\//, "").split("/").map(encodeURIComponent).join("/");
  const get = (path) =>
    withRetry(
      async () => {
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
          // 5xx and rate limits (429, or a 403 with no requests left) pass;
          // any other 4xx will not change on retry.
          const isRateLimited =
            response.status === 429 ||
            (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
          const isTransient = response.status >= 500 || isRateLimited;
          throw new CallError(path, `HTTP ${response.status}`, isTransient);
        }
        return response.json();
      },
      { wait, log },
    );

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
    console.log(`::error title=move-branch-tag::${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  BranchTagContestedError,
  CallError,
  InputError,
  NotFoundError,
  UNLABELLED,
  UnexpectedCompareStatusError,
  decide,
  dockerRegistry,
  githubApi,
  moveBranchTag,
  readInputs,
  revisionOf,
  withRetry,
};
