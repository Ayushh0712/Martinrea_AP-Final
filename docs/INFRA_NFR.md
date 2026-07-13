# Infrastructure & Non-Functional Requirements (PRD 5.3)

Status of the infra/NFR items and where each is addressed. Items needing cloud
credentials or a deployment target are marked CONFIG (wire at deploy time).

## CI/CD
- GitHub Actions build+test gate for all three services:
  `.github/workflows/ci.yml` (PRD 6.2). Builds + runs unit tests on push/PR.
- Argo CD (GitOps deploy): CONFIG. Point an Argo `Application` at
  `deploy/k8s/` once the cluster + registry are provisioned.

## Containerization & scaling
- Dockerfiles exist for all three services; root `docker-compose.yml` runs the
  stack.
- Kubernetes + HPA: sample manifests in `deploy/k8s/workflow-service.yaml`
  (Deployment + Service + HorizontalPodAutoscaler, CPU target 70%, 2-10 pods).
  Replicate for ingestion (3002) and integrations (3003).

## Security (NFR 5.3)
- Data in transit (TLS 1.2+): terminate TLS at the ingress/load balancer;
  enforce HSTS. CONFIG.
- Data at rest (AES-256): enable encryption on the managed Postgres + object
  storage (Azure Storage SSE / OCI encryption). CONFIG.
- Auth: JWT with 8h expiry implemented; tokens validated on every request
  (workflow `JwtAuthGuard`, ingestion + integrations guards).
- Secrets: keep out of the image; inject via env / secret store
  (`martinrea-ap-secrets`). The committed demo `.env` secrets must be rotated.

## Observability (NFR 5.3)
- Datadog: integrations already posts sync alerts to the Datadog Events API
  when `DATADOG_API_KEY` is set; add the Datadog agent/APM sidecar per service
  for metrics/traces. CONFIG.
- Sentry: add `@sentry/node` init in each `main.ts` with `SENTRY_DSN`. CONFIG.
- PagerDuty Sev-1: route Datadog monitors (already tagged level/instance/region)
  to PagerDuty. CONFIG.

## Reliability
- Retry with exponential backoff is implemented for external calls (OCR/Azure,
  Epicor alerting). Confirm coverage when real Epicor/Graph adapters land.

## Compliance / retention
- Audit trail: append-only `audit_logs` enforced at DB level
  (`db/migrations/V2__audit_logs_append_only.sql`).
- 7-year retention: configure storage lifecycle + DB backup retention policies.
  CONFIG.

## Credential checklist (deploy time)
- [ ] TLS certs / ingress
- [ ] Managed Postgres with AES-256 + backup retention
- [ ] Object storage encryption + lifecycle (7-yr)
- [ ] DATADOG_API_KEY, SENTRY_DSN, PagerDuty routing
- [ ] Container registry + Argo CD application
- [ ] Kubernetes secret `martinrea-ap-secrets` populated
