# Martinrea AP Ingestion - Production Skeleton

Three-channel document ingestion (Email / SFTP / Portal) into a validated,
deduplicated funnel that hands off to the OCR/extraction pipeline downstream.

Each channel's transport is selected independently (`MAIL_TRANSPORT`,
`BLOB_TRANSPORT`, `SFTP_TRANSPORT`), with `INGESTION_PROFILE` providing the
defaults:

- **`local`** (default) — filesystem-backed adapters. The whole pipeline
  (Email → SFTP → Portal → validate → "blob") runs end-to-end with **no
  external infrastructure**. Ideal for dev, demos and the E2E suite.
- **`prod`** — real adapters: Microsoft Graph (email), `ssh2-sftp-client`
  (SFTP), the backend document HTTP API (storage), and Keycloak JWT
  verification (portal auth). Each adapter validates its own credentials at
  construction and **fails loudly at boot** if they're missing, so a
  misconfigured deploy never silently drops invoices.

**Demo-phase recipe** (current setup: dummy Gmail inbox, everything else on
the presenter's laptop):

```bash
INGESTION_PROFILE=local
MAIL_TRANSPORT=imap                     # real Gmail inbox via IMAP
IMAP_USER=<dummy>@gmail.com
IMAP_PASSWORD=<gmail app password>      # Google Account -> Security -> App passwords
MAIL_AP_MAILBOXES=<dummy>@gmail.com
# storage + SFTP stay filesystem-backed; when Aman's backend endpoint is
# ready, flip BLOB_TRANSPORT=http and set BLOB_API_BASE_URL.
```

The external credentials/contracts the real adapters need (backend API
contract, Gmail app password, Azure AD/Graph, SFTP host+key, Keycloak realm)
are tracked in [`NEEDS.md`](./NEEDS.md).

---

## What's in the box

```
src/
├── main.ts                          # Bootstrap
├── app.module.ts                    # Root module
└── ingestion/
    ├── ingestion.module.ts          # Profile-aware adapter wiring (local|prod)
    ├── adapters/
    │   ├── local/                   # Filesystem adapters (INGESTION_PROFILE=local)
    │   │   ├── local-blob-uploader.ts
    │   │   ├── local-mail.client.ts
    │   │   └── local-sftp.client.ts
    │   └── prod/                    # Real adapters (INGESTION_PROFILE=prod)
    │       ├── http-blob-uploader.ts   # Roshni's HTTP Blob API
    │       ├── graph-mail.client.ts    # Microsoft Graph (app-only)
    │       └── ssh2-sftp.client.ts     # ssh2-sftp-client
    ├── auth/
    │   ├── express-request.ts       # req.user typing
    │   └── keycloak-auth.guard.ts   # Bearer JWT guard (Keycloak JWKS verify)
    ├── shared/                      # CONTRACTS (interfaces) -- do not edit
    │   ├── blob-upload.client.ts
    │   ├── mail.client.ts
    │   ├── sftp.client.ts
    │   ├── ingestion.types.ts
    │   └── ingestion.errors.ts
    ├── pre-processing/              # Validation / hashing / dispatch
    ├── email/                       # ING-02: automated email poller
    ├── sftp/                        # ING-03: automated SFTP poller
    ├── portal/                      # ING-04: portal upload endpoint
    └── health/                      # GET /ingestion/health
scripts/
├── seed-local-fixtures.ts           # Seed local maildir/SFTP for a demo
├── poll-email-once.ts               # On-demand email poll (ops)
└── poll-sftp-once.ts                # On-demand SFTP poll (ops)
test/
├── fixtures/file-bytes.ts           # Magic-byte fixtures for tests
└── e2e/ingestion.e2e-spec.ts        # ING-06: end-to-end channel suite
.github/workflows/ci.yml             # lint + build + unit(+coverage) + e2e gate
```

---

## How the adapters are wired

`src/ingestion/ingestion.module.ts` selects adapters by profile. Each
injection token resolves to the `local` or `prod` implementation:

| Injection token       | Transport env var | Options (first = local-profile default)             |
| --------------------- | ----------------- | ---------------------------------------------------- |
| `BLOB_UPLOAD_CLIENT`  | `BLOB_TRANSPORT`  | `local` (FS) / `http` (backend document API)         |
| `MAIL_CLIENT`         | `MAIL_TRANSPORT`  | `local` (FS) / `imap` (Gmail demo) / `graph` (M365)  |
| `SFTP_CLIENT_FACTORY` | `SFTP_TRANSPORT`  | `local` (FS) / `ssh2` (real SFTP)                    |

All adapters implement the interfaces in `src/ingestion/shared/` — the
ingestion services know nothing about the transport.

Auth: `KeycloakAuthGuard` (`src/ingestion/auth/keycloak-auth.guard.ts`).
Under `prod` it cryptographically verifies bearer JWTs against Keycloak's
JWKS (issuer + audience) and maps the configured role claim. Under `local`
it accepts any `Bearer <token>` and injects a dev `AP_Clerk` (override with
header `X-Dev-Role: Plant_Manager`). It always fails **closed** in prod.

> The `prod` adapters are wired but require real credentials/contracts
> (`NEEDS.md`). They are exercised against live infrastructure; the `local`
> adapters carry the automated coverage.

---

## Quick start (local profile — zero setup)

```bash
npm install
npm run start:dev            # boots with INGESTION_PROFILE=local by default
```

Try the whole pipeline end-to-end without any cloud resources:

```bash
npm run seed:local           # drop sample invoices into .local-maildir + .local-sftp
npm run poll:email           # ingest the seeded email attachments
npm run poll:sftp            # ingest the seeded SFTP files
# accepted docs -> .local-storage/raw   |   rejected -> .local-storage/quarantine

# Portal upload (local auth accepts any bearer token):
curl -F file=@some-invoice.pdf \
  -H "Authorization: Bearer dev-token" \
  http://localhost:3000/api/ingestion/upload
```

## Running in prod profile

```bash
cp .env.example .env         # set INGESTION_PROFILE=prod and fill in real creds
npm run build
npm run start:prod
```

Expected boot log:

```
[Nest] LOG [IngestionModule] BLOB_UPLOAD_CLIENT -> HttpBlobUploader (backend document API)
[Nest] LOG [IngestionModule] MAIL_CLIENT -> GraphMailClient (Microsoft Graph)
[Nest] LOG [IngestionModule] SFTP_CLIENT_FACTORY -> Ssh2SftpClientFactory
[Nest] LOG [EmailIngestionService] Email cron registered (expression: "0 */2 * * * *")
[Nest] LOG [SftpIngestionService]  SFTP cron registered (expression: "0 */2 * * * *")
[Nest] LOG [NestApplication] Nest application successfully started
```

If an adapter throws at boot (e.g. `GraphMailClient requires GRAPH_TENANT_ID...`),
a required credential is missing — see `NEEDS.md` and your `.env`.

---

## Endpoints

| Method | Path                          | Auth          | Body                       | Returns |
| ------ | ----------------------------- | ------------- | -------------------------- | ------- |
| GET    | `/ingestion/health`           | none          | -                          | `{ status: 'ok', ... }` |
| POST   | `/api/ingestion/upload`       | Bearer JWT    | `multipart/form-data` (`file`, `vendorHint?`, `notes?`) | `{ success, data: { documentId, status, estimatedOcrTimeSec } }` |

Email + SFTP channels run on `@nestjs/schedule` cron jobs — no HTTP
trigger; default every 2 minutes, tune via `EMAIL_POLL_CRON` /
`SFTP_POLL_CRON`.

---

## Environment variables

See `.env.example` for the full list with comments. Required at boot:

| Var                          | Notes                                        |
| ---------------------------- | -------------------------------------------- |
| `MAIL_TRANSPORT` / `BLOB_TRANSPORT` / `SFTP_TRANSPORT` | Per-channel transport overrides |
| `MAX_FILE_BYTES`             | Default 10 MiB                               |
| `ALLOWED_MIME_TYPES`         | Comma-separated (matches against magic bytes)|
| `EMAIL_POLL_CRON`            | Default `0 */2 * * * *` (every 2 min)        |
| `SFTP_POLL_CRON`             | Default `0 */2 * * * *` (every 2 min)        |
| `MAIL_AP_MAILBOXES`          | Comma-separated addresses                    |
| `IMAP_HOST` / `USER` / `PASSWORD` | Gmail/IMAP demo inbox credentials       |
| `GRAPH_TENANT_ID` etc.       | Microsoft Graph app-only credentials         |
| `SFTP_HOST` / `PORT` / `USERNAME` / `PRIVATE_KEY` | SFTP creds                |
| `SFTP_INCOMING_PATHS`        | Comma-separated remote paths                 |
| `BLOB_API_BASE_URL` / `BLOB_API_AUTH_TOKEN` | Backend document API           |
| `KEYCLOAK_ISSUER_URL` / `JWKS_URL` / `AUDIENCE` / `ROLE_CLAIM_PATH` | Keycloak |

---

## Commands

```bash
npm run build         # tsc + nest build
npm run start         # production mode (no watcher)
npm run start:dev     # dev watcher
npm run start:prod    # run from compiled dist/

npm run seed:local    # Seed .local-maildir + .local-sftp with sample invoices
npm run poll:email    # Trigger ONE email poll immediately (no waiting on cron)
npm run poll:sftp     # Trigger ONE SFTP poll immediately

npm test              # Jest unit tests
npm run test:cov      # With coverage thresholds (70/80/80/80)
npm run test:e2e      # ING-06 end-to-end channel suite (local profile)
npm run lint
npm run format
```

---

## Pre-processing pipeline

Every channel ends up calling `PreProcessingService.validateAndHandoff(buffer, meta)`:

1. **Empty check** — `EmptyFileError` (400) if buffer length is zero.
2. **Magic-byte sniff** (`file-type`) — `UnsupportedFileTypeError` (415) if
   the actual content type isn't in `ALLOWED_MIME_TYPES`. This catches
   renamed binaries (e.g. `evil.exe` masquerading as `invoice.pdf`).
3. **Size check** — `FileTooLargeError` (413) if buffer exceeds
   `MAX_FILE_BYTES`. The portal also enforces this at Multer level.
4. **SHA-256 hash** — deduplication key. If the blob backend reports
   `isDuplicate: true`, we still ack the source (don't keep re-polling)
   but skip the OCR handoff.
5. **Quarantine on rejection** — every rejection is shipped to
   `BlobUploadClient.quarantine()` with the reason code, so ops has a
   complete audit trail.

Permanent rejections from SFTP also **delete the source file** from the
remote so we don't re-quarantine the same byte sequence every 5 min.
Transient failures (blob backend down, network blip) leave the file in
place for the next cron tick to retry.

---

## Testing

```bash
npm run test:cov
```

The Jest config enforces 70% branches and 80% lines/statements/functions
across `src/**` (the network-bound `adapters/prod/**` are excluded — they're
integration-tested against live infrastructure). `KeycloakAuthGuard` has its
own dedicated suite covering both the local and prod (JWKS-verified) paths.

`npm run test:e2e` boots the real `IngestionModule` under the `local` profile
against throwaway temp directories and exercises all three channels with the
ING-06 cases: valid (success), oversized (reject), invalid type (reject), and
duplicate (idempotency).

---

## Logical flow

```
                 ┌─────────────────────────────────┐
                 │      PreProcessingService       │
                 │  validate → hash → dispatch     │
                 └──────────────┬──────────────────┘
                                │
       ┌────────────────────────┼─────────────────────────┐
       │                        │                         │
┌──────▼──────┐         ┌───────▼─────────┐         ┌─────▼──────┐
│ Email cron  │         │   SFTP cron     │         │  Portal    │
│ (Graph)     │         │  (ssh2-sftp)    │         │  (HTTP)    │
└─────────────┘         └─────────────────┘         └────────────┘

           ▼ rejections quarantined        ▼ accepted uploads
    BlobUploadClient.quarantine()    BlobUploadClient.upload()
                                         (dedup by SHA-256)
                                              │
                                              ▼
                                   ┌────────────────────────┐
                                   │ Downstream OCR pipeline │
                                   │ (Roshni's queue trigger)│
                                   └────────────────────────┘
```

See `NEEDS.md` for the open checklist of integration details still
required from each team (Roshni, IT, Mohd Aman).
