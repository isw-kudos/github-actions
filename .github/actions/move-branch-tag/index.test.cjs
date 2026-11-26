// Unit tests: `node --test .github/actions/move-branch-tag/index.test.cjs`.
// Zero dependencies; wired into pre-commit as a local hook. The registry and
// GitHub API are in-memory fakes, so no network or docker is needed.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
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
} = require("./index.cjs");

const sha = (c) => c.repeat(40);
const digest = (c) => `sha256:${c.repeat(64)}`;
const OLDEST = sha("e");
const OLD = sha("a");
const THIS = sha("1");
const NEW = sha("b");
const ELSEWHERE = sha("f");
// Branch history, oldest first; the fake compare API orders commits by it.
const HISTORY = [OLDEST, OLD, THIS, NEW];
const BRANCH_TAG = "ghcr.io/owner/image:main";
const noWait = async () => {};

function compareByHistory(base, head) {
  const [b, h] = [HISTORY.indexOf(base), HISTORY.indexOf(head)];
  if (b < 0 || h < 0) return "diverged";
  if (h > b) return "ahead";
  return h < b ? "behind" : "identical";
}

// One repository's branch tag, shared by every build in a test. Each image
// digest maps to the commit it was built from.
function fakeRegistry({ tag = null, onCreate = async () => {} } = {}) {
  const commitOf = new Map();
  const registry = {
    tag,
    creates: 0,
    image(commit, imageDigest) {
      commitOf.set(imageDigest, commit);
      return imageDigest;
    },
    async inspect() {
      if (registry.tag === null) return null;
      return { holder: commitOf.get(registry.tag) ?? UNLABELLED, holderDigest: registry.tag };
    },
    async create(branchTag, source) {
      registry.creates += 1;
      registry.tag = source.slice(source.indexOf("@") + 1);
      await onCreate(registry.tag);
    },
  };
  return registry;
}

function fakeGithub({ head = ELSEWHERE, compare = async (base, h) => compareByHistory(base, h) } = {}) {
  const github = {
    compares: 0,
    head: async () => head,
    compare: async (base, h) => {
      github.compares += 1;
      return compare(base, h);
    },
  };
  return github;
}

function build({ commit, imageDigest, registry, github, settleMs = 0, logs = [] }) {
  return moveBranchTag({
    sha: commit,
    digest: imageDigest,
    branchTag: BRANCH_TAG,
    settleMs,
    maxMoves: 3,
    registry,
    github,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => logs.push(line),
  });
}

test("revisionOf reads a single-platform config, a platform map, and missing or invalid labels", () => {
  const config = (labels) => ({ rootfs: {}, config: { Labels: labels } });
  assert.equal(revisionOf(config({ "org.opencontainers.image.revision": THIS })), THIS);
  assert.equal(
    revisionOf({ "linux/amd64": config({ "org.opencontainers.image.revision": THIS }), "linux/arm64": config({}) }),
    THIS,
  );
  assert.equal(revisionOf(config({})), UNLABELLED);
  assert.equal(revisionOf(config({ "org.opencontainers.image.revision": "main" })), UNLABELLED);
  assert.equal(revisionOf(undefined), UNLABELLED);
});

test("decide follows the documented table", () => {
  const base = { sha: THIS, digest: digest("1"), head: ELSEWHERE, holder: OLD, holderDigest: digest("a") };
  const cases = [
    ["tag missing", { holder: null, holderDigest: "" }, "move"],
    ["tag has no revision label", { holder: UNLABELLED }, "move"],
    ["tag holds this commit, same digest", { holder: THIS, holderDigest: digest("1") }, "keep"],
    ["tag holds this commit, other digest (re-run)", { holder: THIS, holderDigest: digest("9") }, "move"],
    ["this commit is the head, tag newer (reset)", { head: THIS, holder: NEW }, "move"],
    ["tag holds the head", { head: NEW, holder: NEW }, "skip"],
    ["neither is the head", {}, "compare"],
    ["compare ahead", { compareStatus: "ahead" }, "move"],
    ["compare unknown (404)", { compareStatus: "unknown" }, "move"],
    ["compare identical", { compareStatus: "identical" }, "keep"],
    ["compare behind", { compareStatus: "behind" }, "skip"],
    ["compare diverged", { compareStatus: "diverged" }, "skip"],
  ];
  for (const [name, change, want] of cases) {
    assert.equal(decide({ ...base, ...change }), want, name);
  }
  assert.throws(() => decide({ ...base, compareStatus: "weird" }), UnexpectedCompareStatusError);
});

test("withRetry retries transient errors with backoff and nothing else", async () => {
  const waits = [];
  const wait = async (ms) => waits.push(ms);
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw new CallError("x", "HTTP 502", true);
    return "ok";
  };
  assert.equal(await withRetry(flaky, { wait, log: () => {} }), "ok");
  assert.deepEqual(waits, [5000, 10000]);

  calls = 0;
  const alwaysDown = async () => {
    calls += 1;
    throw new CallError("x", "HTTP 500", true);
  };
  await assert.rejects(withRetry(alwaysDown, { wait, log: () => {} }), /HTTP 500/);
  assert.equal(calls, 3);

  for (const err of [new CallError("x", "HTTP 401", false), new NotFoundError("x")]) {
    calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls += 1;
        throw err;
      }, { wait, log: () => {} }),
      err,
    );
    assert.equal(calls, 1);
  }
});

test("githubApi encodes the ref, maps 404s, and retries only transient statuses", async () => {
  const requests = [];
  const respond = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers });
  const replies = [];
  const api = githubApi({
    apiUrl: "https://api.example",
    repository: "owner/repo",
    ref: "refs/heads/feature/a#b",
    token: "t",
    wait: noWait,
    log: () => {},
    fetchImpl: async (url, init) => {
      requests.push({ url, auth: init.headers.Authorization });
      return replies.shift();
    },
  });

  replies.push(respond(200, { object: { sha: THIS } }));
  assert.equal(await api.head(), THIS);
  assert.equal(requests[0].url, "https://api.example/repos/owner/repo/git/ref/heads/feature/a%23b");
  assert.equal(requests[0].auth, "Bearer t");

  replies.push(respond(404, {}));
  assert.equal(await api.head(), null);

  replies.push(respond(502, {}), respond(200, { status: "ahead" }));
  assert.equal(await api.compare(OLD, THIS), "ahead");
  assert.match(requests.at(-1).url, new RegExp(`/compare/${OLD}\\.\\.\\.${THIS}\\?per_page=1$`));

  replies.push(respond(404, {}));
  assert.equal(await api.compare(OLD, THIS), "unknown");

  replies.push(respond(403, {}, { "x-ratelimit-remaining": "0" }), respond(200, { status: "behind" }));
  assert.equal(await api.compare(OLD, THIS), "behind");

  const before = requests.length;
  replies.push(respond(403, {}, { "x-ratelimit-remaining": "42" }));
  await assert.rejects(api.compare(OLD, THIS), /HTTP 403/);
  assert.equal(requests.length, before + 1);
});

test("dockerRegistry parses inspect output, maps not found, and keeps the manifest on create", async () => {
  const calls = [];
  const results = [];
  const registry = dockerRegistry({
    wait: noWait,
    log: () => {},
    exec: async (file, args) => {
      calls.push([file, ...args]);
      const next = results.shift();
      if (next instanceof Error) throw next;
      return { stdout: next };
    },
  });
  const failure = (stderr) => Object.assign(new Error("Command failed"), { stderr });

  results.push(JSON.stringify({
    manifest: { digest: digest("1") },
    image: { rootfs: {}, config: { Labels: { "org.opencontainers.image.revision": THIS } } },
  }));
  assert.deepEqual(await registry.inspect(BRANCH_TAG), { holder: THIS, holderDigest: digest("1") });
  assert.deepEqual(calls[0], ["docker", "buildx", "imagetools", "inspect", BRANCH_TAG, "--format", "{{json .}}"]);

  results.push(failure(`ERROR: ${BRANCH_TAG}: not found\n`));
  assert.equal(await registry.inspect(BRANCH_TAG), null);

  results.push(failure("ERROR: unexpected status 502"), "");
  await registry.create(BRANCH_TAG, `ghcr.io/owner/image@${digest("1")}`);
  assert.deepEqual(calls.at(-1), [
    "docker", "buildx", "imagetools", "create", "--prefer-index=false", "--tag", BRANCH_TAG, `ghcr.io/owner/image@${digest("1")}`,
  ]);
  assert.equal(calls.length, 4);
});

test("readInputs validates every value", () => {
  const env = {
    "INPUT_BRANCH-TAG": BRANCH_TAG,
    INPUT_DIGEST: digest("1"),
    "INPUT_SETTLE-SECONDS": "20",
    "INPUT_MAX-MOVES": "3",
    "INPUT_GITHUB-TOKEN": "t",
    GITHUB_SHA: THIS,
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "owner/repo",
  };
  const inputs = readInputs(env);
  assert.equal(inputs.settleMs, 20000);
  assert.equal(inputs.apiUrl, "https://api.github.com");
  const invalid = [
    ["INPUT_BRANCH-TAG", "localhost:5000/image:main"],
    ["INPUT_BRANCH-TAG", "ghcr.io/owner/image"],
    ["INPUT_DIGEST", "sha256:abc"],
    ["INPUT_SETTLE-SECONDS", "1.5"],
    ["INPUT_MAX-MOVES", "0"],
    ["INPUT_GITHUB-TOKEN", ""],
    ["GITHUB_SHA", "main"],
    ["GITHUB_REF", "refs/pull/1/merge"],
    ["GITHUB_REPOSITORY", "owner/repo/x"],
  ];
  for (const [name, value] of invalid) {
    assert.throws(() => readInputs({ ...env, [name]: value }), InputError, name);
  }
});

test("moveBranchTag moves, keeps or leaves the tag as the table says", async () => {
  const cases = [
    { name: "tag missing", tag: null, want: { result: "kept", moves: 1 }, final: "this" },
    { name: "tag holds this build", tag: "this", want: { result: "kept", moves: 0 }, final: "this" },
    { name: "tag older (ahead)", tag: "old", want: { result: "kept", moves: 1 }, final: "this", compares: 1 },
    { name: "tag newer (behind)", tag: "new", want: { result: "left", moves: 0 }, final: "new", compares: 1 },
    { name: "this commit is the head after a reset", tag: "new", head: THIS, want: { result: "kept", moves: 1 }, final: "this" },
    { name: "tag holds the head", tag: "new", head: NEW, want: { result: "left", moves: 0 }, final: "new" },
  ];
  for (const c of cases) {
    const registry = fakeRegistry();
    const images = {
      this: registry.image(THIS, digest("1")),
      old: registry.image(OLD, digest("a")),
      new: registry.image(NEW, digest("b")),
    };
    registry.tag = c.tag && images[c.tag];
    const github = fakeGithub({ head: c.head ?? ELSEWHERE });
    const result = await build({ commit: THIS, imageDigest: images.this, registry, github });
    assert.deepEqual(result, c.want, c.name);
    assert.equal(registry.tag, images[c.final], c.name);
    assert.equal(github.compares, c.compares ?? 0, c.name);
  }
});

test("an older build writing during the settle is moved back", async () => {
  const registry = fakeRegistry();
  const mine = registry.image(THIS, digest("1"));
  const older = registry.image(OLD, digest("a"));
  let raced = false;
  registry.tag = registry.image(OLDEST, digest("e"));
  const onCreate = registry.create;
  registry.create = async (tag, source) => {
    await onCreate(tag, source);
    if (!raced) {
      raced = true;
      registry.tag = older;
    }
  };
  const logs = [];
  const result = await build({ commit: THIS, imageDigest: mine, registry, github: fakeGithub(), logs });
  assert.deepEqual(result, { result: "kept", moves: 2 });
  assert.equal(registry.tag, mine);
  assert.ok(logs.some((line) => line.startsWith("::warning::") && line.includes("moving it again")));
});

test("a tag that stays older after max-moves fails the step", async () => {
  const registry = fakeRegistry();
  const mine = registry.image(THIS, digest("1"));
  const older = registry.image(OLD, digest("a"));
  registry.tag = older;
  const onCreate = registry.create;
  registry.create = async (tag, source) => {
    await onCreate(tag, source);
    registry.tag = older;
  };
  await assert.rejects(build({ commit: THIS, imageDigest: mine, registry, github: fakeGithub() }), BranchTagContestedError);
  assert.equal(registry.creates, 3);
});

// Two builds at once on one tag, in the order that loses without the settle:
// the older build reads the tag before the newer build writes it, and writes
// after. Gates make the order exact instead of timing-dependent.
function gate() {
  let open;
  const opened = new Promise((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

async function race({ settleMs, olderWritesAfter }) {
  const registry = fakeRegistry();
  const newer = registry.image(THIS, digest("1"));
  const older = registry.image(OLD, digest("a"));
  registry.tag = registry.image(OLDEST, digest("e"));
  const olderHasRead = gate();
  const newerHasWritten = gate();
  const newerHasFinished = gate();

  const inspect = registry.inspect;
  let olderReads = 0;
  const registryFor = (isOlder) => ({
    inspect: async (tag) => {
      const current = await inspect(tag);
      if (isOlder && ++olderReads === 1) olderHasRead.open();
      return current;
    },
    create: async (tag, source) => {
      await registry.create(tag, source);
      if (!isOlder) newerHasWritten.open();
    },
  });
  const githubFor = (isOlder) =>
    fakeGithub({
      compare: async (base, head) => {
        await (isOlder ? (olderWritesAfter === "first write" ? newerHasWritten : newerHasFinished) : olderHasRead).opened;
        return compareByHistory(base, head);
      },
    });

  const logs = { newer: [], older: [] };
  const newerRun = build({ commit: THIS, imageDigest: newer, registry: registryFor(false), github: githubFor(false), settleMs, logs: logs.newer })
    .finally(() => newerHasFinished.open());
  const olderRun = build({ commit: OLD, imageDigest: older, registry: registryFor(true), github: githubFor(true), settleMs, logs: logs.older });
  await Promise.all([newerRun, olderRun]);
  return { final: registry.tag === newer ? "newer" : "older", logs };
}

test("race: an older write after the newer write is moved back after the settle", async () => {
  const { final, logs } = await race({ settleMs: 50, olderWritesAfter: "first write" });
  assert.equal(final, "newer");
  assert.ok(logs.newer.some((line) => line.includes("moving it again")));
});

test("race: an older build whose check-to-write outlasts the settle still wins (the documented limit)", async () => {
  const { final } = await race({ settleMs: 50, olderWritesAfter: "newer build finished" });
  assert.equal(final, "older");
});
