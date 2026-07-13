/* eslint-disable no-console */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Sequelize } from 'sequelize-typescript';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchase-orders/entities/purchase-order-line.entity';
import {
  normalizePoJson,
  upsertPurchaseOrdersFromJson,
} from '../purchase-orders/po-upsert';
import { sequelizeConfig } from './sequelize-config';

/**
 * One-shot loader for a fresh set of purchase orders: reads
 * `src/seeds/data/all_purchase_orders.json` and upserts BOTH the PO headers
 * (`purchase_orders`) and their nested `lines[]` (`purchase_order_lines`) in a
 * single pass. Equivalent to running seed:purchase-orders + seed:purchase-order-lines,
 * kept as one command for the "start fresh" flow. The JSON is the single source
 * of truth; each line's purchaseOrderId is resolved from the created/updated PO.
 *
 * The actual upsert lives in ../purchase-orders/po-upsert.ts, shared with the
 * OCI PO-JSON auto-ingest poller so bucket uploads and seeds behave the same.
 */
const rows = normalizePoJson(
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, 'data', 'all_purchase_orders.json'),
      'utf8',
    ),
  ),
);

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [PurchaseOrder, PurchaseOrderLine],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log(`Loading ${rows.length} purchase orders from JSON...\n`);
  const stats = await upsertPurchaseOrdersFromJson(rows, console.log);

  console.log(
    `\nDone. POs: +${stats.poCreated}/~${stats.poUpdated}, lines: +${stats.lineCreated}/~${stats.lineUpdated}.`,
  );
  await sequelize.close();
}

main().catch((err) => {
  console.error('Load failed:', err);
  process.exit(1);
});
