# Martinrea AP Phase 1 — Workflow & Approvals Service

**Owner:** Mohd Aman (Workflow & Approvals Epic)
**Scope:** PRD Section 4.7 — tasks WF-01 .. WF-05
**Stack:** NestJS 10 (Node.js), TypeScript, Sequelize, PostgreSQL 16, Passport-JWT, bcryptjs

This service is the governance backbone of the AP platform. It owns:

| Task | Status | Description |
|------|--------|-------------|
| **WF-01** | DONE | RBAC, JWT auth, 3 Phase-1 roles + VP_Finance hook, route-level guards |
| **WF-02** | DONE | Invoice lifecycle state machine, transactional transitions + audit |
| **WF-03** | DONE | Sequential approval routing rules engine (config-driven thresholds) |
| **WF-04** | DONE | Email notifications via nodemailer + Mailpit (local) / SMTP relay (prod) |
| **WF-05** | DONE | SLA escalation cron - hourly @Cron job + run-now endpoint |

---

## WF-03 / WF-04 / WF-05 deliverable summary

**WF-03 - Routing Engine** (`src/rules-engine/`)
- `ApprovalRule` Sequelize entity backs the `approval_rules` table (PRD WF-03 requirement: config-driven, not hardcoded).
- `RulesEngineService.computeApprovalChain(amount, plantId)` matches a rule by amount band and resolves each role in the chain to a concrete user (Plant_Manager by `plantId`, FD/VP by first-active).
- `InvoicesService.submitMatch()` now sets `approval_chain`, `current_approver_id`, and `pending_approval_since`.
- `InvoicesService.approve()` enforces **segregation of duties**: only the user matching `current_approver_id` may approve, even if they are FD. Returns 403 otherwise.
- Multi-step approvals stay in `PENDING_APPROVAL`; the state machine only fires the final `PENDING_APPROVAL -> APPROVED` transition when the chain is exhausted.
- Default rules (seeded by `npm run seed:rules`):

| Rule | Min | Max | Chain |
|---|---|---|---|
| Tier-1-Small | - | $10,000 | Finance_Director |
| Tier-2-Medium | $10,000 | $50,000 | Plant_Manager → Finance_Director |
| Tier-3-Large | $50,000 | - | Plant_Manager → Finance_Director → VP_Finance |

**WF-04 - Email Notifications** (`src/notifications/`)
- `NotificationsService` uses `nodemailer`; transport built from env vars.
- HTML + plain-text templates, mobile-responsive, Martinrea-branded, HTML-injection safe.
- Fired on (a) entry into `PENDING_APPROVAL`, (b) each chain advance, (c) every SLA escalation.
- Local dev uses **Mailpit** (added to `docker-compose.yml`): SMTP on `localhost:1025`, web UI on `http://localhost:8025` - no credentials required.
- `MAIL_ENABLED=false` flips the service to no-op (CI / restricted environments).

**WF-05 - SLA Escalation Cron** (`src/escalation/`)
- `EscalationService.runHourly()` is decorated with `@Cron(CronExpression.EVERY_HOUR)`.
- Finds invoices in `PENDING_APPROVAL` whose `pending_approval_since` is older than `SLA_PENDING_APPROVAL_HOURS` (default 48 per PRD) and that have not been escalated within the same window.
- Sends an escalation email to the current approver AND their manager (`users.manager_id`).
- Stamps `last_escalated_at` so subsequent cron ticks do not re-send within the same window.
- Writes an immutable `SLA_BREACH` row to `Audit_Logs` (PRD WF-05 requirement).
- `POST /api/escalation/run-now` (FD-only) triggers a single pass for testing without waiting an hour.

### End-to-end smoke test
After `npm run seed:all && npm run start:dev`:
```powershell
.\scripts\smoke-all-wf.ps1
```
Runs Tier 1/2/3 routing, segregation-of-duties, chain advance, email capture (verified against Mailpit's REST API), forced SLA breach, and dedup-on-second-run.

Latest run captured:
- 38/38 unit tests passing across 5 suites
- 6 approval-required emails for the chain runs (1 + 2 + 3 = chain lengths)
- 2 escalation emails (approver + manager) on the forced SLA breach
- 0 escalated on immediate re-run (debounce works)
- `audit_logs` action_type tally: `INVOICE_CREATED=7`, `INVOICE_STATE_TRANSITION=39`, `INVOICE_APPROVAL_STEP=3`, `SLA_BREACH=1`

---

## WF-02 deliverable summary

Implements every PRD WF-02 acceptance criterion (Section 4.7):

- 9-state lifecycle enum (`src/common/enums/invoice-status.enum.ts`) — matches PRD §5.2 exactly.
- Pure transition map + per-transition guards (`src/invoices/state-machine/transitions.ts`).
- `InvoiceStateMachineService` with `canTransition`, `assertTransition`, `getAllowedTransitions` — no DB I/O, easy to unit test.
- `InvoicesService.transition()` is **transactional**: row-locks the invoice (`FOR UPDATE`), validates against the state machine, updates the row, and writes a single `Audit_Logs` entry — all in one DB transaction.
- Illegal transitions throw `ConflictException` → **HTTP 409** with a descriptive error listing the allowed next states (or "terminal state").
- `REJECTED` requires a `reason`; the reason is persisted to the live row and captured in audit JSON.
- Approver-only endpoints (`/approve`, `/reject`) reuse the WF-01 `@Roles()` guard, so `AP_Clerk` still gets `403`.
- Unit tests cover happy-path, illegal transitions, terminal state, and off-ramps (reject/exception).

### Endpoints (under `/api/invoices`)
| Method | Path | Allowed roles | Purpose |
|---|---|---|---|
| POST | `/` | any authed | Create invoice (status = `RECEIVED`) |
| GET | `/:id` | any authed | Fetch invoice |
| GET | `/:id/allowed-transitions` | any authed | What states this invoice can move to next |
| POST | `/:id/transitions` | Finance_Director | Generic transition (ops / break-glass) |
| POST | `/:id/submit-review` | any authed | `PENDING_REVIEW` → `PENDING_MATCH` (Aditya UI-A) |
| POST | `/:id/submit-match` | any authed | `PENDING_MATCH` → `MATCHED` → `PENDING_APPROVAL` (Yash UI-B-05) |
| POST | `/:id/approve` | Plant_Manager, Finance_Director | `PENDING_APPROVAL` → `APPROVED` |
| POST | `/:id/reject` | Plant_Manager, Finance_Director | `PENDING_APPROVAL` → `REJECTED` (reason required) |
| POST | `/:id/flag-exception` | any authed | `PENDING_MATCH` → `EXCEPTION` |

### Smoke test
After `npm run seed && npm run seed:invoices && npm run start:dev`:
```powershell
.\scripts\smoke-wf02.ps1
```
Runs 9 live scenarios end-to-end (illegal transition → 409, happy path, terminal state, MXN invoice → MATCHED, RBAC, reject + rework).

---

## WF-01 deliverable summary

Implements every PRD WF-01 acceptance criterion:

- JWT-based authentication via Passport (`src/auth/strategies/jwt.strategy.ts`).
- Roles in token payload, validated on every request (global `JwtAuthGuard`).
- Three Phase-1 roles (`src/common/enums/role.enum.ts`):
  `AP_Clerk`, `Plant_Manager`, `Finance_Director`. `VP_Finance` is
  defined as a future-extension hook for WF-03.
- `@Roles(...)` decorator + `RolesGuard` enforce route-level RBAC.
  Calling an approver-only route as `AP_Clerk` returns **403 Forbidden**.
- `@Public()` decorator for opt-out (e.g. `/health`, `/auth/login`).
- Append-only `AuditLog` model + service used by login flow
  (`AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILED`) — matches the audit
  contract WF-02..WF-05 will reuse.

---

## Run locally

### 1. Install deps
```bash
cd workflow-service
npm install
```

### 2. Start Postgres (Docker)
```bash
npm run db:up
```

### 3. Copy env
```bash
copy .env.example .env       # Windows
# cp .env.example .env       # macOS/Linux
```

### 4. Seed demo users
```bash
npm run seed
```
Creates three users, all with password `Password123!`:
| Email | Role |
|-------|------|
| clerk@martinrea.dev | AP_Clerk |
| pm@martinrea.dev | Plant_Manager |
| fd@martinrea.dev | Finance_Director |

### 5. Start the service
```bash
npm run start:dev
```
Visit `http://localhost:3001/api/health` — should return `{ status: 'ok' }`.

### 6. Try it out
```bash
# Login as AP Clerk
curl -X POST http://localhost:3001/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"clerk@martinrea.dev\",\"password\":\"Password123!\"}"

# Take the accessToken and hit the approver-only endpoint -> 403
curl http://localhost:3001/api/workflow/approval-test ^
  -H "Authorization: Bearer <CLERK_TOKEN>"

# Login as Finance Director -> 200 OK
curl http://localhost:3001/api/workflow/approval-test ^
  -H "Authorization: Bearer <FD_TOKEN>"
```

### Tests
```bash
npm test
```
Covers `RolesGuard` — confirms the WF-01 acceptance criterion
"AP_Clerk hitting an approval endpoint returns 403".

---

## What I need from you / the team

### From you (Mohd Aman)

1. **Confirm dev DB password** — `.env.example` ships with
   `martinrea_dev_pwd`. Fine for local; production secret comes from
   Azure Key Vault.
2. **Run the steps above** and confirm `npm run start:dev` starts
   cleanly on your machine, and the curl roundtrip works.

### From Roshni (Data & Repository — DAT-01)

The `users` and `audit_logs` Sequelize models in this repo are
**workflow-service-local**. Once Roshni publishes the unified Flyway
migration she owns, we must:

- Switch `synchronize: true` to `false` (already config-gated by `NODE_ENV`).
- Align column names / FK rules with her canonical schema.
- Move audit_log append-only enforcement from app-layer to a DB trigger.

**Sync needed (please book 30 min with Roshni):**
- [ ] Final shape of the `users` table (email, role enum, plant_id, manager_id, is_active)
- [ ] Final shape of `audit_logs` (must be append-only at DB level)
- [ ] Confirm `Rules_Engine` table location (this service or hers)
- [ ] Confirm new `Invoices` columns required for WF-02/03: `status`,
      `current_approver_id`, `approval_chain` (JSONB), `approvals_completed` (JSONB)

### From Yash (UI/UX B — UI-B-05)

WF-02/03 will expose `POST /api/workflow/submit-match`. Before I build
it, lock the request payload contract with Yash. Proposed shape:

```jsonc
// POST /api/workflow/submit-match
{
  "invoiceId": "uuid",
  "poNumber": "PO-12345",
  "supplierId": "uuid",
  "totalAmount": 12500.00,
  "currency": "USD",
  "matchSummary": { "discrepancies": 0, "lines": 8 },
  "submittedBy": "uuid"
}
```

### From Aditya / Vedant / project leads

- [ ] **DOA matrix** (PRD Section 7.1) — required *before* WF-03. Need:
      user -> approval limit -> cost center mapping.
- [ ] **Org hierarchy** — required *before* WF-05 escalation chain
      (approver -> manager -> VP).
- [ ] **Identity Provider decision** — PRD §5.1 names Keycloak with
      Azure AD integration. For WF-01 we issue local HS256 JWTs (faster
      to iterate). To switch to Keycloak later we swap one file:
      `src/auth/strategies/jwt.strategy.ts` (use Keycloak public key +
      RS256, drop the local login endpoint, keep all guards untouched).
- [ ] **SMTP / Azure Communication Services credentials** — needed for WF-04.

### From Manav (Integrations)

No direct dependency for WF-01 or WF-02. Goods-receipt data from the
integrations service feeds the WF-02 three-way match.

---

## Project layout

```
src/
  app.module.ts                # Wires global guards
  app.controller.ts            # /health (public) + /workflow/approval-test (RBAC demo)
  main.ts                      # Bootstrap (ValidationPipe, /api prefix)
  config/
    configuration.ts           # Typed env loader
  common/
    enums/role.enum.ts         # Role enum (Phase 1 + VP_Finance hook)
    decorators/
      roles.decorator.ts       # @Roles(...)
      public.decorator.ts      # @Public()
      current-user.decorator.ts# @CurrentUser()
    guards/
      jwt-auth.guard.ts        # Global JWT auth (honours @Public)
      roles.guard.ts           # Global RBAC (honours @Roles)
      roles.guard.spec.ts      # Unit tests
  database/database.module.ts  # Sequelize wiring
  users/                       # User entity, service, controller (DAT-01 placeholder)
  auth/                        # Login, JWT strategy
  audit-logs/                  # Append-only AuditLog (DAT-04 placeholder)
  seeds/seed-users.ts          # Demo users for local dev
```

---

## Definition of Done — WF-01

- [x] JWT auth issuing 8-hour tokens (configurable)
- [x] Roles encoded in token payload
- [x] Global guards: JwtAuthGuard + RolesGuard
- [x] Three roles + VP_Finance extension hook
- [x] @Roles(), @Public(), @CurrentUser() decorators
- [x] AP_Clerk -> approval endpoint = 403 (proved by unit test)
- [x] Login attempts logged to AuditLog (success and failure)
- [x] /health public, /auth/login public
- [x] Seed script with one user per role
- [x] Docker Compose for Postgres
- [x] README with run instructions and team dependencies
- [x] >= 80% coverage on RolesGuard (target per PRD §6.2)
