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
const HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 250;

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
  const teamId = readInput("team-id");

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

  const runnerTemp = requireEnv("RUNNER_TEMP");
  return Object.freeze({
    storageProvider,
    storagePath,
    teamId,
    logDir: path.join(runnerTemp, "turbo-repo-cache"),
    githubEnvFile: requireEnv("GITHUB_ENV"),
    githubStateFile: requireEnv("GITHUB_STATE"),
  });
}

function installServer() {
  console.log("::group::Install turborepo-remote-cache");
  try {
    execFileSync(
      "npm",
      ["ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"],
      { cwd: __dirname, stdio: "inherit" },
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

function readLog(logDir, name) {
  try {
    return fs.readFileSync(path.join(logDir, name), "utf8");
  } catch {
    return "";
  }
}

async function waitUntilReady(child, port, logDir) {
  let exitCode = null;
  child.on("exit", (code) => {
    exitCode = code ?? -1;
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exitCode !== null) {
      throw new ServerStartError(
        `Turborepo remote cache server exited with code ${exitCode} during startup`,
        readLog(logDir, "err.log") || readLog(logDir, "out.log"),
      );
    }
    if (await isServerReady(port)) return;
    await sleep(READY_POLL_MS);
  }

  if (exitCode === null) process.kill(child.pid, "SIGTERM");
  throw new ServerStartError(
    `Turborepo remote cache server did not become ready on port ${port} within ${READY_TIMEOUT_MS} ms`,
    readLog(logDir, "err.log"),
  );
}

async function main() {
  const config = loadConfig();
  installServer();

  fs.mkdirSync(config.logDir, { recursive: true });
  const port = await findFreePort();
  const token = crypto.randomBytes(24).toString("hex");
  console.log(`::add-mask::${token}`);

  const outFd = fs.openSync(path.join(config.logDir, "out.log"), "w");
  const errFd = fs.openSync(path.join(config.logDir, "err.log"), "w");
  const cli = path.join(
    __dirname,
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
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
      TURBO_TOKEN: token,
      STORAGE_PROVIDER: config.storageProvider,
      STORAGE_PATH: config.storagePath,
    },
  });
  fs.closeSync(outFd);
  fs.closeSync(errFd);

  try {
    await waitUntilReady(child, port, config.logDir);
  } finally {
    child.unref();
  }

  fs.appendFileSync(
    config.githubStateFile,
    `pid=${child.pid}\nlog_dir=${config.logDir}\n`,
  );
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
