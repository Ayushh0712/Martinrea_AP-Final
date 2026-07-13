# Canonical Database Schema (PRD DAT-01 / DAT-04)

This folder holds the single, canonical PostgreSQL schema for the Martinrea AP
platform as Flyway migrations. All three services share one database and map
their ORMs onto these tables.

## Migrations
- `migrations/V1__canonical_schema.sql` - all Phase 1 tables (roles, users,
  suppliers, purchase_orders, goods_receipts, invoices, invoice_lines,
  approval_rules, audit_logs) with the standard `id / created_at / updated_at /
  deleted_at` columns and the DAT-01 required indexes.
- `migrations/V2__audit_logs_append_only.sql` - DB-level trigger enforcing the
  DAT-04 append-only guarantee on `audit_logs` (UPDATE/DELETE raise an
  exception).

The OCR pipeline keeps its tables in the Prisma-owned `ocr` schema. The matching
append-only guarantee on `ocr.audit_logs` ships as a Prisma migration
(`backend/workflow/prisma/migrations/20260617120000_ocr_audit_append_only`) so
it applies after Prisma creates that table.

## Running Flyway
The root `docker-compose.yml` includes a `flyway` service (the `local` profile)
that runs these migrations automatically on boot, after Postgres is healthy:
```bash
docker compose --profile local up --build
```
To run it manually instead:
```bash
flyway -url=jdbc:postgresql://$DB_HOST:$DB_PORT/$DB_NAME \
       -user=$DB_USER -password=$DB_PASSWORD \
       -locations=filesystem:./db/migrations migrate
```
Or via Docker:
```bash
docker run --rm -v "$(pwd)/db/migrations:/flyway/sql" flyway/flyway \
  -url=jdbc:postgresql://host.docker.internal:5432/martinrea_ap \
  -user=martinrea -password=*** migrate
```

## Service mapping (run ORMs in non-managing mode against this schema)
- workflow-service (Sequelize): set `NODE_ENV=production` so `synchronize` is
  off; the Prisma `ocr` models should be pointed at the `invoices` /
  `invoice_lines` / `audit_logs` tables (or kept in the `ocr` schema during
  migration and consolidated here).
- integrations (TypeORM): set `NODE_ENV=production` so `synchronize` is off; the
  entities already use snake_case column names matching this schema.

## Notes for existing databases
If a database already has the per-service tables created by ORM `synchronize`,
reconcile before adopting Flyway. In particular, the `users.role` /
`invoices.status` columns were created as Postgres ENUM types by some ORMs; this
canonical schema uses `varchar` for forward-compatibility, so an
`ALTER TABLE ... ALTER COLUMN ... TYPE varchar` (and `ALTER TYPE ... ADD VALUE`
for any retained enums, e.g. adding `VP_Finance`) may be required.
