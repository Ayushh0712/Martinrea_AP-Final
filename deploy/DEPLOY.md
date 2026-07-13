# Martinrea AP — VM Deployment Runbook

Deploys the full stack to the **netlink-dev** VM behind a single public port.

- **VM**: `netlink-dev` @ `80.225.204.210` (2 CPU / 8 GB / 100 GB, OCI)
- **Public ports**: `22` (SSH) and `80` (HTTP via Caddy) only
- **Everything else** (frontend, workflow, ingestion, Postgres, Redis, Keycloak) runs on the internal Docker network and is not reachable from the internet.

```
Browser -> http://80.225.204.210 (Caddy :80)
    /api/ingestion/*  -> ingestion  :3002
    /api/*            -> workflow    :3001
    everything else   -> frontend    :3000
workflow -> postgres / redis / keycloak (internal)
ingestion -> keycloak (internal)
```

All deployment files live under `deploy/prod/`:

| File | Purpose |
| --- | --- |
| `docker-compose.prod.yml` | The 7-service stack (caddy, frontend, workflow, ingestion, postgres, redis, keycloak) |
| `Caddyfile` | Reverse-proxy routing (the only published port) |
| `workflow.env` | workflow-service env (internal hostnames, VM IP, secrets) |
| `ingestion.env` | ingestion env (internal hostnames, VM IP, secrets) |

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

Port 22 is already open (that's how you SSH in). Do **not** open 8080/5432/6379.

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

## 5. Build and start

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
`Ingestion service listening ...` (ingestion). Keycloak's realm import on first
boot adds ~30-60s.

---

## 6. Seed the database

The fresh Postgres has an empty schema; Sequelize `synchronize` (NODE_ENV=development)
creates the tables on first workflow boot. Then seed:

```bash
# Minimum: users + approval rules (enough to log in and run the workflow)
docker compose -f deploy/prod/docker-compose.prod.yml exec workflow npm run seed
docker compose -f deploy/prod/docker-compose.prod.yml exec workflow npm run seed:rules

# Optional: full demo dataset (suppliers, POs, invoices, match records, ...)
docker compose -f deploy/prod/docker-compose.prod.yml exec workflow npm run seed:all
```

---

## 7. Smoke test (over port 80)

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

# 4. Ingestion poller ticking
docker compose -f deploy/prod/docker-compose.prod.yml logs --tail=20 ingestion
# -> expect "[dummymreai@gmail.com] N unread message(s)" every 30s

# 5. PO drop folder: copy a PDF into ~/mre-ap/PO-PDFs on the VM, then
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
- **Keycloak admin console** (not public): from the dev machine
  `ssh -L 8080:localhost:8080 netlink-dev@80.225.204.210`, then browse
  `http://localhost:8080` (admin / the KEYCLOAK_ADMIN_PASSWORD in the compose file).
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
- **DB password** in `workflow.env` (`DB_PASSWORD`) must always match
  `POSTGRES_PASSWORD` in `docker-compose.prod.yml`.
