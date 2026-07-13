# Integrations - Production Cutover Runbook (INT-01/02, ING-02)

The orchestration for both integrations is already built. What remains is
swapping mock/dev data sources for real connectivity, which is blocked only on
Martinrea VPN access + credentials. This runbook lists exactly what to plug in.

## Epicor sync (INT-01 / INT-02) - what's already done
- Nightly cron at 02:00 (`@Cron('0 2 * * *')` in `epicor-sync.service.ts`).
- 44-instance fan-out with `p-limit` concurrency (`MAX_CONCURRENT_EPICOR_CONNECTIONS`).
- Incremental watermarks per (instance, jobType) via `sync_run_logs`.
- Per-instance `instanceId` attribution and one log row per sub-job.
- Failure isolation (`Promise.allSettled`) + Slack/Datadog alerts.
- Live Goods-Receipts API (INT-03) with US/MX normalization.

## Epicor sync - what to do for production
1. Provide connectivity per instance (ODBC/JDBC or SFTP CSV/XML export, per the
   instance's capability) - see `config/epicor-instances.config.ts`.
2. Implement a real data source to replace the mock. Today
   `SuppliersSyncService` / `PurchaseOrdersSyncService` / `GoodsReceiptsService`
   read from `MockEpicorService`. Introduce an `EpicorClient` (one method per
   pull: `fetchSuppliers(instance, since)`, `fetchOpenPos(instance, since)`,
   `fetchGoodsReceipts(po, instance)`) and bind it via a DI token gated by
   `EPICOR_MODE=mock|real`. The normalization layer (US vs MX field mapping)
   already exists and stays unchanged.
3. Switch `NODE_ENV=production` so `MockEpicorModule` is NOT loaded (see
   `app.module.ts`) and the DI container fails loud until the real client is
   bound - the intended defensive behavior.
4. Per-timezone scheduling (optional, Sprint 2): the cron currently fires all
   instances at 02:00 UTC; swap for per-plant local 02:00 (dynamic cron or
   BullMQ delayed jobs).

### Credentials required (Epicor)
- [ ] Per-instance connection (host/DSN or SFTP host + key) for all 44 sites.
- [ ] Read access to Supplier master, Open POs, and Goods Receipts.
- [ ] VPN / network egress from the app subnet to each Epicor instance.

## Email ingestion (ING-02) - MS Graph
- The Graph adapter (`adapters/prod/graph-mail.client.ts`) is wired; enable it
  with `MAIL_TRANSPORT=graph`.
- Folder moves (AP-Processed / AP-No-Attachment) + retry-x3 + mark-read are in
  the adapter; verify against the real mailbox once creds land.

### Credentials required (Graph)
- [ ] Azure AD tenant id, app registration (Application perms `Mail.ReadWrite`),
      client id + secret.
- [ ] AP mailbox addresses to poll; pre-created sub-folders or create rights.
- [ ] Network egress to `graph.microsoft.com:443`.
