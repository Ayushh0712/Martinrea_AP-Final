# PRD Gap Analysis — Martinrea AP Phase 1

**Source:** MRE AI PRD v1.0 (May 2025) vs. full repository audit of `backend/`, `frontend/`, `db/`, `deploy/`, and CI configuration.
**Date:** July 7, 2026

---

## Summary

| Category | Count |
|---|---|
| Missing entirely | 14 |
| Replaced with substitutes | 6 |
| Built, but off-spec | 10 |
| Functional flow present | ~85% |

> **Compliance-critical gap:** CFDI / SAT validation for Mexico plants is a Phase 1 objective (PRD §2.2) and a hard compliance NFR ("Mexico plant invoices must pass SAT validation before matching"), but it was deliberately removed — migration `V4__drop_cfdi_columns.sql` drops the CFDI columns and no SAT client exists. XML files are still accepted at ingestion, but nothing validates them.

---

## 1. Missing entirely

PRD requirements with no implementation in the repository, in rough order of impact.

| Requirement | Track | PRD Reference | Evidence |
|---|---|---|---|
| CFDI / SAT validation (Mexico compliance) | Integrations | INT-04, §2.2, NFR Compliance | Deliberately removed — `db/migrations/V4__drop_cfdi_columns.sql` drops the CFDI columns; no SAT webservice client exists anywhere in `backend/` |
| `DOCUMENT_TYPE: 'CFDI'` flag from OCR | AI / OCR | OCR-05 | Spanish keyword detection exists (`language.detector.ts`) but the document-type enum is only INVOICE / RECEIPT / PURCHASE_ORDER |
| GraphQL API layer | Stack | §5.1 Backend/API | REST only across all three services; divergence noted in `docs/STACK_DECISIONS.md` §3 |
| Elasticsearch | Stack | §5.1 Search | No ES service or dependency anywhere; search uses Postgres ILIKE (not even PG full-text tsvector). Deferred per `STACK_DECISIONS.md` §4 |
| Azure Key Vault | Stack | OCR-01, §5.1 | Mentioned only in `.env.example` comments; secrets live in plain `.env` files |
| Sentry error tracking | Monitoring | §5.1 Monitoring | No `@sentry/node` in any `package.json`, no `SENTRY_DSN`; flagged as TODO in `docs/INFRA_NFR.md` |
| Argo CD + backend deploy pipeline | CI/CD | §5.1 CI/CD | Root CI only builds and tests; no Docker image push, no deploy step, no Argo Application manifests. Only the frontend deploys (Vercel) |
| Azure AD integration (Keycloak federation) | Security | §5.1 Security | `keycloak/import/martinrea-realm.json` has no Azure AD identity provider configured |
| Org hierarchy table (escalation chain) | Workflow | WF-05 | PRD requires approver → manager → VP chain from an org hierarchy table; no such table in Flyway migrations, `plant_id` is a plain varchar |
| Live Goods Receipt panel (true 3-way match) | UI Track B | UI-B-01/02 | GR panel in `MatchPage.tsx` is a locked "Phase 2" stub; `integrationsApi.goodsReceipts()` client exists but is never called — UI does 2-way match only |
| ±2% price-variance amber tier | UI Track B | UI-B-03 | Comparison uses exact half-cent matching and flags everything red; the `'amber'` flag type exists but is never assigned |
| "Assigned To" column on dashboard | UI Track A | UI-A-01 | Invoice table in `InvoiceProcessingPage.tsx` has all other PRD columns but no assignee |
| Email deep-link approval flow | Workflow / UI | WF-04 | Notification emails are sent, but there is no token-based approval route; `LoginPage` ignores the `?from=` redirect the proxy sets |
| Dedicated supervisor exception queue | UI Track B | UI-B-04 | Exceptions appear as a collapsible panel in the clerk Command Center; no supervisor-only view |

---

## 2. Specified one way, built another

The approved tech stack (§5.1) was swapped in several places. Most swaps are tracked as intentional POC decisions in `docs/STACK_DECISIONS.md`, but they remain deviations from what the PRD approves.

| PRD specifies | Project actually uses | Where |
|---|---|---|
| Azure Document Intelligence (Prebuilt Invoice model) | Tesseract + pdf-parse + pdf2pic (local OCR) | `backend/workflow/src/ocr-app/ocr/ocr.service.ts`; divergence documented in `docs/STACK_DECISIONS.md` §1 |
| Azure Blob Storage (invoices-raw / processed / rejected + SAS URLs) | OCI Object Storage with PAR URLs (`AP-Accepted_Correct/`, `quarantine/`, `meta/` prefixes) | `backend/ingestion/.../oci-par-blob-uploader.ts`; view URLs from `oci.service.ts` |
| Live Epicor CMS connectivity (ODBC/JDBC or SFTP, 44 plants) | `MockEpicorService` — 44 instances configured, nightly 2 AM cron runs, but all data is mocked | `backend/integrations/src/mock-epicor/`; TODO comments in suppliers-sync / purchase-orders-sync services |
| Keycloak as the IdP (SSO, RBAC) | Local HS256 JWT by default; Keycloak wired but opt-in via `AUTH_PROVIDER=keycloak` | `backend/workflow/src/auth/strategies/jwt.strategy.ts`; root `.env.example` defaults to local |
| Message queue between ingestion and OCR | OCI bucket handoff + polling cron (every 2 min); BullMQ/Redis only inside the workflow service | `backend/workflow/src/ocr-app/oci/oci-autoingest.service.ts`; `queue.module.ts` |
| PostgreSQL full-text search (+ Elasticsearch) | Plain ILIKE pattern matching with btree indexes | `backend/workflow/src/invoices/invoices.service.ts` |

---

## 3. Implemented, but not to spec

| Area | Gap vs PRD |
|---|---|
| Approval routing tiers (WF-03) | Rules engine + `approval_rules` table exist, but seeds only define $10K tiers — the PRD $50K → VP_Finance third tier was removed from `seed-rules.ts` (unit tests still use $50K) |
| Polling cadence (ING-02/03) | Email, SFTP, and OCI auto-ingest all default to every 2 minutes; PRD specifies 5 minutes |
| Pre-processing rules (ING-01/05) | Also accepts XML beyond the PRD's PDF/JPG/PNG/TIF list (intended for CFDI — which is no longer validated); quarantine goes to an OCI prefix, not a 'Rejected' container |
| Kubernetes (§5.1 Infrastructure) | Only `deploy/k8s/workflow-service.yaml` exists (with HPA); no manifests for ingestion or integrations services, no Helm |
| Datadog (§5.3 Observability) | Events API posts from the Epicor sync only; no agent, APM SDK, or PagerDuty wiring |
| Flyway schema coverage (DAT-01) | `purchase_order_lines`, `ocr_results`, `sync_run_logs` exist only as ORM entities outside migrations; soft delete uses `deleted_at` instead of the PRD's `is_deleted` |
| Dashboard details (UI-A-01/02) | Filters live in a popover, not the PRD's sidebar; only 3 columns sortable; "Invoice Date" column actually shows `createdAt` |
| Exception attachment (UI-B-04) | Flag Exception modal exists, but the optional file attachment only stores the filename in the notes string — no upload |
| Submit-for-approval confirmation (UI-B-05) | Flow is split across `/match` and `/ready-to-submit`; confirmation modal does not show the next approver in the chain |
| Ingestion e2e tests (ING-06) | Ingestion has a full e2e suite in CI, but workflow and integrations services have no e2e coverage |

---

## 4. Correctly absent — PRD §7.3 out-of-scope items

These are not gaps: the PRD explicitly excludes them from Phase 1.

- AI/ML automated 2-way and 3-way matching (Phase 2)
- Automated voucher creation into Epicor CMS (Phase 2)
- Supplier Self-Service Portal (Phase 3)
- Bank reconciliation and payment automation (Phase 3)
- Advanced analytics, SLA dashboards, KPI reporting (Phase 2/3)
- Mobile PWA / app-store deployment (future scope)

---

## What is working

The core Phase 1 flow is largely present: all three ingestion channels (email via MS Graph/IMAP, SFTP, portal upload), OCR with confidence scoring and a review queue, the invoice lifecycle state machine with 409 enforcement, the search API, append-only audit logs, SMTP notifications, and hourly SLA escalation.

---

*Method: full-source audit of the three NestJS services (ingestion 3003, workflow 3001, integrations 3002), the Next.js frontend, Flyway migrations, deploy manifests, and CI workflows, checked against every acceptance criterion in PRD sections 2–6.*
