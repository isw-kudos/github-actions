// Starts a turborepo-remote-cache server in the background for the rest of the
// job and exports the TURBO_* variables `turbo` needs to reach it. Deliberately
// dependency-free so the action needs no build/bundle step: workflow commands
// are written to stdout and the runner files are appended to directly.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const STORAGE_PROVIDERS = new Set([
  "s3",
  "google-cloud-storage",
  "azure-blob-storage",
  "local",
]);
const STORAGE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEFAULT_TEAM_ID = "ci";
const HOST = "127.0.0.1";
const NPM_REGISTRY = "https://registry.npmjs.org/";
const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 250;

// The server reads ~40 env vars (NODE_ENV, READ_ONLY, SSL_*, AUTH_MODE, ...),
// so a consumer's job env must not leak into it wholesale: NODE_ENV=development
// alone makes it load the workspace .env. Only what it needs to reach the
// network and the storage backend is passed through.
const CHILD_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);
const CHILD_ENV_PREFIXES = [
  "GOOGLE_",
  "GCLOUD_",
  "CLOUDSDK_",
  "GCS_",
  "AWS_",
  "S3_",
  "ABS_",
  "AZURE_",
];

class InputValidationError extends Error {
  constructor(name, reason) {
    super(`Invalid input "${name}": ${reason}`);
    this.name = "InputValidationError";
  }
}

class ServerStartError extends Error {
  constructor(message, serverLog) {
    super(serverLog ? `${message}\nServer log:\n${serverLog}` : message);
    this.name = "ServerStartError";
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is not set`);
  return value;
}

// Actions exposes inputs as INPUT_<NAME> with the name upper-cased verbatim,
// hyphens included.
function readInput(name) {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

function loadConfig() {
  const storageProvider = readInput("storage-provider");
  const storagePath = readInput("storage-path");
  // An explicit empty string bypasses the action.yml default, so default here too.
  const teamId = readInput("team-id") || DEFAULT_TEAM_ID;

  if (!STORAGE_PROVIDERS.has(storageProvider)) {
    throw new InputValidationError(
      "storage-provider",
      `must be one of ${[...STORAGE_PROVIDERS].join(", ")}`,
    );
  }
  if (!STORAGE_PATH_PATTERN.test(storagePath)) {
    throw new InputValidationError("storage-path", "must match [A-Za-z0-9._/-]+");
  }
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new InputValidationError("team-id", "must match [A-Za-z0-9_-]+");
  }

  // Per-invocation directory: a second use of the action in the same job must
  // not `npm ci` over (i.e. delete) the tree the first server is running from.
  const workDir = path.join(
    requireEnv("RUNNER_TEMP"),
    "turbo-repo-cache",
    crypto.randomBytes(4).toString("hex"),
  );

  return Object.freeze({
    storageProvider,
    storagePath,
    teamId,
    workDir,
    githubEnvFile: requireEnv("GITHUB_ENV"),
    githubStateFile: requireEnv("GITHUB_STATE"),
  });
}

function installServer(workDir) {
  for (const file of ["package.json", "package-lock.json"]) {
    fs.copyFileSync(path.join(__dirname, file), path.join(workDir, file));
  }
  // Consumers often run actions/setup-node with registry-url, which points npm
  // (via NPM_CONFIG_USERCONFIG) at a private registry with their auth token.
  // Force the public registry and a blank user config so the pinned lockfile
  // resolves exactly as committed.
  const userConfig = path.join(workDir, ".npmrc");
  fs.writeFileSync(userConfig, "");
  const npmEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^npm_config_/i.test(name),
    ),
  );

  console.log("::group::Install turborepo-remote-cache");
  try {
    execFileSync(
      "npm",
      [
        "ci",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        `--registry=${NPM_REGISTRY}`,
        `--userconfig=${userConfig}`,
      ],
      { cwd: workDir, env: npmEnv, stdio: "inherit" },
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ServerStartError(
        "npm was not found on PATH. Set up Node.js (e.g. actions/setup-node) before this action.",
      );
    }
    throw new ServerStartError(`npm ci failed with exit code ${error.status}`);
  } finally {
    console.log("::endgroup::");
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function buildChildEnv(config, port, token) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    const allowed =
      CHILD_ENV_NAMES.has(name) ||
      CHILD_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
    if (allowed) env[name] = value;
  }
  return {
    ...env,
    NODE_ENV: "production",
    HOST,
    PORT: String(port),
    TURBO_TOKEN: token,
    STORAGE_PROVIDER: config.storageProvider,
    STORAGE_PATH: config.storagePath,
    // Otherwise the local provider silently rejoins storage-path under os.tmpdir().
    STORAGE_PATH_USE_TMP_FOLDER: "false",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// /v8/artifacts/status answers 200 without auth, so it doubles as a health check.
function isServerReady(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: HOST, port, path: "/v8/artifacts/status", timeout: 1000 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => request.destroy());
  });
}

function readLog(workDir, name) {
  try {
    return fs.readFileSync(path.join(workDir, name), "utf8");
  } catch {
    return "";
  }
}

// The server logs to stdout; err.log only carries node warnings.
function readServerLogs(workDir) {
  return readLog(workDir, "err.log") + readLog(workDir, "out.log");
}

async function waitUntilReady(child, port, workDir) {
  let exitCode = null;
  let spawnError = null;
  child.on("exit", (code) => {
    exitCode = code ?? -1;
  });
  child.on("error", (error) => {
    spawnError = error;
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      throw new ServerStartError(`Failed to spawn server: ${spawnError.message}`);
    }
    if (exitCode !== null) {
      throw new ServerStartError(
        `Turborepo remote cache server exited with code ${exitCode} during startup`,
        readServerLogs(workDir),
      );
    }
    if (await isServerReady(port)) return;
    await sleep(READY_POLL_MS);
  }

  if (exitCode === null) process.kill(child.pid, "SIGTERM");
  throw new ServerStartError(
    `Turborepo remote cache server did not become ready on port ${port} within ${READY_TIMEOUT_MS} ms`,
    readServerLogs(workDir),
  );
}

async function main() {
  const config = loadConfig();
  fs.mkdirSync(config.workDir, { recursive: true });
  installServer(config.workDir);

  const port = await findFreePort();
  const token = crypto.randomBytes(24).toString("hex");
  console.log(`::add-mask::${token}`);

  const outFd = fs.openSync(path.join(config.workDir, "out.log"), "w");
  const errFd = fs.openSync(path.join(config.workDir, "err.log"), "w");
  const cli = path.join(
    config.workDir,
    "node_modules",
    "turborepo-remote-cache",
    "dist",
    "cli.js",
  );

  // Runs on the runner's own node (process.execPath), so the consumer's node
  // version does not matter. Detached + unref so it outlives this step; stop.cjs
  // reaps it in the post hook.
  const child = spawn(process.execPath, [cli], {
    detached: true,
    stdio: ["ignore", outFd, errFd],
    env: buildChildEnv(config, port, token),
  });
  fs.closeSync(outFd);
  fs.closeSync(errFd);

  // Record the pid before waiting, so a cancellation mid-startup still lets the
  // post hook reap the server instead of orphaning it on a self-hosted runner.
  fs.appendFileSync(
    config.githubStateFile,
    `pid=${child.pid}\nlog_dir=${config.workDir}\n`,
  );

  try {
    await waitUntilReady(child, port, config.workDir);
  } finally {
    child.unref();
  }

  fs.appendFileSync(
    config.githubEnvFile,
    `TURBO_API=http://${HOST}:${port}\nTURBO_TOKEN=${token}\nTURBO_TEAM=${config.teamId}\n`,
  );

  console.log(
    `Turborepo remote cache server listening on http://${HOST}:${port} (pid ${child.pid}, storage ${config.storageProvider}:${config.storagePath}, team ${config.teamId})`,
  );
}

main().catch((error) => {
  // Workflow commands are single-line; newlines must be percent-encoded.
  console.log(`::error::${error.message.replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  process.exit(1);
});
