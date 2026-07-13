/* eslint-disable no-console */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Sequelize } from 'sequelize-typescript';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
} from '../purchase-orders/entities/purchase-order.entity';
import { sequelizeConfig } from './sequelize-config';

interface PoHeader {
  poNumber: string;
  supplierCode: string;
  supplierId: string;
  supplierName: string;
  plantId: string;
  currency: string;
  totalAmount: number;
  orderTotal: number;
  reservedAmount: number;
  consumedAmount: number;
  status: PurchaseOrderStatus;
  issuedDate: string;
  expectedDeliveryDate: string;
  instanceId: string;
  notes: string;
}

type PoJson = Omit<PoHeader, 'status'> & { status: string; lines?: unknown[] };

const rows = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'data', 'all_purchase_orders.json'),
    'utf8',
  ),
) as PoJson[];

const samplePurchaseOrders: PoHeader[] = rows.map((po) => {
  const header = { ...po, status: po.status as PurchaseOrderStatus };
  delete header.lines;
  return header;
});

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [PurchaseOrder],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log('Seeding purchase orders...\n');
  for (const po of samplePurchaseOrders) {
    const existing = await PurchaseOrder.findOne({
      where: { poNumber: po.poNumber },
    });
    if (existing) {
      await existing.update(po);
      console.log(`~ Updated ${po.poNumber} [${po.status}] - $${po.totalAmount} ${po.currency}`);
      continue;
    }
    const created = await PurchaseOrder.create(po as PurchaseOrder);
    console.log(
      `+ Created ${created.poNumber} [${created.status}] - $${created.totalAmount} ${created.currency} - ${created.supplierName}`,
    );
  }

  console.log('\nDone.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
