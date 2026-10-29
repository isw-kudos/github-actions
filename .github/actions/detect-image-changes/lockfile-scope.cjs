// Decide which images a pnpm lockfile change affects.
//
// The lockfile is one file, but each image installs only its prune closure's
// slice of it. An image's slice is the root importer, the importers it
// reaches from its project dirs (following `link:` versions, so workspace
// packages paths-filter cannot see, such as a submodule's, are covered), the
// catalog entries they use, and every snapshot and package entry their
// resolved versions reach. Every other top-level field, and any document
// before the last (pnpm's own packageManagerDependencies), belongs to every
// image. An image is affected when its slice differs between the base and
// head lockfiles.
//
// Any lockfile this cannot read affects every image: an over-build is
// recoverable, a skipped one is not. Zero npm dependencies; the pure
// functions are exported for unit tests (lockfile-scope.test.cjs).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

class LockfileScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockfileScopeError";
  }
}

const SCOPED_FIELDS = new Set([
  "importers",
  "catalogs",
  "packages",
  "snapshots",
]);
const IMPORTER_DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];
const SNAPSHOT_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies"];

// A YAML scalar as pnpm writes it: plain, 'single' ('' escapes ') or
// "double" (JSON escapes). Flow collections stay raw text: only their
// equality matters here.
function unquote(raw) {
  if (raw.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(raw))
      throw new LockfileScopeError(`unterminated quote: ${raw}`);
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new LockfileScopeError(`unparseable double-quoted scalar: ${raw}`);
    }
  }
  return raw;
}

// `key: value` with a plain or quoted key; value is "" for a nested block.
function splitKey(text) {
  const quoted = /^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*")(:(?: (.*))?)$/.exec(text);
  if (quoted) return [unquote(quoted[1]), (quoted[3] || "").trim()];
  // a plain key ends at the first `:` before a space or the line end, so
  // `pkg@https://host/x.tgz:` keeps its URL
  const plain = /^([^\s'"](?:[^:]|:(?! |$))*?):(?: (.*))?$/.exec(text);
  if (!plain) throw new LockfileScopeError(`not a mapping line: ${text}`);
  return [plain[1], (plain[2] || "").trim()];
}

// The block-style YAML subset pnpm writes: nested mappings, `- item`
// sequences, one-line scalars, flow collections, and the explicit
// `? key` / `: value` form YAML uses for keys over 1024 characters.
// Anything else throws.
function parseDocument(text) {
  const root = Object.create(null);
  // each frame: the container its children go into, or a pending key whose
  // container type the first child line decides
  const stack = [{ indent: -1, container: root }];

  const addLine = (indent, body) => {
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    const frame = stack[stack.length - 1];
    const isItem = body === "-" || body.startsWith("- ");
    if (!frame.container) {
      frame.container = isItem ? [] : Object.create(null);
      frame.parent[frame.key] = frame.container;
    }
    if (isItem) {
      if (!Array.isArray(frame.container))
        throw new LockfileScopeError(
          `sequence item outside a sequence: ${body}`,
        );
      frame.container.push(unquote(body.slice(2).trim()));
      return;
    }
    if (Array.isArray(frame.container))
      throw new LockfileScopeError(`mapping line inside a sequence: ${body}`);
    const explicitKey = /^\?(?: (.*))?$/.exec(body);
    const [key, value] = explicitKey
      ? [unquote((explicitKey[1] || "").trim()), ""]
      : splitKey(body);
    if (value) {
      frame.container[key] = unquote(value);
    } else {
      frame.container[key] = null;
      stack.push({
        indent,
        parent: frame.container,
        key,
        container: null,
        isExplicit: Boolean(explicitKey),
      });
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    const explicitValue = /^:(?: (.*))?$/.exec(body);
    if (!explicitValue) {
      addLine(indent, body);
      continue;
    }
    // `: value` belongs to the `? key` just above it, at the same indent
    const frame = stack[stack.length - 1];
    if (!frame.isExplicit || frame.indent !== indent || frame.container)
      throw new LockfileScopeError(`value with no explicit key: ${body}`);
    const rest = (explicitValue[1] || "").trim();
    if (!rest) continue;
    if (/^[{[]/.test(rest) || !/:( |$)/.test(rest)) {
      frame.parent[frame.key] = unquote(rest);
      stack.pop();
    } else {
      // an inline first entry: its children sit deeper than its own column
      addLine(indent + body.length - rest.length, rest);
    }
  }
  return root;
}

// Documents split on `---`; the last is the workspace lockfile, any earlier
// one is pnpm's env lockfile.
function parseLockfile(text) {
  const documents = text
    .split(/^---[ \t]*$/m)
    .filter((part) => part.trim())
    .map(parseDocument);
  const main = documents.pop();
  if (!main?.importers || typeof main.importers !== "object")
    throw new LockfileScopeError("no importers in the lockfile");
  return { preamble: documents, main };
}

// `1.2.3(peer@1)` -> the packages key `name@1.2.3`; an alias reference
// (`npm:`-style `other@1.0.0`) names its own snapshot.
function snapshotKey(snapshots, name, reference) {
  for (const key of [`${name}@${reference}`, reference]) {
    if (Object.hasOwn(snapshots, key)) return key;
  }
  throw new LockfileScopeError(`no snapshot for ${name}@${reference}`);
}

const packageKey = (key) => {
  const peers = key.indexOf("(");
  return peers === -1 ? key : key.slice(0, peers);
};

// The entries of `lockfile` that installing `projectDirs` reads, by id.
// Throws LockfileScopeError on any reference it cannot resolve.
function sliceEntries({ preamble, main }, projectDirs) {
  const importers = main.importers;
  const snapshots = main.snapshots || Object.create(null);
  const packages = main.packages || Object.create(null);
  const catalogs = main.catalogs || Object.create(null);
  const entries = new Map();
  entries.set("preamble", preamble);
  for (const [field, value] of Object.entries(main)) {
    if (!SCOPED_FIELDS.has(field)) entries.set(`field:${field}`, value);
  }

  const importerQueue = [".", ...projectDirs];
  const snapshotQueue = [];
  while (importerQueue.length) {
    const dir = importerQueue.shift();
    const id = `importer:${dir}`;
    if (entries.has(id)) continue;
    const importer = importers[dir] ?? null;
    entries.set(id, importer);
    if (!importer) continue;
    for (const field of IMPORTER_DEPENDENCY_FIELDS) {
      for (const [name, dependency] of Object.entries(importer[field] || {})) {
        const { specifier = "", version } = dependency || {};
        if (typeof version !== "string")
          throw new LockfileScopeError(`${dir} ${name} has no version`);
        const catalog = /^catalog:(.*)$/.exec(specifier);
        if (catalog) {
          const catalogName = catalog[1] || "default";
          entries.set(
            `catalog:${catalogName}:${name}`,
            catalogs[catalogName]?.[name] ?? null,
          );
        }
        if (version.startsWith("link:")) {
          importerQueue.push(path.posix.join(dir, version.slice(5)));
        } else {
          snapshotQueue.push(snapshotKey(snapshots, name, version));
        }
      }
    }
  }

  while (snapshotQueue.length) {
    const key = snapshotQueue.shift();
    const id = `snapshot:${key}`;
    if (entries.has(id)) continue;
    const snapshot = snapshots[key];
    entries.set(id, snapshot);
    entries.set(
      `package:${packageKey(key)}`,
      packages[packageKey(key)] ?? null,
    );
    if (!snapshot || typeof snapshot !== "object") continue;
    for (const field of SNAPSHOT_DEPENDENCY_FIELDS) {
      for (const [name, reference] of Object.entries(snapshot[field] || {})) {
        if (reference.startsWith("link:"))
          throw new LockfileScopeError(`snapshot ${key} links ${name}`);
        snapshotQueue.push(snapshotKey(snapshots, name, reference));
      }
    }
  }

  return entries;
}

function sliceDigest(lockfile, projectDirs) {
  const entries = sliceEntries(lockfile, projectDirs);
  const hash = createHash("sha256");
  for (const id of [...entries.keys()].sort()) {
    hash.update(`${id}\0${JSON.stringify(entries.get(id))}\0`);
  }
  return hash.digest("hex");
}

// Keys of `roots` ({key: [projectDir, ...]}) whose slice differs between the
// two lockfile texts. A missing base, or a lockfile that does not parse,
// affects every key; `warn` hears why.
function affectedKeys(baseText, headText, roots, warn) {
  const keys = Object.keys(roots);
  let base;
  let head;
  if (headText === null || baseText === null) {
    warn(
      `no ${headText === null ? "head" : "base"} lockfile to compare; every image is affected`,
    );
    return keys;
  }
  try {
    head = parseLockfile(headText);
    base = parseLockfile(baseText);
  } catch (err) {
    if (!(err instanceof LockfileScopeError)) throw err;
    warn(`cannot read the lockfile (${err.message}); every image is affected`);
    return keys;
  }
  return keys.filter((key) => {
    try {
      // a root the head lockfile lacks (keys relative to another dir, or a
      // symlinked project) would hide its dependencies on both sides; one
      // only the base lacks is new, and differs anyway
      const missing = roots[key].find(
        (dir) => !Object.hasOwn(head.main.importers, dir),
      );
      if (missing) throw new LockfileScopeError(`no importer for ${missing}`);
      return sliceDigest(base, roots[key]) !== sliceDigest(head, roots[key]);
    } catch (err) {
      if (!(err instanceof LockfileScopeError)) throw err;
      warn(`${key}: ${err.message}; treating it as affected`);
      return true;
    }
  });
}

// Workflow-command escaping, as @actions/core does it.
function escapeData(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function main() {
  const { HEAD_LOCKFILE, BASE_LOCKFILE, LOCKFILE_ROOTS, GITHUB_OUTPUT } =
    process.env;
  const roots = JSON.parse(LOCKFILE_ROOTS);
  const baseText = fs.existsSync(BASE_LOCKFILE)
    ? fs.readFileSync(BASE_LOCKFILE, "utf8")
    : null;
  const headText = fs.existsSync(HEAD_LOCKFILE)
    ? fs.readFileSync(HEAD_LOCKFILE, "utf8")
    : null;
  const affected = affectedKeys(baseText, headText, roots, (message) =>
    console.log(`::warning title=lockfile-scope::${escapeData(message)}`),
  );
  console.log(`lockfile change affects: ${affected.join(", ") || "nothing"}`);
  fs.appendFileSync(GITHUB_OUTPUT, `affected=${JSON.stringify(affected)}\n`);
}

if (require.main === module) main();

module.exports = {
  LockfileScopeError,
  parseDocument,
  parseLockfile,
  sliceEntries,
  sliceDigest,
  affectedKeys,
};
