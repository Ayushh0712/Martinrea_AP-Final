// Ensures the local infra containers are running before `npm run dev` starts the
// app services. Idempotent and non-destructive: it reuses any existing container
// (preserving the Keycloak realm/users volume, even when the container was
// created by another project folder on this machine) and only creates the ones
// that are genuinely missing, via the workflow compose file.
//
// Postgres is intentionally NOT managed here: this project's .env points at a
// native Postgres on localhost:5434, which is a Windows service, not a container.
import { execSync } from 'node:child_process';

const COMPOSE_FILE = 'backend/workflow/docker-compose.yml';

// container_name (from the compose file) -> compose service name
const CONTAINERS = {
  'martinrea-ap-redis': 'redis',
  'martinrea-keycloak': 'keycloak',
};

function sh(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

try {
  sh('docker info');
} catch {
  console.error(
    '\n[infra:up] Docker does not appear to be running. Start Docker Desktop and retry.\n',
  );
  process.exit(1);
}

let existing = new Set();
try {
  existing = new Set(
    sh('docker ps -a --format "{{.Names}}"')
      .split(/\r?\n/)
      .filter(Boolean),
  );
} catch {
  // fall through — treat as none existing
}

for (const [name, service] of Object.entries(CONTAINERS)) {
  try {
    if (existing.has(name)) {
      sh(`docker start ${name}`);
      console.log(`[infra:up] ${name} running`);
    } else {
      console.log(`[infra:up] ${name} missing -> creating via compose (${service})`);
      sh(`docker compose -f ${COMPOSE_FILE} up -d ${service}`);
      console.log(`[infra:up] ${name} created`);
    }
  } catch (err) {
    console.error(`[infra:up] failed to ensure ${name}: ${err.message}`);
    process.exit(1);
  }
}

console.log('[infra:up] infra ready — redis :6379, keycloak :8080');
console.log('[infra:up] reminder: Postgres must be running natively on localhost:5434');
