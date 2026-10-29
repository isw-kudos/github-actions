// Unit tests for lockfile-scope.cjs — plain `node lockfile-scope.test.cjs`,
// zero dependencies, wired into pre-commit with derive-filters.test.cjs.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  LockfileScopeError,
  parseDocument,
  parseLockfile,
  sliceEntries,
  affectedKeys,
} = require("./lockfile-scope.cjs");

// pnpm 11+ writes its own packageManagerDependencies as a first document.
const ENV_DOCUMENT = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.14.0
        version: 12.14.0
`;

// Two apps over a shared package and a package outside the visible
// workspace (as a submodule's would be), with a catalog, an alias and a
// peer-suffixed snapshot.
function lockfile({
  apiDep = "4.17.21",
  webReact = "19.0.0",
  rootTurbo = "2.0.0",
  zodCatalog = "4.0.0",
  settings = "autoInstallPeers: true",
} = {}) {
  return `${ENV_DOCUMENT}
---
lockfileVersion: '9.0'

settings:
  ${settings}

catalogs:
  default:
    zod:
      specifier: ^4.0.0
      version: ${zodCatalog}
    react:
      specifier: ^19.0.0
      version: ${webReact}

importers:

  .:
    devDependencies:
      turbo:
        specifier: ^2.0.0
        version: ${rootTurbo}

  apps/api:
    dependencies:
      '@repo/utils':
        specifier: workspace:*
        version: link:../../packages/utils
      lodash:
        specifier: ^4.0.0
        version: ${apiDep}

  apps/web:
    dependencies:
      '@repo/utils':
        specifier: workspace:*
        version: link:../../packages/utils
      react-dom:
        specifier: 'catalog:'
        version: ${webReact}(react@${webReact})
      typescript-old:
        specifier: npm:typescript@5.0.0
        version: typescript@5.0.0

  packages/utils:
    dependencies:
      '@vendor/core':
        specifier: workspace:*
        version: link:../../vendor/core

  vendor/core:
    dependencies:
      zod:
        specifier: 'catalog:'
        version: ${zodCatalog}

packages:

  lodash@${apiDep}:
    resolution: {integrity: sha512-lodash${apiDep}}

  react-dom@${webReact}:
    resolution: {integrity: sha512-react-dom}
    peerDependencies:
      react: ^19.0.0

  react@${webReact}:
    resolution: {integrity: sha512-react}

  turbo@${rootTurbo}:
    resolution: {integrity: sha512-turbo}

  typescript@5.0.0:
    resolution: {integrity: sha512-ts}
    hasBin: true

  zod@${zodCatalog}:
    resolution: {integrity: sha512-zod${zodCatalog}}

snapshots:

  lodash@${apiDep}: {}

  react-dom@${webReact}(react@${webReact}):
    dependencies:
      react: ${webReact}
    transitivePeerDependencies:
      - '@types/react'

  react@${webReact}: {}

  turbo@${rootTurbo}: {}

  typescript@5.0.0: {}

  zod@${zodCatalog}: {}
`;
}

const ROOTS = {
  api: ["apps/api", "packages/utils"],
  web: ["apps/web", "packages/utils"],
  smoke: ["apps/api", "apps/web", "packages/utils"],
};

const affected = (base, head, roots = ROOTS) => {
  const warnings = [];
  const keys = affectedKeys(base, head, roots, (message) =>
    warnings.push(message),
  );
  return { keys, warnings };
};

test("parseDocument: mappings, sequences, quoted keys and flow values", () => {
  const parsed = parseDocument(
    [
      "a:",
      "  'quoted@1.0.0(peer@2)':",
      "    resolution: {integrity: x}",
      "    list:",
      "      - 'it''s'",
      "      - plain",
      '  "double": "v"',
      "  empty: {}",
      "b: 'catalog:'",
    ].join("\n"),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    a: {
      "quoted@1.0.0(peer@2)": {
        resolution: "{integrity: x}",
        list: ["it's", "plain"],
      },
      double: "v",
      empty: "{}",
    },
    b: "catalog:",
  });
});

test("parseDocument: shapes outside pnpm's subset throw", () => {
  assert.throws(() => parseDocument("a:\n  - x\n  b: y"), LockfileScopeError);
  assert.throws(() => parseDocument("- x"), LockfileScopeError);
  assert.throws(() => parseDocument("a: 'open"), LockfileScopeError);
});

test("parseDocument: __proto__ is plain data", () => {
  const parsed = parseDocument("__proto__:\n  polluted: yes");
  assert.equal(parsed.__proto__.polluted, "yes");
  assert.equal({}.polluted, undefined);
});

test("parseLockfile: the last document is the workspace lockfile", () => {
  const { preamble, main } = parseLockfile(lockfile());
  assert.equal(preamble.length, 1);
  assert.ok(main.importers["apps/api"]);
  assert.throws(
    () => parseLockfile("lockfileVersion: '9.0'\n"),
    LockfileScopeError,
  );
});

test("sliceEntries: follows links, catalogs, aliases and peer-suffixed snapshots", () => {
  const ids = [...sliceEntries(parseLockfile(lockfile()), ROOTS.web).keys()];
  for (const id of [
    "preamble",
    "field:lockfileVersion",
    "field:settings",
    "importer:.",
    "importer:apps/web",
    "importer:packages/utils",
    "importer:vendor/core",
    "catalog:default:react-dom",
    "catalog:default:zod",
    "snapshot:react-dom@19.0.0(react@19.0.0)",
    "package:react-dom@19.0.0",
    "snapshot:react@19.0.0",
    "snapshot:typescript@5.0.0",
    "snapshot:zod@4.0.0",
    "snapshot:turbo@2.0.0",
  ]) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(!ids.includes("importer:apps/api"));
  assert.ok(!ids.some((id) => id.startsWith("snapshot:lodash")));
});

test("affectedKeys: an identical lockfile affects nothing", () => {
  assert.deepEqual(affected(lockfile(), lockfile()), {
    keys: [],
    warnings: [],
  });
});

test("affectedKeys: a dependency of one app affects that app and aggregates", () => {
  const { keys } = affected(lockfile(), lockfile({ apiDep: "4.17.22" }));
  assert.deepEqual(keys, ["api", "smoke"]);
});

test("affectedKeys: a catalog bump reaches the apps that use it", () => {
  assert.deepEqual(
    affected(lockfile(), lockfile({ webReact: "19.1.0" })).keys,
    ["web", "smoke"],
  );
});

test("affectedKeys: a change through a linked package outside the roots affects both", () => {
  assert.deepEqual(
    affected(lockfile(), lockfile({ zodCatalog: "4.1.0" })).keys,
    ["api", "web", "smoke"],
  );
});

test("affectedKeys: the root importer and top-level fields affect everything", () => {
  assert.deepEqual(
    affected(lockfile(), lockfile({ rootTurbo: "2.1.0" })).keys,
    ["api", "web", "smoke"],
  );
  assert.deepEqual(
    affected(lockfile(), lockfile({ settings: "autoInstallPeers: false" }))
      .keys,
    ["api", "web", "smoke"],
  );
});

test("affectedKeys: a project new at head is affected", () => {
  const roots = { ...ROOTS, docs: ["apps/docs"] };
  const head = lockfile().replace(
    "  packages/utils:",
    "  apps/docs:\n    dependencies:\n      lodash:\n        specifier: ^4.0.0\n        version: 4.17.21\n\n  packages/utils:",
  );
  assert.deepEqual(affected(lockfile(), head, roots).keys, ["docs"]);
});

test("affectedKeys: no base lockfile affects everything, with a warning", () => {
  const { keys, warnings } = affected(null, lockfile());
  assert.deepEqual(keys, ["api", "web", "smoke"]);
  assert.match(warnings[0], /no base lockfile/);
  assert.deepEqual(affected(lockfile(), null).keys, ["api", "web", "smoke"]);
});

test("affectedKeys: an unreadable lockfile affects everything, with a warning", () => {
  const { keys, warnings } = affected("a:\n  - x\n  b: y\n", lockfile());
  assert.deepEqual(keys, ["api", "web", "smoke"]);
  assert.match(warnings[0], /cannot read the lockfile/);
});

test("affectedKeys: an unresolvable reference affects only the image that reaches it", () => {
  const head = lockfile().replace("  lodash@4.17.21: {}\n", "");
  const { keys, warnings } = affected(lockfile(), head);
  assert.deepEqual(keys, ["api", "smoke"]);
  assert.match(warnings[0], /^api: no snapshot for lodash@4.17.21/);
});

test("parseDocument: a plain key may hold a URL's colons", () => {
  const parsed = parseDocument(
    "pkg@https://codeload.github.com/a/b/tar.gz/abc:\n  resolution: {tarball: https://x}",
  );
  assert.equal(
    parsed["pkg@https://codeload.github.com/a/b/tar.gz/abc"].resolution,
    "{tarball: https://x}",
  );
});

test("affectedKeys: a root with no importer is affected, not skipped", () => {
  const roots = { api: ["apps/api"], vendored: ["vendor/apps/api"] };
  const { keys, warnings } = affected(
    lockfile(),
    lockfile({ apiDep: "4.17.22" }),
    roots,
  );
  assert.deepEqual(keys, ["api", "vendored"]);
  assert.match(warnings[0], /^vendored: no importer for vendor\/apps\/api/);
});

test("parseDocument: explicit `? key` entries, block and inline values", () => {
  const parsed = parseDocument(
    [
      "snapshots:",
      "  ? 'long@1.0.0(peer@2)'",
      "  : dependencies:",
      "      dep: 1.0.0",
      "    transitivePeerDependencies:",
      "      - x",
      "  ? 'empty@1.0.0'",
      "  : {}",
      "  ? 'block@1.0.0'",
      "  :",
      "    dependencies:",
      "      dep: 2.0.0",
      "  plain@1.0.0: {}",
    ].join("\n"),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    snapshots: {
      "long@1.0.0(peer@2)": {
        dependencies: { dep: "1.0.0" },
        transitivePeerDependencies: ["x"],
      },
      "empty@1.0.0": "{}",
      "block@1.0.0": { dependencies: { dep: "2.0.0" } },
      "plain@1.0.0": "{}",
    },
  });
  assert.throws(() => parseDocument("a:\n  : x"), LockfileScopeError);
});
