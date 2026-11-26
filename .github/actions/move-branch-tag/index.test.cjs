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
  UNLABELLED,
  UnexpectedCompareStatusError,
  decide,
  dockerRegistry,
  errorLineOf,
  githubApi,
  moveBranchTag,
  readInputs,
  revisionOf,
} = require("./index.cjs");

const sha = (c) => c.repeat(40);
const digest = (c) => `sha256:${c.repeat(64)}`;

// Commit graph. The branch is E - A - T - N - H (head H). X is a child of T
// and Y a child of A that are not on the branch (amended and force-pushed
// away). GONE is not in the repository at all.
const E = sha("e");
const A = sha("a");
const T = sha("1");
const N = sha("b");
const H = sha("2");
const X = sha("3");
const Y = sha("4");
const GONE = sha("c");
const PARENT = { [A]: E, [T]: A, [N]: T, [H]: N, [X]: T, [Y]: A, [E]: null };
const BRANCH_TAG = "ghcr.io/owner/image:main";

function ancestors(commit) {
  const seen = new Set();
  for (let c = commit; c; c = PARENT[c]) seen.add(c);
  return seen;
}

// GitHub's compare: the status of `head` relative to `base`.
async function compareInGraph(base, head) {
  if (!(base in PARENT) || !(head in PARENT)) return "unknown";
  if (base === head) return "identical";
  if (ancestors(head).has(base)) return "ahead";
  return ancestors(base).has(head) ? "behind" : "diverged";
}

// One repository's branch tag, shared by every build in a test. Each image
// digest maps to the commit it was built from.
function fakeRegistry() {
  const commitOf = new Map();
  const registry = {
    tag: null,
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
    },
  };
  return registry;
}

function fakeGithub({ head = H, compare = compareInGraph } = {}) {
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

const realWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function build({ commit, imageDigest, registry, github, settleMs = 0, wait = realWait, now = Date.now, logs = [] }) {
  return moveBranchTag({
    sha: commit,
    digest: imageDigest,
    branchTag: BRANCH_TAG,
    settleMs,
    maxMoves: 3,
    registry,
    github,
    wait,
    now,
    log: (line) => logs.push(line),
  });
}

test("revisionOf reads a single-platform config, a platform map, and missing or invalid labels", () => {
  const config = (labels) => ({ rootfs: {}, config: { Labels: labels } });
  assert.equal(revisionOf(config({ "org.opencontainers.image.revision": T })), T);
  assert.equal(revisionOf({ "linux/amd64": config({ "org.opencontainers.image.revision": T }), "linux/arm64": config({}) }), T);
  assert.equal(revisionOf(config({})), UNLABELLED);
  assert.equal(revisionOf(config({ "org.opencontainers.image.revision": "main" })), UNLABELLED);
  assert.equal(revisionOf(undefined), UNLABELLED);
});

test("decide follows the documented table", async () => {
  const base = { sha: T, digest: digest("1"), head: H, holder: A, holderDigest: digest("a"), isFirstPass: true };
  const cases = [
    ["tag holds this build", { holder: T, holderDigest: digest("1") }, "keep"],
    ["tag holds an earlier build of this commit", { holder: T, holderDigest: digest("9") }, "move"],
    ["another build of this commit after this build moved", { holder: T, holderDigest: digest("9"), isFirstPass: false }, "keep"],
    ["this commit is the head, tag newer (reset)", { head: T, holder: N }, "move"],
    ["tag missing", { holder: null, holderDigest: "" }, "move"],
    ["tag has no revision label", { holder: UNLABELLED }, "move"],
    ["tag holds the head", { holder: H }, "skip"],
    ["tag older on the branch", { holder: A }, "move"],
    ["tag newer on the branch", { holder: N }, "skip"],
    ["tag newer but left the branch", { holder: X }, "move"],
    ["tag diverged and left the branch (amend + force-push)", { holder: Y }, "move"],
    ["tag commit not in the repository", { holder: GONE }, "move"],
    ["this commit left the branch", { sha: X, holder: A }, "skip"],
    ["branch head unknown, tag older", { head: null, holder: A }, "move"],
    ["branch head unknown, tag newer", { head: null, holder: N }, "skip"],
    ["branch head unknown, diverged", { head: null, holder: Y }, "skip"],
  ];
  for (const [name, change, want] of cases) {
    const { action } = await decide({ ...base, ...change }, compareInGraph);
    assert.equal(action, want, name);
  }
  await assert.rejects(decide(base, async (b, h) => (h === H ? "ahead" : "weird")), UnexpectedCompareStatusError);
});

test("errorLineOf picks the buildx ERROR line out of progress output", () => {
  assert.equal(errorLineOf("#1 [internal] pushing\n#1 0.000 copying x\nERROR: denied: permission_denied\n"), "ERROR: denied: permission_denied");
  assert.equal(errorLineOf("first\nlast line\n\n"), "last line");
  assert.equal(errorLineOf(""), "");
});

test("dockerRegistry parses inspect output, treats only the tag itself as not found, and keeps the manifest on create", async () => {
  const calls = [];
  const results = [];
  const registry = dockerRegistry({
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
    image: { rootfs: {}, config: { Labels: { "org.opencontainers.image.revision": T } } },
  }));
  assert.deepEqual(await registry.inspect(BRANCH_TAG), { holder: T, holderDigest: digest("1") });
  assert.deepEqual(calls[0], ["docker", "buildx", "imagetools", "inspect", BRANCH_TAG, "--format", "{{json .}}"]);

  results.push(failure(`ERROR: ${BRANCH_TAG}: not found\n`));
  assert.equal(await registry.inspect(BRANCH_TAG), null);

  // A tag whose child manifest was deleted: the tag exists, so this is an error.
  results.push(failure("ERROR: failed to copy: httpReadSeeker: failed open: content at https://ghcr.io/v2/owner/image/manifests/sha256:9939 not found: not found\n"));
  await assert.rejects(registry.inspect(BRANCH_TAG), (err) => err instanceof CallError && err.isTransient && /httpReadSeeker/.test(err.message));

  results.push(failure("#1 [internal] pushing ghcr.io/owner/image:main\nERROR: unexpected status 502\n"));
  await assert.rejects(registry.create(BRANCH_TAG, `ghcr.io/owner/image@${digest("1")}`), /: ERROR: unexpected status 502$/);
  assert.deepEqual(calls.at(-1), [
    "docker", "buildx", "imagetools", "create", "--prefer-index=false", "--tag", BRANCH_TAG, `ghcr.io/owner/image@${digest("1")}`,
  ]);
});

test("githubApi encodes the ref, maps 404s, and marks only transient statuses for a retry", async () => {
  const requests = [];
  const replies = [];
  const respond = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
  const api = githubApi({
    apiUrl: "https://api.example",
    repository: "owner/repo",
    ref: "refs/heads/feature/a#b",
    token: "t",
    fetchImpl: async (url, init) => {
      requests.push({ url, auth: init.headers.Authorization });
      return replies.shift();
    },
  });

  replies.push(respond(200, { object: { sha: T } }));
  assert.equal(await api.head(), T);
  assert.equal(requests[0].url, "https://api.example/repos/owner/repo/git/ref/heads/feature/a%23b");
  assert.equal(requests[0].auth, "Bearer t");

  replies.push(respond(404, {}));
  assert.equal(await api.head(), null);

  replies.push(respond(200, { status: "ahead" }));
  assert.equal(await api.compare(A, T), "ahead");
  assert.match(requests.at(-1).url, new RegExp(`/compare/${A}\\.\\.\\.${T}\\?per_page=1$`));

  replies.push(respond(404, {}));
  assert.equal(await api.compare(A, T), "unknown");

  const transient = [
    [502, {}],
    [429, {}],
    [403, { "x-ratelimit-remaining": "0" }],
    [403, { "retry-after": "60", "x-ratelimit-remaining": "4000" }],
  ];
  for (const [status, headers] of transient) {
    replies.push(respond(status, {}, headers));
    await assert.rejects(api.compare(A, T), (err) => err instanceof CallError && err.isTransient, `HTTP ${status}`);
  }
  replies.push(respond(403, {}, { "x-ratelimit-remaining": "42" }));
  await assert.rejects(api.compare(A, T), (err) => err instanceof CallError && !err.isTransient);
});

test("readInputs validates every value", () => {
  const env = {
    "INPUT_BRANCH-TAG": BRANCH_TAG,
    INPUT_DIGEST: digest("1"),
    "INPUT_SETTLE-SECONDS": "20",
    "INPUT_MAX-MOVES": "3",
    "INPUT_GITHUB-TOKEN": "t",
    GITHUB_SHA: T,
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

test("moveBranchTag moves, keeps or leaves the tag, and waits the settle after each move", async () => {
  const cases = [
    { name: "tag missing", tag: null, want: { result: "kept", moves: 1 }, final: T },
    { name: "tag holds this build", tag: T, want: { result: "kept", moves: 0 }, final: T },
    { name: "tag older on the branch", tag: A, want: { result: "kept", moves: 1 }, final: T },
    { name: "tag newer on the branch", tag: N, want: { result: "left", moves: 0 }, final: N },
    { name: "tag left the branch (amend + force-push)", tag: Y, want: { result: "kept", moves: 1 }, final: T },
    { name: "this commit is the head after a reset", tag: N, head: T, want: { result: "kept", moves: 1 }, final: T },
    { name: "this commit left the branch", tag: A, commit: X, want: { result: "left", moves: 0 }, final: A },
  ];
  for (const c of cases) {
    const registry = fakeRegistry();
    const imageOf = (commit) => registry.image(commit, `sha256:${commit.slice(0, 1).repeat(64)}`);
    const commit = c.commit ?? T;
    registry.tag = c.tag && imageOf(c.tag);
    const waits = [];
    const result = await build({
      commit,
      imageDigest: imageOf(commit),
      registry,
      github: fakeGithub({ head: c.head ?? H }),
      settleMs: 20000,
      wait: async (ms) => waits.push(ms),
    });
    assert.deepEqual(result, c.want, c.name);
    assert.equal(registry.tag, imageOf(c.final), c.name);
    assert.deepEqual(waits, Array(c.want.moves).fill(20000), c.name);
  }
});

test("a transient failure restarts the pass with backoff, and fails after two restarts", async () => {
  const registry = fakeRegistry();
  const mine = registry.image(T, digest("1"));
  let failures = 1;
  const inspect = registry.inspect;
  registry.inspect = async () => {
    if (failures-- > 0) throw new CallError("inspect", "ERROR: unexpected status 502", true);
    return inspect();
  };
  const waits = [];
  const result = await build({ commit: T, imageDigest: mine, registry, github: fakeGithub(), settleMs: 20000, wait: async (ms) => waits.push(ms) });
  assert.deepEqual(result, { result: "kept", moves: 1 });
  assert.deepEqual(waits, [5000, 20000]);

  failures = 3;
  registry.tag = null;
  await assert.rejects(build({ commit: T, imageDigest: mine, registry, github: fakeGithub(), wait: async () => {} }), /502/);
});

test("a decision that took longer than half the settle writes nothing and reads again", async () => {
  const registry = fakeRegistry();
  const mine = registry.image(T, digest("1"));
  registry.tag = registry.image(A, digest("a"));
  let clock = 0;
  let slowCompares = 1;
  const github = fakeGithub({
    compare: async (base, head) => {
      if (slowCompares-- > 0) clock += 15000;
      return compareInGraph(base, head);
    },
  });
  const logs = [];
  const result = await build({ commit: T, imageDigest: mine, registry, github, settleMs: 20000, wait: async () => {}, now: () => clock, logs });
  assert.deepEqual(result, { result: "kept", moves: 1 });
  assert.equal(registry.creates, 1);
  assert.ok(logs.some((line) => line.startsWith("deciding took 15 s, more than 10 s")));
});

test("a write that fails after landing counts as a move and still gets the settle", async () => {
  const registry = fakeRegistry();
  const mine = registry.image(T, digest("1"));
  const create = registry.create;
  let failures = 1;
  registry.create = async (tag, source) => {
    await create(tag, source);
    if (failures-- > 0) throw new CallError(source, "ERROR: context deadline exceeded", true);
  };
  const waits = [];
  const result = await build({ commit: T, imageDigest: mine, registry, github: fakeGithub(), settleMs: 20000, wait: async (ms) => waits.push(ms) });
  assert.deepEqual(result, { result: "kept", moves: 1 });
  assert.deepEqual(waits, [20000]);
});

test("an older build writing during the settle is moved back", async () => {
  const registry = fakeRegistry();
  const mine = registry.image(T, digest("1"));
  const older = registry.image(A, digest("a"));
  let raced = false;
  const create = registry.create;
  registry.create = async (tag, source) => {
    await create(tag, source);
    if (!raced) {
      raced = true;
      registry.tag = older;
    }
  };
  const logs = [];
  const result = await build({ commit: T, imageDigest: mine, registry, github: fakeGithub(), logs });
  assert.deepEqual(result, { result: "kept", moves: 2 });
  assert.equal(registry.tag, mine);
  assert.ok(logs.some((line) => line.startsWith("::warning::") && line.includes("moving it again")));
});

test("a tag moved away after every one of max-moves moves fails the step", async () => {
  const registry = fakeRegistry();
  const mine = registry.image(T, digest("1"));
  const older = registry.image(A, digest("a"));
  registry.tag = older;
  const create = registry.create;
  registry.create = async (tag, source) => {
    await create(tag, source);
    registry.tag = older;
  };
  await assert.rejects(build({ commit: T, imageDigest: mine, registry, github: fakeGithub() }), BranchTagContestedError);
  assert.equal(registry.creates, 3);
});

test("two builds of the same commit at once (two caller workflows) settle without failing", async () => {
  const registry = fakeRegistry();
  const first = registry.image(T, digest("5"));
  const second = registry.image(T, digest("6"));
  registry.tag = registry.image(A, digest("a"));
  const results = await Promise.all([
    build({ commit: T, imageDigest: first, registry, github: fakeGithub(), settleMs: 30 }),
    build({ commit: T, imageDigest: second, registry, github: fakeGithub(), settleMs: 30 }),
  ]);
  assert.ok(results.every(({ result, moves }) => result === "kept" && moves <= 1));
  assert.ok([first, second].includes(registry.tag));
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

// olderSlowAt: "nothing" (the older write lands right after the newer
// write), "decision" (the older compare answers only after the newer build
// has finished), or "write" (the older decision is quick, but its write
// lands only after the newer build has finished).
async function race({ settleMs, olderSlowAt }) {
  const registry = fakeRegistry();
  const newer = registry.image(T, digest("1"));
  const older = registry.image(A, digest("a"));
  registry.tag = registry.image(E, digest("e"));
  const olderHasRead = gate();
  const newerHasWritten = gate();
  const newerHasFinished = gate();

  let olderReads = 0;
  const registryFor = (isOlder) => ({
    inspect: async () => {
      const current = await registry.inspect();
      if (isOlder && ++olderReads === 1) olderHasRead.open();
      return current;
    },
    create: async (tag, source) => {
      if (isOlder && olderSlowAt === "write") await newerHasFinished.opened;
      await registry.create(tag, source);
      if (!isOlder) newerHasWritten.open();
    },
  });
  // Each build's first compare of the tag's commit waits at its gate.
  const githubFor = (isOlder) =>
    fakeGithub({
      compare: async (base, head) => {
        if (head !== H) {
          const waitFor = isOlder ? (olderSlowAt === "decision" ? newerHasFinished : newerHasWritten) : olderHasRead;
          await waitFor.opened;
        }
        return compareInGraph(base, head);
      },
    });

  const logs = { newer: [], older: [] };
  const newerRun = build({ commit: T, imageDigest: newer, registry: registryFor(false), github: githubFor(false), settleMs, logs: logs.newer })
    .finally(() => newerHasFinished.open());
  const olderRun = build({ commit: A, imageDigest: older, registry: registryFor(true), github: githubFor(true), settleMs, logs: logs.older });
  await Promise.all([newerRun, olderRun]);
  return { final: registry.tag === newer ? "newer" : "older", logs };
}

test("race: an older write after the newer write is moved back after the settle", async () => {
  const { final, logs } = await race({ settleMs: 50, olderSlowAt: "nothing" });
  assert.equal(final, "newer");
  assert.ok(logs.newer.some((line) => line.includes("moving it again")));
});

test("race: an older build whose decision outlasts half the settle reads again and leaves the tag", async () => {
  const { final, logs } = await race({ settleMs: 50, olderSlowAt: "decision" });
  assert.equal(final, "newer");
  assert.ok(logs.older.some((line) => line.startsWith("deciding took")));
  assert.ok(logs.older.some((line) => line.startsWith("::notice::")));
});

test("race: an older write that takes longer than the settle to land still wins (the documented limit)", async () => {
  const { final } = await race({ settleMs: 50, olderSlowAt: "write" });
  assert.equal(final, "older");
});
