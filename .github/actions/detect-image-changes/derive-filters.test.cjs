// Unit tests for derive-filters.cjs — plain `node derive-filters.test.cjs`,
// zero dependencies, wired into pre-commit as a local hook. The repo is
// faked through deriveFilters' io argument, so no pnpm is needed.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DeriveFiltersError,
  parseList,
  parseDockerfile,
  projectFilter,
  parseInputs,
  deriveFilters,
  escapeData,
  escapeProperty,
} = require("./derive-filters.cjs");

const ROOT = "/repo";

// A fake repo: Dockerfile texts, directories, files, and each target's
// closure as repo-relative project dirs (made absolute the way pnpm prints
// them).
function fakeIo({ dockerfiles, directories = [], files = [], closures }) {
  const calls = [];
  return {
    calls,
    root: ROOT,
    readFile: (file) => {
      if (!(file in dockerfiles))
        throw new DeriveFiltersError("cannot read Dockerfile: ENOENT", file);
      return dockerfiles[file];
    },
    pathKind: (relative) =>
      directories.includes(relative)
        ? "directory"
        : files.includes(relative)
          ? "file"
          : null,
    listProjects: (target) => {
      calls.push(target);
      if (!(target in closures))
        throw new DeriveFiltersError(
          `pnpm ls --filter=${target}... failed (exit 1)`,
        );
      return closures[target].map((dir) => `${ROOT}/${dir}`);
    },
  };
}

const sources = (text) => parseDockerfile(text, "Dockerfile").sources;
const targets = (text) => parseDockerfile(text, "Dockerfile").targets;

test("parseList trims and drops blanks and comments", () => {
  assert.deepEqual(parseList("  a \n\n# why\n b\n"), ["a", "b"]);
  assert.deepEqual(parseList(undefined), []);
});

test("prune targets: versioned and unversioned turbo, several targets", () => {
  assert.deepEqual(
    targets("RUN npx turbo@2.11.9 prune search search-web --docker"),
    ["search", "search-web"],
  );
  assert.deepEqual(targets("RUN npx turbo prune licence --docker"), [
    "licence",
  ]);
  assert.deepEqual(
    targets("RUN ./node_modules/.bin/turbo prune web --docker"),
    ["web"],
  );
});

test("prune targets: flags dropped, args end at a shell operator", () => {
  assert.deepEqual(
    targets("RUN turbo prune --docker web --out-dir=out && echo done"),
    ["web"],
  );
  assert.deepEqual(targets("RUN turbo prune @scope/api --docker; ls"), [
    "@scope/api",
  ]);
});

test("prune targets: backslash continuations and comments inside them", () => {
  const text = [
    "RUN npx turbo@2 prune \\",
    "  # the app",
    "",
    "  app \\",
    "  --docker",
  ].join("\n");
  assert.deepEqual(targets(text), ["app"]);
});

test("prune targets: turbo v1 --scope, and a separate --out-dir value", () => {
  assert.deepEqual(targets("RUN turbo prune --scope=api --docker"), ["api"]);
  assert.deepEqual(targets("RUN turbo prune --scope api --docker"), ["api"]);
  assert.deepEqual(targets("RUN turbo prune web --out-dir out --docker"), [
    "web",
  ]);
});

test("prune targets: a prune without --docker still counts; outside RUN it does not", () => {
  assert.deepEqual(targets("RUN turbo prune web"), ["web"]);
  assert.deepEqual(targets("# RUN turbo prune web --docker"), []);
  assert.deepEqual(targets('LABEL note="turbo prune web --docker"'), []);
});

test("COPY sources: optional ./ or /, every source before the destination", () => {
  assert.deepEqual(
    sources("COPY apps/attachments/prisma ./apps/attachments/prisma"),
    [{ path: "apps/attachments/prisma", isDirectory: false }],
  );
  assert.deepEqual(
    sources(
      "COPY --chown=nodejs:nodejs ./packages/server/push-schema.cjs /app/push-schema.cjs",
    ),
    [{ path: "packages/server/push-schema.cjs", isDirectory: false }],
  );
  assert.deepEqual(
    sources("COPY /apps/webfront/public/locale /usr/src/app/locale"),
    [{ path: "apps/webfront/public/locale", isDirectory: false }],
  );
  assert.deepEqual(
    sources("COPY apps/a/tessdata.sha256 apps/a/tessdata.commit /tmp/"),
    [
      { path: "apps/a/tessdata.sha256", isDirectory: false },
      { path: "apps/a/tessdata.commit", isDirectory: false },
    ],
  );
});

test("COPY sources: trailing slash marks a directory", () => {
  assert.deepEqual(sources("COPY ./apps/web/config/ /etc/web/"), [
    { path: "apps/web/config", isDirectory: true },
  ]);
});

test("COPY sources: --from and the whole context are skipped", () => {
  assert.deepEqual(sources("COPY --from=setup /app/out/json/ ."), []);
  assert.deepEqual(
    sources("COPY --from=builder --chown=1000 /app/build /app/build"),
    [],
  );
  assert.deepEqual(sources("COPY . ."), []);
  assert.deepEqual(sources("COPY ./ ./"), []);
});

test("COPY sources: root files are kept", () => {
  assert.deepEqual(
    sources("COPY package.json pnpm-lock.yaml ./").map((s) => s.path),
    ["package.json", "pnpm-lock.yaml"],
  );
});

test("COPY sources: JSON form, lowercase instruction", () => {
  assert.deepEqual(
    sources('copy ["apps/a/my file.txt", "./apps/b/", "/dest/"]').map(
      (s) => s.path,
    ),
    ["apps/a/my file.txt", "apps/b"],
  );
});

test("COPY sources: unparseable JSON form fails with the file", () => {
  assert.throws(
    () => parseDockerfile('COPY ["apps/a", ', "apps/x/Dockerfile"),
    (err) =>
      err instanceof DeriveFiltersError && err.file === "apps/x/Dockerfile",
  );
});

test("ADD sources: handled like COPY; remote and heredoc sources skipped", () => {
  assert.deepEqual(
    sources("ADD --checksum=sha256:abc ./apps/a/data.tar /data/").map(
      (s) => s.path,
    ),
    ["apps/a/data.tar"],
  );
  assert.deepEqual(
    sources("ADD https://example.com/x.tar.gz git@github.com:o/r.git /x/"),
    [],
  );
  assert.deepEqual(sources("COPY <<EOF /etc/conf"), []);
});

test("projectFilter: an absolute project dir becomes a repo-relative glob", () => {
  assert.equal(
    projectFilter("/repo/packages/s3", ROOT, "user"),
    "packages/s3/**",
  );
});

test("projectFilter: a non-path line, the root, or a dir outside the repo fails", () => {
  for (const line of [
    "WARN something odd",
    "/repo",
    "/elsewhere/pkg",
    "packages/s3",
  ]) {
    assert.throws(
      () => projectFilter(line, ROOT, "user"),
      DeriveFiltersError,
      line,
    );
  }
});

const IMAGES_JSON = JSON.stringify({
  api: { dockerfile_path: "apps/api/Dockerfile", image: "api" },
  web: {
    dockerfile_path: "apps/web/Dockerfile",
    image: "web",
    build_args: "X=1",
  },
});

test("parseInputs: aggregates and shared paths are validated", () => {
  const inputs = parseInputs({
    IMAGES_JSON,
    SHARED_PATHS: "pnpm-lock.yaml\n# gitlink\nhuddo-services\n",
    AGGREGATE_FILTERS:
      '{"smoke": {"exclude": ["web"], "paths": ["docker-compose.smoke.yaml"]}}',
  });
  assert.deepEqual(inputs.sharedPaths, ["pnpm-lock.yaml", "huddo-services"]);
  assert.deepEqual(inputs.aggregates.smoke.exclude, ["web"]);
});

test("parseInputs: rejects bad input loudly", () => {
  const cases = [
    { IMAGES_JSON: "" },
    { IMAGES_JSON: "{}" },
    { IMAGES_JSON: '{"api": {"image": "api"}}' },
    { IMAGES_JSON: '{"a b": {"dockerfile_path": "Dockerfile"}}' },
    { IMAGES_JSON, AGGREGATE_FILTERS: "[]" },
    { IMAGES_JSON, AGGREGATE_FILTERS: '{"smoke": {"exclude": ["nope"]}}' },
    { IMAGES_JSON, AGGREGATE_FILTERS: '{"smoke": {"include": ["api"]}}' },
    { IMAGES_JSON, AGGREGATE_FILTERS: '{"smoke": {"paths": "compose.yaml"}}' },
    { IMAGES_JSON, AGGREGATE_FILTERS: '{"api": {}}' },
    {
      IMAGES_JSON: '{"shared": {"dockerfile_path": "Dockerfile"}}',
      SHARED_PATHS: "pnpm-lock.yaml",
    },
  ];
  for (const env of cases) {
    assert.throws(
      () => parseInputs(env),
      DeriveFiltersError,
      JSON.stringify(env),
    );
  }
});

test("parseInputs: an image may be called shared when there are no shared paths", () => {
  assert.doesNotThrow(() =>
    parseInputs({
      IMAGES_JSON: '{"shared": {"dockerfile_path": "Dockerfile"}}',
    }),
  );
});

const REPO = {
  dockerfiles: {
    "apps/api/Dockerfile": [
      "FROM node AS setup",
      "COPY . .",
      "RUN npx turbo@2.11.9 prune api --docker",
      "FROM node AS installer",
      "COPY --from=setup /app/out/json/ .",
      "COPY apps/api/prisma ./apps/api/prisma",
      "COPY ./packages/db/push-schema.cjs /app/push-schema.cjs",
    ].join("\n"),
    "apps/web/Dockerfile":
      "COPY . .\nRUN npx turbo prune web web-assets --docker\n",
  },
  directories: ["apps/api/prisma"],
  files: ["packages/db/push-schema.cjs"],
  closures: {
    api: ["apps/api", "packages/db", "packages/utils"],
    web: ["apps/web", "packages/utils"],
    "web-assets": ["apps/web/assets", "packages/utils"],
  },
};

test("deriveFilters: closures, context sources, shared anchor, aggregate", () => {
  const io = fakeIo(REPO);
  const { filters: yaml } = deriveFilters(
    parseInputs({
      IMAGES_JSON,
      SHARED_PATHS: "pnpm-lock.yaml\nhuddo-services",
      AGGREGATE_FILTERS:
        '{"smoke": {"exclude": ["web"], "paths": ["docker-compose.smoke.yaml"]}}',
    }),
    io,
  );
  assert.equal(
    yaml,
    [
      "shared: &shared",
      '  - "pnpm-lock.yaml"',
      '  - "huddo-services"',
      '"api":',
      "  - *shared",
      '  - "apps/api/**"',
      '  - "apps/api/Dockerfile"',
      '  - "apps/api/Dockerfile.dockerignore"',
      '  - "apps/api/prisma/**"',
      '  - "packages/db/**"',
      '  - "packages/db/push-schema.cjs"',
      '  - "packages/utils/**"',
      '"web":',
      "  - *shared",
      '  - "apps/web/**"',
      '  - "apps/web/Dockerfile"',
      '  - "apps/web/Dockerfile.dockerignore"',
      '  - "apps/web/assets/**"',
      '  - "packages/utils/**"',
      '"smoke":',
      "  - *shared",
      '  - "apps/api/**"',
      '  - "apps/api/Dockerfile"',
      '  - "apps/api/Dockerfile.dockerignore"',
      '  - "apps/api/prisma/**"',
      '  - "docker-compose.smoke.yaml"',
      '  - "packages/db/**"',
      '  - "packages/db/push-schema.cjs"',
      '  - "packages/utils/**"',
      "",
    ].join("\n"),
  );
});

test("deriveFilters: no shared paths means no anchor", () => {
  const { filters: yaml } = deriveFilters(parseInputs({ IMAGES_JSON }), fakeIo(REPO));
  assert.ok(!yaml.includes("shared"));
  assert.ok(yaml.startsWith('"api":\n  - "apps/api/**"\n'));
});

test("deriveFilters: each target is listed once across images", () => {
  const images = JSON.stringify({
    one: { dockerfile_path: "one/Dockerfile" },
    two: { dockerfile_path: "two/Dockerfile" },
  });
  const io = fakeIo({
    dockerfiles: {
      "one/Dockerfile": "RUN turbo prune api --docker",
      "two/Dockerfile": "RUN turbo prune api --docker",
    },
    closures: { api: ["apps/api"] },
  });
  deriveFilters(parseInputs({ IMAGES_JSON: images }), io);
  assert.deepEqual(io.calls, ["api"]);
});

test("deriveFilters: a Dockerfile with no prune line fails with its path", () => {
  const io = fakeIo({
    ...REPO,
    dockerfiles: { ...REPO.dockerfiles, "apps/web/Dockerfile": "COPY . .\n" },
  });
  assert.throws(
    () => deriveFilters(parseInputs({ IMAGES_JSON }), io),
    (err) =>
      err instanceof DeriveFiltersError &&
      err.file === "apps/web/Dockerfile" &&
      /turbo prune/.test(err.message),
  );
});

test("deriveFilters: a target pnpm cannot find fails with the Dockerfile path", () => {
  const io = fakeIo({
    ...REPO,
    closures: { api: REPO.closures.api, web: REPO.closures.web },
  });
  assert.throws(
    () => deriveFilters(parseInputs({ IMAGES_JSON }), io),
    (err) =>
      err instanceof DeriveFiltersError &&
      err.file === "apps/web/Dockerfile" &&
      /web-assets/.test(err.message),
  );
});

test("deriveFilters: a prune target that is not a package name fails", () => {
  const io = fakeIo({
    ...REPO,
    dockerfiles: {
      ...REPO.dockerfiles,
      "apps/web/Dockerfile": "RUN turbo prune $APP --docker",
    },
  });
  assert.throws(
    () => deriveFilters(parseInputs({ IMAGES_JSON }), io),
    /not a package name/,
  );
});

test("deriveFilters: a non-path line from pnpm fails", () => {
  const io = fakeIo(REPO);
  const listProjects = io.listProjects;
  io.listProjects = (target) => [
    ...listProjects(target),
    "Progress: resolved 1",
  ];
  assert.throws(
    () => deriveFilters(parseInputs({ IMAGES_JSON }), io),
    /not a workspace project/,
  );
});

test("escapeData / escapeProperty follow the workflow-command rules", () => {
  assert.equal(escapeData("50%\r\nnext"), "50%25%0D%0Anext");
  assert.equal(escapeProperty("a:b,c"), "a%3Ab%2Cc");
});

test("deriveFilters: a COPY of a shared path is not repeated under the image", () => {
  const io = fakeIo({
    dockerfiles: { "Dockerfile": "COPY package.json pnpm-lock.yaml ./\nRUN turbo prune api --docker" },
    files: ["package.json", "pnpm-lock.yaml"],
    closures: { api: ["apps/api"] },
  });
  const { filters: yaml } = deriveFilters(
    parseInputs({ IMAGES_JSON: '{"api": {"dockerfile_path": "Dockerfile"}}', SHARED_PATHS: "pnpm-lock.yaml" }),
    io,
  );
  assert.equal(yaml, 'shared: &shared\n  - "pnpm-lock.yaml"\n"api":\n  - *shared\n  - "Dockerfile"\n  - "Dockerfile.dockerignore"\n  - "apps/api/**"\n  - "package.json"\n');
});

test("COPY sources: shell-form quotes are removed", () => {
  assert.deepEqual(sources('COPY "apps/other/prisma" \'./apps/x/\' /p/'), [
    { path: "apps/other/prisma", isDirectory: false },
    { path: "apps/x", isDirectory: true },
  ]);
});

test("COPY sources: a variable or unresolvable quoting fails with the file", () => {
  for (const text of [
    "COPY ${APP_DIR}/prisma ./prisma",
    "COPY $APP/prisma ./prisma",
    'COPY "apps/my file" /p/',
    'COPY ["$APP/prisma", "/p/"]',
  ]) {
    assert.throws(
      () => parseDockerfile(text, "apps/x/Dockerfile"),
      (err) =>
        err instanceof DeriveFiltersError && err.file === "apps/x/Dockerfile",
      text,
    );
  }
});

test("escape directive: a non-backslash escape fails; a later comment does not", () => {
  assert.throws(
    () => parseDockerfile("# escape=`\nRUN turbo prune web --docker", "D"),
    /escape directive/,
  );
  assert.deepEqual(
    targets("# syntax=docker/dockerfile:1\n# escape=\\\nRUN turbo prune web --docker"),
    ["web"],
  );
  assert.deepEqual(
    targets("FROM node\n# escape=`\nRUN turbo prune web --docker"),
    ["web"],
  );
});

test("RUN bind mounts of the build context are sources", () => {
  assert.deepEqual(
    sources(
      "RUN --mount=type=bind,source=apps/other/config,target=/cfg --mount=type=cache,target=/root/.npm cp -r /cfg /app",
    ),
    [{ path: "apps/other/config", isDirectory: false }],
  );
  assert.deepEqual(
    sources("RUN --mount=src=./package.json,target=package.json npm ci").map(
      (s) => s.path,
    ),
    ["package.json"],
  );
  assert.deepEqual(
    sources("RUN --mount=type=bind,from=builder,source=/app,target=/x ls"),
    [],
  );
  // the whole context, like COPY . .
  assert.deepEqual(sources("RUN --mount=type=bind,target=/ctx ls"), []);
  assert.deepEqual(sources("RUN npm ci"), []);
});

test("deriveFilters: a Dockerfile outside every closure is in its filter", () => {
  const io = fakeIo({
    dockerfiles: { "./docker/web.Dockerfile": "RUN turbo prune web --docker" },
    closures: { web: ["apps/web"] },
  });
  const { filters: yaml } = deriveFilters(
    parseInputs({
      IMAGES_JSON: '{"web": {"dockerfile_path": "./docker/web.Dockerfile"}}',
    }),
    io,
  );
  assert.equal(
    yaml,
    '"web":\n  - "apps/web/**"\n  - "docker/web.Dockerfile"\n  - "docker/web.Dockerfile.dockerignore"\n',
  );
});

test("deriveFilters: a glob or missing source keeps both the path and path/**", () => {
  const io = fakeIo({
    dockerfiles: {
      Dockerfile:
        "RUN turbo prune api --docker\nCOPY apps/*/prisma apps/gone ./p/",
    },
    closures: { api: ["apps/api"] },
  });
  const { filters: yaml } = deriveFilters(
    parseInputs({ IMAGES_JSON: '{"api": {"dockerfile_path": "Dockerfile"}}' }),
    io,
  );
  for (const filterPath of [
    "apps/*/prisma",
    "apps/*/prisma/**",
    "apps/gone",
    "apps/gone/**",
  ]) {
    assert.ok(yaml.includes(`  - "${filterPath}"\n`), filterPath);
  }
});

test("deriveFilters: numeric-looking filter names are quoted keys", () => {
  const io = fakeIo({
    dockerfiles: { Dockerfile: "RUN turbo prune api --docker" },
    closures: { api: ["apps/api"] },
  });
  const { filters: yaml } = deriveFilters(
    parseInputs({ IMAGES_JSON: '{"1.0": {"dockerfile_path": "Dockerfile"}}' }),
    io,
  );
  assert.ok(yaml.startsWith('"1.0":\n'));
});

test("deriveFilters: a scoped lockfile gets its own filter, and roots per filter", () => {
  const { filters, roots } = deriveFilters(
    parseInputs({
      IMAGES_JSON,
      LOCKFILE: "pnpm-lock.yaml",
      AGGREGATE_FILTERS: '{"smoke": {"exclude": ["web"]}}',
    }),
    fakeIo(REPO),
  );
  assert.ok(filters.endsWith('"lockfile":\n  - "pnpm-lock.yaml"\n'));
  assert.equal(filters.match(/pnpm-lock\.yaml/g).length, 1);
  assert.deepEqual(roots, {
    api: ["apps/api", "packages/db", "packages/utils"],
    web: ["apps/web", "apps/web/assets", "packages/utils"],
    smoke: ["apps/api", "packages/db", "packages/utils"],
  });
});

test("parseInputs: a scoped lockfile cannot also be shared, or clash with a key", () => {
  assert.throws(
    () =>
      parseInputs({
        IMAGES_JSON,
        LOCKFILE: "pnpm-lock.yaml",
        SHARED_PATHS: "pnpm-lock.yaml",
      }),
    /both the scoped lockfile and a shared path/,
  );
  assert.throws(
    () =>
      parseInputs({
        IMAGES_JSON: '{"lockfile": {"dockerfile_path": "Dockerfile"}}',
        LOCKFILE: "pnpm-lock.yaml",
      }),
    /used twice/,
  );
});

test("deriveFilters: a scoped lockfile a Dockerfile COPYs stays out of its filter", () => {
  const io = fakeIo({
    dockerfiles: {
      "apps/api/Dockerfile":
        "COPY package.json pnpm-lock.yaml ./\nRUN npx turbo prune api --docker\n",
    },
    files: ["package.json", "pnpm-lock.yaml"],
    closures: { api: ["apps/api"] },
  });
  const images = JSON.stringify({
    api: { dockerfile_path: "apps/api/Dockerfile" },
  });
  const { filters } = deriveFilters(
    parseInputs({ IMAGES_JSON: images, LOCKFILE: "pnpm-lock.yaml" }),
    io,
  );
  assert.equal(
    filters,
    [
      '"api":',
      '  - "apps/api/**"',
      '  - "apps/api/Dockerfile"',
      '  - "apps/api/Dockerfile.dockerignore"',
      '  - "package.json"',
      '"lockfile":',
      '  - "pnpm-lock.yaml"',
      "",
    ].join("\n"),
  );
});
