// Derive per-image paths-filter YAML from the pnpm workspace graph.
//
// For each image, the filter is what its Dockerfile can put into the image:
// the workspace dependency closure of every `turbo prune <targets> --docker`
// target (dev deps included, as prune does), plus every file the Dockerfile
// COPYs or ADDs straight from the build context, which no closure covers.
// Aggregate filters (e.g. a boot-smoke surface) are the union of several
// images' filters plus extra paths. Every filter starts with the shared paths.
//
// Zero npm dependencies: Node built-ins and the `pnpm` on PATH. The pure
// functions are exported for unit tests (derive-filters.test.cjs).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

class DeriveFiltersError extends Error {
  constructor(message, file) {
    super(message);
    this.name = "DeriveFiltersError";
    this.file = file;
  }
}

// Filter names become paths-filter output names, compared as strings with
// the image keys. They are written as quoted YAML keys, so `1.0` stays
// "1.0" instead of loading as a number.
const FILTER_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
// A pnpm package name, optionally scoped. Anything else among the prune
// arguments (a flag value, a stray shell word) is not a workspace target.
const PACKAGE_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const SHELL_OPERATORS = new Set(["&&", "||", ";", "|"]);
// turbo prune flags whose value can follow as a separate word
const PRUNE_VALUE_FLAGS = new Set(["--out-dir", "--scope"]);
const AGGREGATE_FIELDS = ["exclude", "paths"];
// the paths-filter name of the scoped lockfile, which no image filter lists
const LOCKFILE_FILTER = "lockfile";

// Newline-separated input: trimmed, blank and `#` comment lines dropped.
function parseList(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

// Logical Dockerfile instructions. Docker drops comment and empty lines even
// inside a backslash continuation, so they never end one. A different
// escape character would make every continuation invisible here.
function instructions(text, file) {
  for (const line of text.split(/\r?\n/)) {
    const directive = /^\s*#\s*([a-z]+)\s*=\s*(.*)$/i.exec(line);
    if (!directive) break;
    if (
      directive[1].toLowerCase() === "escape" &&
      directive[2].trim() !== "\\"
    ) {
      throw new DeriveFiltersError(
        `unsupported escape directive "${directive[2].trim()}"; only \\ is parsed`,
        file,
      );
    }
  }
  const result = [];
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.endsWith("\\")) {
      current += `${line.slice(0, -1)} `;
      continue;
    }
    result.push(`${current}${line}`.trim());
    current = "";
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

// Targets of every `turbo prune` in a RUN instruction, with or without
// --docker. The arguments end at the first shell operator; flags and their
// values are dropped, except turbo v1's --scope, which names a target.
function pruneTargets(instruction) {
  if (!/^RUN\s/i.test(instruction)) return [];
  // operators may touch a word (`--docker;`), so space them out first
  const words = instruction
    .replace(/(&&|\|\||;|\|)/g, " $1 ")
    .trim()
    .split(/\s+/);
  const targets = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (!/(^|\/)turbo(@\S+)?$/.test(words[i]) || words[i + 1] !== "prune")
      continue;
    const isArgument = (j) =>
      j < words.length && !SHELL_OPERATORS.has(words[j]);
    for (let j = i + 2; isArgument(j); j++) {
      const word = words[j];
      const scope = /^--scope=(.+)$/.exec(word);
      if (PRUNE_VALUE_FLAGS.has(word) && isArgument(j + 1)) {
        j++;
        if (word === "--scope") targets.push(words[j]);
      } else if (scope) {
        targets.push(scope[1]);
      } else if (!word.startsWith("-")) {
        targets.push(word);
      }
    }
  }
  return targets;
}

// A build-context source as a context-relative path, or null for the whole
// context (`COPY . .`), which prune narrows to the closure. Docker resolves
// `src`, `./src` and `/src` alike against the context root, and removes
// shell-form quotes. A variable or a leftover quote would give a pattern
// that never matches, so it fails the run.
function contextPath(raw, file) {
  const source = raw.replace(/^(["'])(.*)\1$/, "$2");
  if (/["'$]/.test(source)) {
    throw new DeriveFiltersError(
      `build-context source ${raw} uses a variable or quoting that cannot be resolved here; spell the path out`,
      file,
    );
  }
  const relative = path.posix
    .normalize(source)
    .replace(/^(\.?\/)+/, "")
    .replace(/\/+$/, "");
  if (!relative || relative === ".") return null;
  return { path: relative, isDirectory: source.endsWith("/") };
}

// Build-context sources of a COPY or ADD (every argument before the
// destination, in shell or JSON form) or of a RUN bind mount.
function contextSources(instruction, file) {
  const run = /^RUN\s+((?:--\S+\s+)*)/i.exec(instruction);
  if (run) return bindMountSources(run[1], file);
  const match = /^(COPY|ADD)\s+(.*)$/i.exec(instruction);
  if (!match) return [];
  let rest = match[2];
  const flags = [];
  for (let flag = /^--\S+\s*/.exec(rest); flag; flag = /^--\S+\s*/.exec(rest)) {
    flags.push(flag[0].trim());
    rest = rest.slice(flag[0].length);
  }
  // --from reads another stage or image, not the build context
  if (flags.some((flag) => /^--from=/i.test(flag))) return [];
  let args;
  if (rest.startsWith("[")) {
    try {
      args = JSON.parse(rest);
    } catch {
      throw new DeriveFiltersError(
        `unparseable JSON-form instruction: ${instruction}`,
        file,
      );
    }
  } else {
    args = rest.split(/\s+/);
  }
  const sources = [];
  for (const source of args.slice(0, -1)) {
    // heredoc bodies and remote ADD sources are not in the context
    if (
      source.startsWith("<<") ||
      /^([a-z][a-z0-9+.-]*:\/\/|git@)/i.test(source)
    )
      continue;
    const contextSource = contextPath(source, file);
    if (contextSource) sources.push(contextSource);
  }
  return sources;
}

// `RUN --mount=...` flags that bind the build context: type defaults to
// bind, and a mount without from= reads the context (source defaults to it).
function bindMountSources(flags, file) {
  const sources = [];
  for (const flag of flags.trim().split(/\s+/)) {
    const mount = /^--mount=(.*)$/i.exec(flag);
    if (!mount) continue;
    const fields = Object.fromEntries(
      mount[1].split(",").map((field) => {
        const [key, ...value] = field.split("=");
        return [key.toLowerCase(), value.join("=")];
      }),
    );
    if ((fields.type || "bind") !== "bind" || fields.from) continue;
    const contextSource = contextPath(fields.source ?? fields.src ?? ".", file);
    if (contextSource) sources.push(contextSource);
  }
  return sources;
}

function parseDockerfile(text, file) {
  const parsed = { targets: [], sources: [] };
  for (const instruction of instructions(text, file)) {
    parsed.targets.push(...pruneTargets(instruction));
    parsed.sources.push(...contextSources(instruction, file));
  }
  return parsed;
}

// One `pnpm ls --parseable` line as a repo-relative glob. Anything that is
// not an absolute directory inside the repo fails the run: a warning or a
// path outside the checkout must not turn into a filter that never matches.
function projectFilter(line, root, target) {
  const relative = path.relative(root, line);
  if (
    !path.isAbsolute(line) ||
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new DeriveFiltersError(
      `pnpm ls --filter=${target}... printed a line that is not a workspace project inside the repo: ${line}`,
    );
  }
  return `${relative.split(path.sep).join("/")}/**`;
}

function parseJson(raw, name) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new DeriveFiltersError(`${name} is not valid JSON: ${err.message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value, name) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item)
  ) {
    throw new DeriveFiltersError(
      `${name} must be an array of non-empty strings`,
    );
  }
  return value;
}

// Validates the action inputs (passed as env) at the boundary.
function parseInputs(env) {
  const images = parseJson(env.IMAGES_JSON || "", "images");
  if (!isPlainObject(images) || !Object.keys(images).length) {
    throw new DeriveFiltersError("images must be a non-empty JSON object");
  }
  for (const [key, spec] of Object.entries(images)) {
    if (
      !isPlainObject(spec) ||
      typeof spec.dockerfile_path !== "string" ||
      !spec.dockerfile_path
    ) {
      throw new DeriveFiltersError(`images.${key} needs a dockerfile_path`);
    }
  }

  const sharedPaths = parseList(env.SHARED_PATHS);
  const lockfile = (env.LOCKFILE || "").trim();
  if (lockfile && sharedPaths.includes(lockfile)) {
    throw new DeriveFiltersError(
      `${lockfile} is both the scoped lockfile and a shared path; remove it from shared-paths`,
    );
  }

  const rawAggregates = (env.AGGREGATE_FILTERS || "").trim();
  const aggregates = rawAggregates
    ? parseJson(rawAggregates, "aggregate-filters")
    : {};
  if (!isPlainObject(aggregates)) {
    throw new DeriveFiltersError("aggregate-filters must be a JSON object");
  }
  for (const [key, spec] of Object.entries(aggregates)) {
    if (!isPlainObject(spec)) {
      throw new DeriveFiltersError(
        `aggregate-filters.${key} must be an object`,
      );
    }
    const unknownFields = Object.keys(spec).filter(
      (field) => !AGGREGATE_FIELDS.includes(field),
    );
    if (unknownFields.length) {
      throw new DeriveFiltersError(
        `aggregate-filters.${key} has unknown field(s): ${unknownFields.join(", ")} (allowed: ${AGGREGATE_FIELDS.join(", ")})`,
      );
    }
    const exclude = stringArray(
      spec.exclude,
      `aggregate-filters.${key}.exclude`,
    );
    stringArray(spec.paths, `aggregate-filters.${key}.paths`);
    const unknownImages = exclude.filter(
      (image) => !Object.hasOwn(images, image),
    );
    if (unknownImages.length) {
      throw new DeriveFiltersError(
        `aggregate-filters.${key}.exclude names unknown image key(s): ${unknownImages.join(", ")}`,
      );
    }
  }

  const keys = [...Object.keys(images), ...Object.keys(aggregates)];
  if (sharedPaths.length) keys.push("shared");
  if (lockfile) keys.push(LOCKFILE_FILTER);
  for (const key of keys) {
    if (!FILTER_KEY.test(key)) {
      throw new DeriveFiltersError(
        `filter name "${key}" must match ${FILTER_KEY}`,
      );
    }
  }
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length) {
    throw new DeriveFiltersError(
      `filter name(s) used twice across images, aggregate-filters and shared: ${[...new Set(duplicates)].join(", ")}`,
    );
  }

  return { images, sharedPaths, aggregates, lockfile };
}

function renderFilters(sharedPaths, filters, lockfile) {
  const lines = [];
  if (sharedPaths.length) {
    lines.push("shared: &shared");
    for (const sharedPath of sharedPaths)
      lines.push(`  - ${JSON.stringify(sharedPath)}`);
  }
  for (const [key, paths] of filters) {
    lines.push(`${JSON.stringify(key)}:`);
    if (sharedPaths.length) lines.push("  - *shared");
    for (const filterPath of [...paths].sort()) {
      // root files a Dockerfile COPYs are usually shared paths already, and
      // a scoped lockfile reaches an image only through lockfile-scope.cjs
      const isLockfile =
        lockfile && (filterPath === lockfile || filterPath === `${lockfile}/**`);
      if (!sharedPaths.includes(filterPath) && !isLockfile)
        lines.push(`  - ${JSON.stringify(filterPath)}`);
    }
  }
  if (lockfile) {
    lines.push(`${JSON.stringify(LOCKFILE_FILTER)}:`);
    lines.push(`  - ${JSON.stringify(lockfile)}`);
  }
  return `${lines.join("\n")}\n`;
}

// The paths-filter YAML for validated inputs, and each filter's project dirs
// for lockfile-scope.cjs. `io` supplies the repo:
// root (absolute), readFile(relativePath), pathKind(relativePath) ->
// "directory" | "file" | null, and listProjects(target) -> `pnpm ls
// --parseable` lines.
function deriveFilters({ images, sharedPaths, aggregates, lockfile }, io) {
  const closures = new Map();
  const closureOf = (target, file) => {
    if (!PACKAGE_NAME.test(target)) {
      throw new DeriveFiltersError(
        `prune target "${target}" is not a package name`,
        file,
      );
    }
    if (!closures.has(target)) {
      try {
        closures.set(
          target,
          io
            .listProjects(target)
            .map((line) => projectFilter(line, io.root, target)),
        );
      } catch (err) {
        if (err instanceof DeriveFiltersError && !err.file) err.file = file;
        throw err;
      }
    }
    return closures.get(target);
  };

  const filters = new Map();
  const roots = {};
  for (const [key, { dockerfile_path: file }] of Object.entries(images)) {
    const { targets, sources } = parseDockerfile(io.readFile(file), file);
    if (!targets.length) {
      throw new DeriveFiltersError("no 'turbo prune <targets>' line", file);
    }
    // the Dockerfile may live outside every closure, and BuildKit reads a
    // `<Dockerfile>.dockerignore` beside it
    const dockerfile = path.posix.normalize(file).replace(/^(\.?\/)+/, "");
    const paths = new Set([dockerfile, `${dockerfile}.dockerignore`]);
    const projects = new Set();
    for (const target of targets) {
      for (const filterPath of closureOf(target, file)) {
        paths.add(filterPath);
        projects.add(filterPath.slice(0, -"/**".length));
      }
    }
    roots[key] = [...projects].sort();
    for (const source of sources) {
      const kind = source.isDirectory ? "directory" : io.pathKind(source.path);
      if (kind !== "file") paths.add(`${source.path}/**`);
      // a glob or a missing path keeps both forms: it may name directories
      if (kind !== "directory") paths.add(source.path);
    }
    filters.set(key, paths);
  }

  for (const [key, spec] of Object.entries(aggregates)) {
    const exclude = spec.exclude || [];
    const paths = new Set(spec.paths || []);
    const projects = new Set();
    for (const [image, imagePaths] of filters) {
      if (Object.hasOwn(images, image) && !exclude.includes(image)) {
        for (const filterPath of imagePaths) paths.add(filterPath);
        for (const project of roots[image]) projects.add(project);
      }
    }
    filters.set(key, paths);
    roots[key] = [...projects].sort();
  }

  return { filters: renderFilters(sharedPaths, filters, lockfile), roots };
}

// Workflow-command escaping, as @actions/core does it.
function escapeData(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function escapeProperty(value) {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

// --fail-if-no-match only fails when every --filter misses, so each target
// gets its own call: a renamed app must fail the run, not drop out silently.
function listProjects(target, root) {
  let stdout;
  try {
    stdout = execFileSync(
      "pnpm",
      [
        "ls",
        "--fail-if-no-match",
        "--parseable",
        "--depth",
        "-1",
        `--filter=${target}...`,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
  } catch (err) {
    throw new DeriveFiltersError(
      `pnpm ls --filter=${target}... failed (exit ${err.status ?? err.code}); is "${target}" a workspace package?`,
    );
  }
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) =>
      path.isAbsolute(line) && fs.existsSync(line)
        ? fs.realpathSync(line)
        : line,
    );
}

function main() {
  const root = fs.realpathSync(process.cwd());
  const inputs = parseInputs(process.env);
  const { filters, roots } = deriveFilters(inputs, {
    root,
    readFile: (file) => {
      try {
        return fs.readFileSync(path.join(root, file), "utf8");
      } catch (err) {
        throw new DeriveFiltersError(
          `cannot read Dockerfile: ${err.code}`,
          file,
        );
      }
    },
    pathKind: (relative) => {
      try {
        return fs.statSync(path.join(root, relative)).isDirectory()
          ? "directory"
          : "file";
      } catch {
        // a glob or a missing path: docker build reports the latter itself
        return null;
      }
    },
    listProjects: (target) => listProjects(target, root),
  });

  console.log("::group::Derived filters");
  console.log(filters);
  console.log("::endgroup::");
  const delimiter = `ghadelimiter_${randomUUID()}`;
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `filters<<${delimiter}\n${filters}${delimiter}\nroots=${JSON.stringify(roots)}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    if (!(err instanceof DeriveFiltersError)) throw err;
    const file = err.file ? `file=${escapeProperty(err.file)},` : "";
    console.log(
      `::error ${file}title=derive-filters::${escapeData(err.message)}`,
    );
    process.exitCode = 1;
  }
}

module.exports = {
  DeriveFiltersError,
  parseList,
  parseDockerfile,
  projectFilter,
  parseInputs,
  deriveFilters,
  escapeData,
  escapeProperty,
};
