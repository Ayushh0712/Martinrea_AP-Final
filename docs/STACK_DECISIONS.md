# Technology Stack Decisions - PRD 5.1 Divergences

The PRD names a specific stack. The current build substitutes some components
(POC-friendly choices). This memo records each divergence, the options, and a
recommendation, with a sign-off line for the product owner. Code is already
structured so the PRD option can be enabled via config where practical.

> Status legend: [ ] pending sign-off, [x] decided.

---

## 1. OCR engine - Azure Document Intelligence vs Tesseract.js
- PRD (OCR-01/02): Azure Document Intelligence (Form Recognizer), prebuilt
  invoice model, keys in Azure Key Vault.
- Current: `tesseract.js` + `pdf-parse` + `pdf2pic` (no cloud key required).
  See `src/ocr-app/ocr/ocr.service.ts`.
- Trade-off: Azure DI gives higher field-extraction accuracy and the structured
  invoice model + scales to the 450K docs/yr target; Tesseract is free/offline
  but lower accuracy on scanned docs.
- Recommendation: adopt Azure DI for QA/PROD; keep Tesseract as an offline/dev
  fallback behind an `OCR_ENGINE` flag.
- [ ] Decision: __________________________

## 2. Identity Provider - Keycloak vs local JWT
- PRD (5.1): Keycloak (SSO, Azure AD, RBAC).
- Current: local HS256 JWT by default; Keycloak already supported via
  `AUTH_PROVIDER=keycloak` (RS256/JWKS) across all three services.
- Recommendation: Keycloak for QA/UAT/PROD; local JWT for local dev only.
  No code change required - flip `AUTH_PROVIDER` + provide realm config.
- [ ] Decision: __________________________

## 3. API style - REST + GraphQL vs REST only
- PRD (5.1): NestJS REST + GraphQL.
- Current: REST only.
- Trade-off: the Phase 1 frontend (dashboard, viewer, workbench, approvals) is
  fully served by the REST surface; GraphQL adds flexibility but also schema +
  maintenance cost.
- Recommendation: ship Phase 1 on REST; revisit GraphQL in Phase 2 if the
  frontend needs flexible aggregation.
- [ ] Decision: __________________________

## 4. Search - Elasticsearch vs PostgreSQL
- PRD (5.1 / DAT-05): PostgreSQL full-text + Elasticsearch; <500ms on 1M rows.
- Current: PostgreSQL with the DAT-01 indexes + the new `/api/invoices/search`
  (filter/sort/paginate/CSV).
- Recommendation: PostgreSQL meets the Phase 1 volume target with the indexed
  search; introduce Elasticsearch in Phase 2 for KPI/analytics + fuzzy search.
- [ ] Decision: __________________________

## 5. Blob storage - Azure Blob (SAS) vs OCI PAR
- PRD (DAT-02): Azure Blob containers + time-limited SAS URLs.
- Current: OCI Object Storage via a Pre-Authenticated Request (PAR); the
  `/api/documents/:id/view` endpoint returns the PAR object URL (SAS-equivalent).
- Recommendation: choose one cloud for PROD. If Azure is the target, swap the
  OCI adapter for `@azure/storage-blob` + SAS generation (the view endpoint and
  ingestion uploader are already adapter-shaped).
- [ ] Decision: __________________________

## 6. ORM strategy - Sequelize vs mixed
- PRD (5.1): Sequelize.
- Current: Sequelize (workflow) + Prisma (OCR) + TypeORM (integrations).
- Recommendation: keep the per-track ORMs but bind them all to the canonical
  Flyway schema in `db/migrations` (synchronize off in QA/PROD). Full ORM
  consolidation is optional and high-churn; the canonical schema is the
  contract that matters.
- [ ] Decision: __________________________

---

Once decisions are recorded here, the corresponding implementation tasks
(Azure DI adapter, Keycloak realm wiring, Azure Blob adapter, Elasticsearch
index) can be scheduled. None of these are blocking for the Phase 1 REST
frontend integration.
