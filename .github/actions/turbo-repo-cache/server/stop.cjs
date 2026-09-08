// Post hook: reap the background server started by start.cjs and surface its
// logs. A server that died mid-job is a warning, not a failure: turbo degrades
// to cache misses, and failing an otherwise green build over a cache is worse.
// Nothing in here may throw past main() for the same reason.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// A real turbo build makes thousands of cache requests at two log lines each,
// so only the tail is ever printed.
const LOG_TAIL_LINES = 200;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLogTail(logDir, name) {
  try {
    const lines = fs.readFileSync(path.join(logDir, name), "utf8").trim().split("\n");
    return lines.slice(-LOG_TAIL_LINES).join("\n").trim();
  } catch {
    return "";
  }
}

// Healthy runs emit the logs as ::debug:: lines (visible only with step debug
// logging enabled); the warning path prints them as a visible group.
function printLogs(logDir, visible) {
  for (const name of ["out.log", "err.log"]) {
    const tail = readLogTail(logDir, name);
    if (!tail) continue;
    const title = `Turborepo remote cache server ${name} (last ${LOG_TAIL_LINES} lines)`;
    if (visible) {
      console.log(`::group::${title}`);
      console.log(tail);
      console.log("::endgroup::");
    } else {
      console.log(`::debug::${title}`);
      for (const line of tail.split("\n")) console.log(`::debug::${line}`);
    }
  }
}

function stopServer(pid) {
  if (!isRunning(pid)) return false;
  console.log(`Stopping Turborepo remote cache server (pid ${pid})`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    // ESRCH: it exited between the liveness check and the signal.
    if (error.code !== "ESRCH") throw error;
  }
  return true;
}

function main() {
  const pid = Number.parseInt(process.env.STATE_pid ?? "", 10);
  const logDir = process.env.STATE_log_dir ?? "";

  // No state means start.cjs failed before spawning; it already reported why.
  if (Number.isNaN(pid)) return;

  const wasRunning = stopServer(pid);
  if (!wasRunning) {
    console.log(
      `::warning::Turborepo remote cache server (pid ${pid}) was no longer running at job end; turbo will have fallen back to cache misses. Check the server logs below.`,
    );
  }
  if (logDir) printLogs(logDir, !wasRunning);
}

try {
  main();
} catch (error) {
  console.log(`::warning::Failed to stop the Turborepo remote cache server cleanly: ${error.message}`);
}
