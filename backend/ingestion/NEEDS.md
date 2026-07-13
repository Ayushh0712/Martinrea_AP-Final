# NEEDS — Inputs Required to Take the Ingestion Epic to Production

> Author: Ayush (Ingestion Epic owner)
> Status: this file lists everything I need from teammates / IT / business
> before the local-mode build can be flipped to **`INGESTION_PROFILE=prod`**.
> Each item links back to the user story it unblocks.

The local mode is **fully working without any of the items below.** This file
is a checklist for the day we wire real cloud resources in.

> **DEMO-PHASE STATUS (12 Jun 2026):** the project is not deployed anywhere
> yet; it runs on a presenter's laptop. Decisions taken: storage stays on the
> local filesystem (cloud later), email uses a dummy **Gmail inbox over IMAP**
> (`MAIL_TRANSPORT=imap` -- needs the Gmail address + an App Password), and
> Mohd Aman connects this service to the backend via the HTTP document API
> (`BLOB_TRANSPORT=http` -- needs the endpoint contract in item 1.1).
> Everything else below (Graph, real SFTP, Key Vault, Keycloak, cloud envs)
> is **deferred** until cloud deployment.

---

## 1. From Roshni (Data & Repository Epic — DAT-01..05)

This is the single biggest dependency. Every channel ends with a hand-off to
her `BlobUploadClient` interface (see `src/ingestion/shared/blob-upload.client.ts`).

| # | What I need | Why |
|---|---|---|
| 1.1 | **Final REST contract** for the Blob upload endpoint: HTTP method, URL, request schema, response schema, error codes, idempotency semantics. I've stubbed `POST /api/documents/upload` returning `{ documentId, blobPath, isDuplicate }` — confirm or correct. | ING-01 / ING-05 hand-off |
| 1.2 | **Auth model** between my service and hers — service-to-service JWT, mTLS, or shared API key in Key Vault? | All channels |
| 1.3 | **Duplicate-detection contract.** Confirmed: Roshni dedups by `metadata.contentHash` and returns `isDuplicate: true` (HTTP 200) instead of inserting twice. I treat this as a successful no-op. | SFTP retry safety, Email re-poll safety |
| 1.4 | **Quarantine container/endpoint.** Either a separate `POST /api/documents/quarantine` or a flag on the main upload. Currently I assume a `quarantine()` method on her client. | Pre-processing rejection path |
| 1.5 | **Metadata schema confirmation.** I'm stamping `sourceChannel`, `originalName`, `mimeType`, `sizeBytes`, `contentHash`, `ingestedAt`, plus a free-form `sourceMeta`. Confirm this matches her `Invoices` table, especially the `sourceMeta` JSON column shape. | DAT-01 schema compatibility |
| 1.6 | **OCR queue trigger.** Who publishes the message that wakes Abhay's OCR — does Roshni do it on insert, or do I publish to a shared bus from my service? Currently I assume **she does it on insert**. | ING -> OCR hand-off |
| 1.7 | **Health/readiness endpoint** I can hit before publishing my first upload, so I fail fast at boot in DEV/QA if her API is down. | Operational sanity |

---

## 2. From IT / DevOps (Azure tenant + cloud setup)

These unblock real Microsoft Graph + real SFTP + real Key Vault.

### 2.1 Microsoft Graph (ING-02)

| # | What I need |
|---|---|
| 2.1.1 | **Azure AD tenant ID** for Martinrea |
| 2.1.2 | **App registration** for `mre-ap-ingestion-svc` with **Application permissions** (not delegated): `Mail.ReadWrite`, `Mail.Send` (if we ever auto-reply) — admin-consented |
| 2.1.3 | **Client ID + client secret** (or certificate). Client secret rotation policy. |
| 2.1.4 | **AP mailbox addresses** to poll: confirmed list with country/plant attribution. Current placeholders in `.env.local.example`: `ap-mexico@`, `ap-canada@`, `ap-us@` — confirm real values |
| 2.1.5 | **Folder structure inside each mailbox**: confirm I can create `AP-Processed`, `AP-No-Attachment`, `AP-Failed` sub-folders, or pre-created by IT |
| 2.1.6 | Network egress from the Azure VNet to `graph.microsoft.com` (port 443) is open |

### 2.2 SFTP (ING-03)

| # | What I need |
|---|---|
| 2.2.1 | **SFTP host + port** (probably `mre-sftp.martinrea.com`, 22) |
| 2.2.2 | **Service account username + SSH private key** (key in Azure Key Vault) |
| 2.2.3 | **Folder layout decision.** I'm currently designing for one folder per plant: `/incoming/welland/`, `/incoming/saltillo/`, etc. — so I can stamp `plantCode` metadata. Confirm or override. |
| 2.2.4 | **Producer behaviour:** do scanners write `*.tmp` then rename, or do I rely purely on the 30-second mtime grace window? (Currently I do the latter.) |
| 2.2.5 | **Service account permissions:** read + delete on `/incoming/**`. Read-only is **not** sufficient — I must delete after upload to avoid re-ingestion. |
| 2.2.6 | Firewall rule: outbound SSH (port 22) from the Azure VNet to the SFTP host |

### 2.3 Azure Key Vault

| # | What I need |
|---|---|
| 2.3.1 | **Key Vault URL** for DEV / QA / UAT / PROD |
| 2.3.2 | **Managed Identity** assigned to my service with `get`/`list` on secrets |
| 2.3.3 | **Secret naming convention** confirmed (matches the names in `.env.local.example`) |

### 2.4 Cloud environments

| # | What I need |
|---|---|
| 2.4.1 | **DEV / QA / UAT / PROD** environments provisioned per the PRD. I cannot meaningfully UAT-test without QA + UAT. |
| 2.4.2 | **CI/CD pipeline** (GitHub Actions + Argo CD per PRD) configured for this repo, with Sonar/ESLint gates and the Jest test suite as a merge gate. |
| 2.4.3 | **Container registry** target (ACR) and image tag scheme |

---

## 3. From Mohd Aman (Workflow & Approvals Epic — WF-01)

| # | What I need |
|---|---|
| 3.1 | **Keycloak realm + client config** for the `mre-ap` realm. JWT issuer URL, JWKS endpoint. |
| 3.2 | **Role names** — confirmed list: `AP_Clerk`, `Plant_Manager`, `Finance_Director`, `Admin`. The portal upload endpoint requires `AP_Clerk` minimum. |
| 3.3 | **JWT claim path** for the role (e.g. `realm_access.roles[]` vs. flat `role`). |
| 3.4 | **A real `KeycloakAuthGuard` Nest provider** (or a shared library) so I can drop my `StubJwtGuard` and import his. If a shared lib doesn't exist, I'll write the verifier against his JWKS endpoint — but confirm the approach. |

---

## 4. From Abhay (AI & OCR Epic)

| # | What I need |
|---|---|
| 4.1 | **Confirmation** that Abhay's OCR consumer reads from the same queue/topic Roshni publishes to — i.e. I do **not** need to publish anything. (This is the assumption baked into NEEDS.md item 1.6.) |
| 4.2 | **CFDI .xml handling expectation.** Confirm Abhay's CFDI/Spanish detection runs on XML files I forward, not just PDFs. If only PDFs, I need a different routing rule for CFDI XMLs. |

---

## 5. From Manav + Eswar (External Integrations Epic)

| # | What I need |
|---|---|
| 5.1 | **Plant-code list** so my SFTP folder-name → plant-code mapping is accurate (`/incoming/welland/` → `WLD`, etc.). I'm currently inferring uppercase from folder name; confirm or replace with a real lookup. |
| 5.2 | **CFDI inclusion rule.** Confirm `application/xml` is on the allowed-MIME list (it currently is) so SAT-bound files don't get quarantined. |

---

## 6. From Product / Finance SME

| # | What I need |
|---|---|
| 6.1 | ~~**Confirmed file-size cap.** PRD says 10 MB. Mexico CFDI XMLs are tiny; some scanned PDFs from older mailroom hardware can blow past 10 MB. Confirm or raise the limit.~~ **ANSWERED (Ayush, 12 Jun 2026): keep 10 MB.** |
| 6.2 | ~~**Confirmed allowed file types.** PRD lists PDF / JPG / PNG / TIF. We've added XML for CFDI. Anything else (ZIP, EML, MSG)?~~ **ANSWERED (Ayush, 12 Jun 2026): PDF / JPG / PNG / TIF + XML only; revisit later if needed.** (EML/MSG nested-message caveat stands: vendors forwarding invoices as attached emails won't be seen.) |
| 6.3 | ~~**Polling interval.** PRD says every 5 minutes. Acceptance criteria says "within 2 minutes of receipt" for emails — these conflict. Confirm 5 min is fine for Phase 1.~~ **ANSWERED (Ayush, 12 Jun 2026): poll every 2 minutes.** Defaults updated in both services and `.env.example`. |
| 6.4 | ~~**Behaviour when the same invoice arrives via two channels** (e.g. vendor emails AND uploads via portal). Today we de-dup silently. Should the duplicate be surfaced to the AP Clerk?~~ **ANSWERED (Ayush, 12 Jun 2026): keep silent de-dup; revisit later if needed.** |

---

## 7. From QA (Jack H.)

| # | What I need |
|---|---|
| 7.1 | **Test data set** — a representative bag of real-shaped (anonymised) invoices: native PDFs, scanned PDFs, JPEGs from phones, CFDI XMLs, garbage files, oversized files, password-protected PDFs (do they exist?), etc. |
| 7.2 | **Load-test target** — confirm the ~450K-invoices/year figure translates to ~1,233/day peak, and define a burst scenario for month-end. |
| 7.3 | **Negative-path expectations** — confirm the contract for what happens when the SFTP server is down for >1h, when Graph throttles us, when Roshni's API is down. |

---

## 8. Open design questions I'd like input on

| # | Question | My current default |
|---|---|---|
| 8.1 | Single ingestion service per region or one global service? | One global, multi-mailbox |
| 8.2 | Should the portal upload be async (`202` + webhook when OCR done) or sync (`201` immediately)? | Sync — UI shows toast; status polling is Roshni's domain |
| 8.3 | Do we need to store the raw email body somewhere (vendor terms in the email body itself)? | No — only attachments. Push back if Finance disagrees. |
| 8.4 | Virus / malware scanning before Blob upload — Defender for Storage covers post-upload; do we need ClamAV pre-upload? | Defender post-upload is sufficient for Phase 1; keeping our service simple |

---

## How to update this file

When a teammate gives me an answer, I update the row inline (strike-through the
question, add the answer + date) rather than deleting it. That way the audit
trail of "why did we decide X" is preserved, which the PRD requires for every
deliverable anyway.
