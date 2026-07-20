# Martinrea AP — VM Deployment Runbook

Deploys the full stack to the **netlink-dev** VM behind a single public port.

- **VM**: `netlink-dev` @ `80.225.204.210` (2 CPU / 8 GB / 100 GB, OCI)
- **Public ports**: `22` (SSH) and `80` (HTTP via Caddy) only
- **In-stack services** (frontend, workflow, ingestion, Redis) run on the internal Docker network and are not reachable from the internet.
- **Reused host services** (NOT started by this compose): the existing Postgres **appdb** (`:8082`) and the existing **Keycloak** (`:8081`). The containers reach them via `host.docker.internal` (`extra_hosts: host-gateway`).

```
Browser -> http://80.225.204.210 (Caddy :80)
    /api/ingestion/*  -> ingestion  :3002
    /api/*            -> workflow    :3001
    everything else   -> frontend    :3000
workflow  -> redis (internal)
workflow  -> appdb Postgres   (host.docker.internal:8082)
workflow  -> Keycloak         (host.docker.internal:8081)
ingestion -> Keycloak         (host.docker.internal:8081)
```

All deployment files live under `deploy/prod/`:

| File | Purpose |
| --- | --- |
| `docker-compose.prod.yml` | The in-stack services (caddy, frontend, workflow, ingestion, redis); reuses host appdb + Keycloak |
| `Caddyfile` | Reverse-proxy routing (the only published port) |
| `workflow.env` | workflow-service env (host.docker.internal DB/Keycloak, VM IP, secrets) |
| `ingestion.env` | ingestion env (host.docker.internal Keycloak, VM IP, secrets) |

> Security note: `workflow.env` and `ingestion.env` contain live secrets (SMTP,
> IMAP, Keycloak client secret, OCI PAR, DB password). Treat this repo as
> sensitive, or move these into a secrets manager before any wider sharing.

---

## 1. One-time: key-based SSH

From the Windows dev machine (PowerShell):

```powershell
# Generate a key if you don't already have one
ssh-keygen -t ed25519 -C "netlink-dev-deploy"

# Install it on the VM (enter the VM password once when prompted)
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh netlink-dev@80.225.204.210 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"

# Verify: this should NOT prompt for a password
ssh netlink-dev@80.225.204.210 "echo connected"
```

After keys work, consider disabling password auth on the VM (the shared
password was partially exposed in a screenshot):

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

---

## 2. Open port 80 (two places on OCI)

OCI VMs firewall inbound traffic in **two** independent layers — both must allow 80/tcp.

**a) OCI console (you must do this — needs console access):**
VCN -> Subnet -> Security List (or the VM's NSG) -> add an Ingress rule:
Source `0.0.0.0/0`, IP Protocol `TCP`, Destination port `80`.

**b) OS firewall on the VM** (run whichever matches the distro):

```bash
# Ubuntu / Debian (ufw)
sudo ufw allow 80/tcp && sudo ufw reload

# Oracle Linux / RHEL (firewalld) — Oracle images often need iptables too
sudo firewall-cmd --permanent --add-port=80/tcp && sudo firewall-cmd --reload
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo service iptables save 2>/dev/null || true
```

Port 22 is already open (that's how you SSH in). Do **not** open `8081` (Keycloak),
`8082` (appdb) or `6379` (Redis) to the internet — the containers reach appdb and
Keycloak over the internal `host.docker.internal` bridge, not the public IP.

---

## 3. Install Docker on the VM

```bash
# Detect the distro
cat /etc/os-release

# Ubuntu/Debian
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # log out/in after this

# Oracle Linux
sudo dnf install -y dnf-utils
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER      # log out/in after this

# Verify
docker --version && docker compose version
```

---

## 4. Transfer the code

From the Windows dev machine, from the project root:

```powershell
# Create a tarball excluding heavy/derived/dev-only dirs
tar --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git `
    --exclude=terminals -czf mre-ap.tar.gz .

# Copy it up
scp mre-ap.tar.gz netlink-dev@80.225.204.210:~/

# Extract on the VM
ssh netlink-dev@80.225.204.210 "mkdir -p ~/mre-ap && tar -xzf ~/mre-ap.tar.gz -C ~/mre-ap"
```

(If the VM has outbound internet and a git remote exists, `git clone` is cleaner.)

The `PO-PDFs/` and `PO-Data/` folders must exist on the VM (they are bind-mounted).
The tarball includes them; if empty they'll still be created on extract.

---

## 5. Prerequisite: make host appdb + Keycloak reachable from Docker

This stack does NOT run its own Postgres/Keycloak — it reuses the ones already
on the VM. The containers reach the host via `host.docker.internal` (mapped to
`host-gateway` in the compose file), so both host services must listen on all
interfaces and permit the Docker bridge subnet.

1. **Old pm2 stack** — stop the app processes so they don't double-process appdb
   / the OCI bucket and don't fight over ports:
   ```bash
   pm2 stop mreap-frontend mreap-workflow mreap-ingestion
   ```

2. **appdb (Postgres :8082)** — must listen on `0.0.0.0` and allow the Docker
   subnet in `pg_hba.conf`:
   ```
   # postgresql.conf
   listen_addresses = '*'
   # pg_hba.conf (append)
   host  all  all  172.16.0.0/12  md5
   ```
   Reload (`SELECT pg_reload_conf();` or restart), then verify from a throwaway
   container:
   ```bash
   docker run --rm --add-host host.docker.internal:host-gateway postgres:16-alpine \
     pg_isready -h host.docker.internal -p 8082
   # -> host.docker.internal:8082 - accepting connections
   ```
   Confirm `DB_PASSWORD` in `workflow.env` matches appdb's `martinrea` user.

3. **Keycloak (:8081)** — must listen on `0.0.0.0:8081`. Verify from a container:
   ```bash
   docker run --rm --add-host host.docker.internal:host-gateway curlimages/curl \
     -s -o /dev/null -w "%{http_code}\n" \
     http://host.docker.internal:8081/realms/martinrea/protocol/openid-connect/certs
   # -> 200
   ```
   The realm must have: the `martinrea-ap` client (Direct Access Grants ON,
   confidential — its secret must match `KEYCLOAK_CLIENT_SECRET` in
   `workflow.env`), the **`audience-martinrea-ap` mapper** (ingestion enforces
   `aud`, so uploads 401 without it), the 4 realm roles, and the users. If the
   existing realm lacks any of these, import
   `backend/workflow/keycloak/import/martinrea-realm.json`.

4. **Confirm the token `iss`** — decode an access token and make
   `KEYCLOAK_ISSUER` (workflow.env) / `KEYCLOAK_ISSUER_URL` (ingestion.env) equal
   its `iss` claim exactly:
   ```bash
   curl -s -X POST http://localhost:8081/realms/martinrea/protocol/openid-connect/token \
     -d grant_type=password -d client_id=martinrea-ap -d client_secret=<SECRET> \
     -d username=clerk@martinrea.dev -d password=Password123! -d scope=openid \
     | sed -E 's/.*"access_token":"([^"]+)".*/\1/' | cut -d. -f2 | base64 -d 2>/dev/null
   # -> look for "iss":"http://80.225.204.210:8081/realms/martinrea"
   ```

---

## 6. Build and start

```bash
cd ~/mre-ap
docker compose -f deploy/prod/docker-compose.prod.yml up -d --build
```

First build takes ~10 min on 2 cores (the workflow image compiles OCR native
deps). Watch progress / boot logs:

```bash
docker compose -f deploy/prod/docker-compose.prod.yml logs -f workflow ingestion
```

Wait for `Martinrea AP backend listening ...` (workflow) and
`Ingestion service listening ...` (ingestion).

---

## 7. Seed the database (only if appdb is missing rows)

appdb is reused, so it normally already holds users, rules and data — skip this.
Sequelize `synchronize` (NODE_ENV=development) adds any missing tables on first
workflow boot. If a Keycloak user has no matching local mirror row (login fails
with "no local user mirror"), seed:

```bash
# Minimum: users + approval rules (enough to log in and run the workflow)
docker compose -f deploy/prod/docker-compose.prod.yml exec workflow npm run seed
docker compose -f deploy/prod/docker-compose.prod.yml exec workflow npm run seed:rules

# Optional: full demo dataset (suppliers, POs, invoices, match records, ...)
docker compose -f deploy/prod/docker-compose.prod.yml exec workflow npm run seed:all
```

---

## 8. Smoke test (over port 80)

```bash
# 1. Login (Keycloak Direct Access Grant via the workflow service)
curl -s -X POST http://80.225.204.210/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"clerk@martinrea.dev","password":"Password123!"}'
# -> expect {"accessToken":"eyJ..."}

# 2. Invoice list through the proxy (paste the token from step 1)
curl -s http://80.225.204.210/api/invoices -H "Authorization: Bearer <TOKEN>"
# -> expect {"success":true,"data":[...]}

# 3. Frontend page
curl -s -o /dev/null -w "%{http_code}\n" http://80.225.204.210/
# -> expect 200

# 4. Invoice upload through the ingestion proxy (the path that was failing)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://80.225.204.210/api/ingestion/upload \
  -H "Authorization: Bearer <TOKEN>" -F "file=@/path/to/invoice.pdf"
# -> expect 201 (a 401 means the aud/iss/role check failed; a connection error
#    means Caddy or ingestion isn't up)

# 5. Ingestion poller ticking
docker compose -f deploy/prod/docker-compose.prod.yml logs --tail=20 ingestion
# -> expect "[dummymreai@gmail.com] N unread message(s)" every 30s

# 6. PO drop folder: copy a PDF into ~/mre-ap/PO-PDFs on the VM, then
docker compose -f deploy/prod/docker-compose.prod.yml logs --tail=20 workflow
# -> expect the PO PDF sync to upload it to OCI
```

Then open `http://80.225.204.210` in a browser and log in as one of the demo
users (password `Password123!`): `clerk@`, `pm@`, `fd@martinrea.dev`.

---

## Operations

- **Restart a service**: `docker compose -f deploy/prod/docker-compose.prod.yml restart workflow`
- **Full restart**: `... down` then `... up -d` (keeps volumes/data). Add `-v` only to wipe data.
- **Update code**: re-transfer, then `... up -d --build`.
- **Keycloak** is the existing host instance on `:8081` (managed outside this
  stack); use its own admin console. This compose no longer runs Keycloak.
- **OCI PAR refresh**: PARs expire. If OCR/ingest stops fetching, generate a new
  PAR in the OCI console and update `OCI_PAR_URL` (workflow.env) +
  `BLOB_PAR_BASE_URL` (ingestion.env), then `... up -d` to recreate the services.

## Notes / gotchas

- **NODE_ENV=development is intentional** on the workflow service so Sequelize
  creates the schema. If this graduates to real production, add a migration tool
  (Flyway) to own the schema and flip to `production`.
- **Gmail** may challenge the first IMAP/SMTP login from the new VM IP. If email
  ingestion or notifications fail, approve the sign-in / regenerate the app
  password for `dummymreai@gmail.com` (IMAP) and `mramankhann@gmail.com` (SMTP).
- **appdb + Keycloak are reused from the host**, not started by this compose.
  The containers reach them at `host.docker.internal:8082` / `:8081`; keep those
  host services bound to `0.0.0.0` and allow the Docker bridge subnet (see
  section 5). `DB_PASSWORD` must match appdb's `martinrea` user, and
  `KEYCLOAK_CLIENT_SECRET` must match the existing `martinrea-ap` client.
- **Keycloak split addressing**: `KEYCLOAK_ISSUER` is the token `iss` (verify by
  decoding a token); `KEYCLOAK_JWKS_URI` and `KEYCLOAK_TOKEN_URL` use
  `host.docker.internal:8081` so a container never has to hairpin to the public IP.
