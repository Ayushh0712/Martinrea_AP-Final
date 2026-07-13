# Martinrea AP — Backend Integration Guide

How the three backend folders are linked into one platform, how the frontend
plugs in, and exactly which credentials to supply on the server.

> Source of truth for requirements: `MRE AI PRD.docx` (Phase 1 — Foundation
> & Paperless). The invoice lifecycle below follows PRD §5.2.

---

## 1. The three services

| Folder | Service | Port | Owns | Storage |
|---|---|---|---|---|
| `backend/workflow` | **workflow-service** | `3001` | Auth/RBAC, invoice lifecycle + approvals (WF-01..05), AI OCR pipeline (`/api/ocr/*`), users, audit logs | Postgres (`public` via Sequelize + `ocr` schema via Prisma), OCI blob, Redis |
| `backend/ingestion` | **ingestion** | `3002` | Email (IMAP/Graph), SFTP, portal upload (ING-01..06) | Writes documents to the **OCI bucket** |
| `backend/integrations` | **integrations** | `3003` | Epicor sync (INT-01/02), live Goods-Receipts API (INT-03) | Postgres (TypeORM) |

All three are NestJS. They share **one Postgres**, **one OCI bucket**, and
**one auth token** — configured entirely via env (see `.env.example`).

---

## 2. End-to-end data flow (PRD §5.2)

```
                         ┌─────────── Email / SFTP / Portal ───────────┐
                         ▼                                             │
                  ingestion (:3002)                                    │
                  validate (PDF/JPG/PNG/TIF/XML, ≤10MB)                │
                         │ PUT bytes + meta                            │
                         ▼                                             │
                  OCI bucket  raw/<hash>-<name>                        │
                         │                                             │
   (backend OCI auto-ingest poller, every 2 min) lists raw/ ──────────┘
                         ▼
   workflow-service (:3001) OCR pipeline
     RECEIVED → OCR_PROCESSING → (Azure/Tesseract extract + confidence)
     → PENDING_REVIEW  (low confidence flagged for human verify)
                         │  OCR→workflow bridge
                         ▼
   workflow invoice (lifecycle, dashboard, audit)
     PENDING_REVIEW → PENDING_MATCH → MATCHED → PENDING_APPROVAL → APPROVED
                                  ▲                         │
        matching workbench (frontend) pulls live GR from    │ approvals,
        integrations (:3003) GET /api/integrations/         │ routing,
        goods-receipts?po=..&instance=..                    ▼ SLA escalation
                                                       REJECTED / EXCEPTION
```

Cross-service seams that were wired to link the folders:

1. **ingestion → OCI → backend.** Ingestion uploads to the OCI bucket
   (`BLOB_TRANSPORT=par`, the link in the ingestion folder). The backend reads
   the **same** bucket (`OCI_PAR_URL`) and an **auto-ingest poller**
   (`OCI_AUTOINGEST_ENABLED`) pulls new `raw/` objects into the OCR pipeline.
2. **OCR → workflow lifecycle.** When OCR finishes, the
   `OCR_WORKFLOW_BRIDGE_ENABLED` bridge creates/updates the workflow invoice so
   it enters the PRD lifecycle and shows on the dashboard.
3. **workbench → integrations.** The frontend matching workbench fetches PO
   (cached in DB) + live Goods Receipts from the integrations service.
4. **match → approvals.** `POST /api/invoices/:id/submit-match` hands off to the
   workflow routing engine (WF-03) → email notifications (WF-04) → SLA
   escalation (WF-05).

---

## 3. Authentication (one token everywhere)

The frontend authenticates **once** and sends `Authorization: Bearer <token>`
to all three services. Two interchangeable modes (set `AUTH_PROVIDER`):

- **`local`** (default / simplest): the frontend logs in via
  `POST :3001/api/auth/login` → receives an HS256 JWT. ingestion + integrations
  verify it with the **same `JWT_SECRET`**.
- **`keycloak`** (PRD target): the frontend does OIDC against Keycloak; all
  three verify RS256 tokens against the Keycloak JWKS.

Per-service auth switches (so you can stage the rollout):
`INGESTION_AUTH_MODE` and `INTEGRATIONS_AUTH_MODE` = `off` | `jwt` | `keycloak`.

Roles (PRD WF-01): `AP_Clerk`, `Plant_Manager`, `Finance_Director` (+`VP_Finance`).

---

## 4. Unified API map (for the frontend)

Base URLs come from env; defaults shown.

### workflow-service — `http://localhost:3001/api`
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Login → `{ accessToken }` |
| GET | `/health` | Health (public) |
| GET | `/invoices` | Dashboard list (filter/paginate) |
| GET | `/invoices/:id` | Invoice detail |
| GET | `/invoices/:id/allowed-transitions` | Enable/disable action buttons |
| POST | `/invoices/:id/submit-review` | PENDING_REVIEW → PENDING_MATCH |
| POST | `/invoices/:id/submit-match` | PENDING_MATCH → MATCHED → PENDING_APPROVAL |
| POST | `/invoices/:id/approve` | Approver action |
| POST | `/invoices/:id/reject` | Approver action (reason required) |
| POST | `/invoices/:id/flag-exception` | Workbench exception |
| GET | `/ocr/invoices` | OCR list / review queue |
| GET | `/ocr/invoices/:id` | OCR fields for the split-screen viewer |
| GET | `/ocr/invoices/:id/file` | Original document download |
| POST | `/ocr/invoices/extract` | OCR-extract without saving (review) |
| POST | `/ocr/invoices/commit` | Persist human-verified fields |
| GET | `/ocr/oci/files` | List documents in the OCI bucket |
| POST | `/ocr/oci/process` | Pull an OCI object + run OCR |
| GET | `/users`, `/audit-logs`, `/escalation` | Admin / governance |

### ingestion — `http://localhost:3002`
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ingestion/upload` | Portal upload (multipart `file`) → `{ documentId, status }` |
| GET | `/ingestion/health` | Health |

### integrations — `http://localhost:3003/api/integrations`
| Method | Path | Purpose |
|---|---|---|
| GET | `/goods-receipts?po=&instance=&page=&limit=` | Live GR for the workbench (INT-03) |
| POST | `/sync/trigger` | Kick off an Epicor sync (INT-01/02) |
| GET | `/health` | Epicor + last-sync health |

Swagger: `:3001/api/docs` and `:3003/api/docs`.

---

## 5. Running the linked stack

1. Copy `.env.example` → fill the `<<< SERVER >>>` values → distribute the
   blocks to each service's `.env` (or use docker-compose `env_file`).
2. With Docker (recommended for the server):
   ```bash
   docker compose up --build
   ```
   Starts the 3 services. Add `--profile local` to also start a local
   Postgres + Redis for development.
3. Without Docker (per service):
   ```bash
   npm install && npm run build && npm run start:prod   # in each folder
   ```

---

## 6. Credentials to provide on the server  ( `<<< SERVER >>>` )

- [ ] **Postgres**: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
      (one DB for all services) + the Prisma `DATABASE_URL` (same DB, `ocr` schema).
- [ ] **Redis**: `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` (OCR queue).
- [ ] **OCI**: a valid `OCI_PAR_URL` ending in `/o/` (shared by ingestion + backend).
- [ ] **Auth**: pick `AUTH_PROVIDER`. For `local`, one shared `JWT_SECRET`.
      For `keycloak`, the realm `KEYCLOAK_*` values.
- [ ] **Email in** (ingestion): IMAP creds, or Graph `GRAPH_*`.
- [ ] **Email out** (workflow): `SMTP_*` for approval notifications.
- [ ] **SFTP** (ingestion, optional): `SFTP_*`.
- [ ] **Epicor** (integrations): real connectivity when VPN/creds land
      (mock Epicor data is used until then).
- [ ] **CORS_ORIGINS**: the deployed frontend origin(s).

> ⚠️ The committed `.env` files currently contain real secrets (Gmail app
> password, Keycloak secret, DB password, OCI PAR). Rotate these and keep real
> values out of source control — use the server's secret store.
