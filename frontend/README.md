# Martinrea — Frontend (Phase 1, Vertical Slice)

Production-grade React SPA for the **Martinrea — Accounts Payable Automation Suite**.
Connects to the existing NestJS backend at `http://localhost:3001/api`.

This is the **vertical slice** delivery: complete polished Login → Dashboard → Invoice Processing flow with the full app shell, design system, data layer, and seed mechanism in place. Remaining sidebar pages (OCR Validation, Approval Workflow, Exceptions, Audit Logs, Admin, etc.) render a polished "Coming Soon" placeholder so the navigation is intact — they'll be implemented in subsequent passes.

---

## Tech stack

- **React 18 + TypeScript** (Vite 5)
- **React Router v6** — client-side SPA routing
- **TanStack Query v5** — every fetch and mutation
- **Axios** — single instance with JWT request interceptor + global 401 handler
- **Tailwind CSS** — utility-first, with Martinrea brand tokens
- **shadcn/ui-style primitives** — locally vendored (Button, Card, Input, Label, Dialog, Dropdown, Select, Tabs, Badge, Skeleton, Separator, Textarea, Tooltip, Toaster)
- **Recharts** — pipeline bar chart on the dashboard
- **React Hook Form + Zod** — every form (login, create invoice, reject reason)
- **date-fns** — date formatting
- **Lucide React** — icons
- **sonner** — toast notifications

---

## Run locally

### 0. Prerequisites

- Node.js 20+ (this repo was developed on 22.x)
- The NestJS backend running on `http://localhost:3001` with `npm run seed` already executed so the three demo users exist

### 1. Install

```bash
cd frontend
npm install
```

### 2. Configure

A default `.env` is committed for local dev:

```env
VITE_API_BASE_URL=http://localhost:3001/api
```

Override it for staging / production.

### 3. Run

```bash
npm run dev
```

Open `http://localhost:5173`.

### 4. Sign in

Use any of the seeded backend accounts (password is the same for all):

| Role             | Email                  | Password       |
| ---------------- | ---------------------- | -------------- |
| AP Clerk         | `clerk@martinrea.dev`  | `Password123!` |
| Plant Manager    | `pm@martinrea.dev`     | `Password123!` |
| Finance Director | `fd@martinrea.dev`     | `Password123!` |

The login page lists these as one-click demo buttons.

### 5. Seed demo invoices

The backend exposes only `GET /invoices/:id` (no list endpoint). To populate the dashboard and processing pages with realistic data, sign in as **Finance Director** (so all transition endpoints work) and click **"Seed demo invoices"** on the Dashboard empty state. This calls the real backend through the public endpoints — there are no mocks anywhere in the frontend.

The seed creates ~24 invoices and drives each through the lifecycle to land in a varied final state: RECEIVED, PENDING_REVIEW, PENDING_MATCH, PENDING_APPROVAL, APPROVED, REJECTED, and EXCEPTION. Invoice IDs are persisted in `localStorage` so list pages can enumerate them via parallel `GET /invoices/:id` calls (React Query caches each).

---

## What's built

### Pages (live)

- **`/login`** — Two-pane sign-in with branded marketing rail, demo-account quick-fill, ⌘K-ready search global
- **`/dashboard`** — KPI tiles (open / awaiting approval / exceptions / approved value), pipeline bar chart, recent invoices feed, "My approval queue", status legend, empty-state seed prompt
- **`/invoices`** — Status-chip filters, search by invoice/PO/supplier, plant filter, sortable columns (invoice #, amount, updated), URL-synced state, partial-failure tolerant
- **`/invoices/:id`** — Header with amount + status, full action toolbar (Submit for review, Run match & route, Approve, Reject with reason modal, Flag as exception), allowed-transitions hint, lifecycle timeline showing reached/current/future stages with REJECTED/EXCEPTION off-ramps, approval chain with per-step decisions/timestamps/notes, metadata grid

### Pages (placeholder)

`/ocr`, `/documents`, `/match`, `/approvals`, `/exceptions`, `/payments`, `/vendors`, `/search`, `/analytics`, `/audit`, `/admin` all render the polished `ComingSoonPage` so the sidebar is complete.

### Cross-cutting

- **Auth** — JWT stored in `localStorage` (key `martinrea.auth.token`), attached automatically to every Axios call, 401 wipes token + redirects to `/login`, `/users/me` rehydration on page reload
- **RBAC-aware UI** — Action buttons appear only when the role + status + current-approver match. Backend remains the source of truth for authorisation (e.g. Finance_Director-only generic transitions).
- **State machine** — Lifecycle timeline, allowed-transitions hint, and action availability all derive from server data, never duplicate the rules
- **Toasts** — Every mutation surfaces a success or extracted-API-error toast
- **Keyboard** — ⌘K / Ctrl-K focuses global search · ⌘N / Ctrl-N opens "New Invoice"
- **Responsive** — Sidebar collapses, search hides on small screens, tables scroll horizontally

---

## Project layout

```
src/
  main.tsx, App.tsx, index.css       # entry + routes + Tailwind base
  vite-env.d.ts                      # Vite import.meta.env typing
  types/                             # Invoice, Role, AuthUser types
  lib/
    api.ts                           # axios + interceptors + endpoint wrappers
    query-client.ts                  # QueryClient + queryKeys
    utils.ts                         # cn, formatCurrency, dates, initials
    constants.ts                     # STATUS_META, PIPELINE_ORDER, plants, suppliers
    storage.ts                       # typed localStorage wrapper
    invoice-registry.ts              # known-IDs registry (works around missing list endpoint)
  auth/
    AuthContext.tsx, useAuth.ts, ProtectedRoute.tsx
  components/
    ui/                              # shadcn-style primitives
    layout/Sidebar.tsx, Topbar.tsx, AppShell.tsx, nav-items.ts
    invoices/StatusBadge.tsx, CreateInvoiceModal.tsx, EmptyStateSeedHint.tsx
  hooks/
    useInvoices.ts                   # useInvoice, useInvoicesList, useAllowedTransitions
    useInvoiceMutations.ts           # submitReview, submitMatch, approve, reject, flagException, create
  seeds/
    seed-demo-invoices.ts            # Admin-triggered demo seeder
  pages/
    LoginPage.tsx, DashboardPage.tsx
    InvoiceProcessingPage.tsx, InvoiceDetailPage.tsx
    ComingSoonPage.tsx, NotFoundPage.tsx
```

---

## Scripts

```bash
npm run dev       # vite dev server (port 5173)
npm run build     # type-check + production build to ./dist
npm run preview   # serve ./dist locally
```

---

## Architectural notes

### Why a client-side invoice registry?

The backend deliberately exposes only `GET /invoices/:id`. There is no list endpoint in Phase 1 scope. Rather than mocking data on the frontend (which would defeat "no mocks"), this build maintains a small `localStorage`-backed registry of every invoice ID the frontend has ever observed — additions happen on:

1. Successful `POST /invoices` (manual create + seed)
2. Any direct `GET /invoices/:id` (deep-link)

List-style pages then fan-out parallel `GET /invoices/:id` requests via TanStack Query's `useQueries` and benefit from per-ID cache and refetch. Trade-off: a fresh browser profile sees an empty workspace until invoices are seeded — handled by the empty-state UX.

When the backend ships a `GET /invoices` endpoint, swap `useInvoicesList` to call it directly; nothing else has to change.

### Action availability

A button is shown if and only if:

1. The invoice's `status` allows the transition (mirrors backend state machine)
2. The user's role is permitted (mirrors backend `@Roles()` guards)
3. For approve/reject: `currentApproverId === user.id` (mirrors backend segregation of duties)

The backend remains the authority — any forbidden call still returns a clean toast via `extractApiError`.

---

## Roadmap (remaining "core" pages from the original brief)

- OCR Validation — review extracted fields, fix and approve OCR draft
- Approval Workflow — global queue across all approvers
- Exceptions — focused workbench for invoices in `EXCEPTION`
- Audit Logs — needs backend `GET /audit-logs` endpoint
- Admin Panel — needs backend `GET /users`, plus the demo seed button surfaced here

Deferred from scope: 2/3-Way Match, Document Viewer, Payment Packages, Vendor Portal, Repository Search, Analytics.
