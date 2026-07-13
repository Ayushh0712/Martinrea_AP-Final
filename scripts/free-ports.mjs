// Preflight for `npm run dev`: frees the app-tier ports (3000-3002) from any
// leftover / orphaned dev instance so the fresh run never hits EADDRINUSE.
//
// On Windows, stopping the `concurrently` parent frequently orphans the child
// `node` processes, which keep the ports bound; the next `npm run dev` then
// collides. This script finds whoever is LISTENING on those ports and, if it is
// a node process, kills it.
//
// Only touches the three app ports — never the infra ports (5434 Postgres,
// 6379 Redis, 8080 Keycloak). Never aborts the run: any failure is logged as
// a warning and execution continues.
import { execSync } from 'node:child_process';

const PORTS = [3000, 3001, 3002];
const isWindows = process.platform === 'win32';

function sh(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function tryQuiet(cmd) {
  try {
    return sh(cmd);
  } catch {
    return '';
  }
}

/** Return the set of PIDs LISTENING on the given port. */
function listenerPids(port) {
  const pids = new Set();
  if (isWindows) {
    // netstat rows look like:  TCP  0.0.0.0:3001  0.0.0.0:0  LISTENING  1234
    const out = tryQuiet('netstat -ano -p tcp');
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] || '';
      const pid = cols[cols.length - 1];
      // Match :3001 as the local port (handles 0.0.0.0, 127.0.0.1, [::], etc.)
      if (local.endsWith(`:${port}`) && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    }
  } else {
    const out = tryQuiet(`lsof -ti tcp:${port} -sTCP:LISTEN`);
    for (const pid of out.split(/\r?\n/)) {
      if (/^\d+$/.test(pid.trim())) pids.add(pid.trim());
    }
  }
  return pids;
}

/** True if the given PID is a node process (so we don't kill unrelated apps). */
function isNodeProcess(pid) {
  if (isWindows) {
    const out = tryQuiet(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
    return /node\.exe/i.test(out);
  }
  const out = tryQuiet(`ps -p ${pid} -o comm=`);
  return /node/i.test(out);
}

function kill(pid) {
  if (isWindows) {
    sh(`taskkill /F /PID ${pid}`);
  } else {
    sh(`kill -9 ${pid}`);
  }
}

let freed = 0;
for (const port of PORTS) {
  for (const pid of listenerPids(port)) {
    if (pid === String(process.pid)) continue; // never kill ourselves
    if (!isNodeProcess(pid)) {
      console.warn(
        `[ports:free] port ${port} held by non-node PID ${pid}; leaving it alone`,
      );
      continue;
    }
    try {
      kill(pid);
      freed++;
      console.log(`[ports:free] freed port ${port} (killed node PID ${pid})`);
    } catch (err) {
      console.warn(
        `[ports:free] could not kill PID ${pid} on port ${port}: ${err.message}. ` +
          `If it is an elevated process, close it manually.`,
      );
    }
  }
}

console.log(
  freed === 0
    ? '[ports:free] app ports 3000-3002 already clear'
    : `[ports:free] cleared ${freed} stale listener(s) on 3000-3002`,
);
