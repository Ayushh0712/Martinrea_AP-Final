/* eslint-disable no-console */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Sequelize } from 'sequelize-typescript';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import {
  PurchaseOrderLine,
  PurchaseOrderLineStatus,
} from '../purchase-orders/entities/purchase-order-line.entity';
import { sequelizeConfig } from './sequelize-config';

/**
 * Seed data for purchase_order_lines.
 * Lines are sourced from the same combined fixture used by seed-purchase-orders
 * (src/seeds/data/all_purchase_orders.json), keyed by poNumber.
 *
 * Strategy:
 *   - Look up the parent PO by poNumber to resolve its UUID.
 *   - Upsert lines by (purchaseOrderId, lineNumber).
 */
interface PoLine {
  lineNumber: number;
  itemCode: string | null;
  description: string;
  orderQuantity: number;
  reservedQuantity: number;
  consumedQuantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  lineTotal: number;
  status: PurchaseOrderLineStatus;
}

type PoJson = {
  poNumber: string;
  lines?: Array<Omit<PoLine, 'status'> & { status: string }>;
};

const rows = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'data', 'all_purchase_orders.json'),
    'utf8',
  ),
) as PoJson[];

const linesByPoNumber: Record<string, PoLine[]> = Object.fromEntries(
  rows.map((po) => [
    po.poNumber,
    (po.lines ?? []).map((line) => ({
      ...line,
      status: line.status as PurchaseOrderLineStatus,
    })),
  ]),
);

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [PurchaseOrder, PurchaseOrderLine],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log('Seeding purchase order lines...\n');
  let created = 0;
  let updated = 0;

  for (const [poNumber, lines] of Object.entries(linesByPoNumber)) {
    const po = await PurchaseOrder.findOne({ where: { poNumber } });
    if (!po) {
      console.warn(`  ⚠ PO not found: ${poNumber} — skipping its lines (run seed:purchase-orders first)`);
      continue;
    }

    for (const line of lines) {
      const existing = await PurchaseOrderLine.findOne({
        where: { purchaseOrderId: po.id, lineNumber: line.lineNumber },
      });

      if (existing) {
        await existing.update({ ...line, purchaseOrderId: po.id });
        console.log(`  ~ Updated ${poNumber} / Line ${line.lineNumber} — ${line.itemCode}`);
        updated++;
      } else {
        await PurchaseOrderLine.create({ ...line, purchaseOrderId: po.id } as PurchaseOrderLine);
        console.log(`  + Created ${poNumber} / Line ${line.lineNumber} — ${line.itemCode}`);
        created++;
      }
    }
  }

  console.log(`\nDone. Created ${created}, updated ${updated}.`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
