// Post hook: reap the background server started by start.cjs and surface its
// logs. A server that died mid-job is a warning, not a failure: turbo degrades
// to cache misses, and failing an otherwise green build over a cache is worse.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function printLog(logDir, name) {
  let content = "";
  try {
    content = fs.readFileSync(path.join(logDir, name), "utf8").trim();
  } catch {
    return;
  }
  if (!content) return;
  console.log(`::group::Turborepo remote cache server ${name}`);
  console.log(content);
  console.log("::endgroup::");
}

function main() {
  const pid = Number.parseInt(process.env.STATE_pid ?? "", 10);
  const logDir = process.env.STATE_log_dir ?? "";

  // No state means start.cjs failed before spawning; it already reported why.
  if (Number.isNaN(pid)) return;

  if (isRunning(pid)) {
    console.log(`Stopping Turborepo remote cache server (pid ${pid})`);
    process.kill(pid, "SIGTERM");
  } else {
    console.log(
      `::warning::Turborepo remote cache server (pid ${pid}) was no longer running at job end; turbo will have fallen back to cache misses. Check the server logs below.`,
    );
  }

  if (logDir) {
    printLog(logDir, "out.log");
    printLog(logDir, "err.log");
  }
}

main();
