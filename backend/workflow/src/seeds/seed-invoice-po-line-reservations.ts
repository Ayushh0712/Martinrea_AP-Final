/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import {
  InvoicePoLineReservation,
  ReservationStatus,
} from '../invoices/entities/invoice-po-line-reservation.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchase-orders/entities/purchase-order-line.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { sequelizeConfig } from './sequelize-config';

/**
 * Seed data for invoice_po_line_reservations.
 *
 * Each entry links an invoice line to a PO line, showing how much
 * quantity/amount was reserved and what happened to it.
 *
 * Resolved at seed time:
 *   - invoiceId          from invoiceNumber
 *   - invoiceLineId      from invoiceNumber + invoiceLineNumber
 *   - purchaseOrderId    from poNumber
 *   - purchaseOrderLineId from poNumber + poLineNumber
 */
const sampleReservations: Array<{
  invoiceNumber: string;
  invoiceLineNumber: number | null;
  poNumber: string;
  poLineNumber: number | null;
  reservedQuantity: number;
  reservedAmount: number;
  status: ReservationStatus;
  reservedAt: Date;
  consumedAt: Date | null;
  releasedAt: Date | null;
}> = [
  // ── INV-2026-001 : Acme Steel (APPROVED — fully consumed) ────────────────
  {
    invoiceNumber: 'INV-2026-001',
    invoiceLineNumber: 1,
    poNumber: 'PO-1001',
    poLineNumber: 1,
    reservedQuantity: 15,
    reservedAmount: 4_050.0,
    status: ReservationStatus.CONSUMED,
    reservedAt: new Date('2026-02-08T07:00:00Z'),
    consumedAt: new Date('2026-02-09T08:45:00Z'),
    releasedAt: null,
  },
  {
    invoiceNumber: 'INV-2026-001',
    invoiceLineNumber: 2,
    poNumber: 'PO-1001',
    poLineNumber: 2,
    reservedQuantity: 1,
    reservedAmount: 1_350.0,
    status: ReservationStatus.CONSUMED,
    reservedAt: new Date('2026-02-08T07:00:00Z'),
    consumedAt: new Date('2026-02-09T08:45:00Z'),
    releasedAt: null,
  },

  // ── INV-2026-002 : Northbridge Castings (PARTIAL — GRN short) ───────────
  {
    invoiceNumber: 'INV-2026-002',
    invoiceLineNumber: 1,
    poNumber: 'PO-1002',
    poLineNumber: 1,
    reservedQuantity: 50,
    reservedAmount: 7_250.0,
    status: ReservationStatus.PARTIAL,
    reservedAt: new Date('2026-02-20T09:00:00Z'),
    consumedAt: null,
    releasedAt: null,
  },
  {
    invoiceNumber: 'INV-2026-002',
    invoiceLineNumber: 2,
    poNumber: 'PO-1002',
    poLineNumber: 2,
    reservedQuantity: 80,
    reservedAmount: 5_500.5,
    status: ReservationStatus.PARTIAL,
    reservedAt: new Date('2026-02-20T09:00:00Z'),
    consumedAt: null,
    releasedAt: null,
  },

  // ── INV-2026-003 : Industrias Saltillo (RESERVED — exception) ────────────
  {
    invoiceNumber: 'INV-2026-003',
    invoiceLineNumber: 1,
    poNumber: 'PO-MX-1003',
    poLineNumber: 1,
    reservedQuantity: 250,
    reservedAmount: 4_450.0,
    status: ReservationStatus.RESERVED,
    reservedAt: new Date('2026-03-12T10:00:00Z'),
    consumedAt: null,
    releasedAt: null,
  },
  {
    invoiceNumber: 'INV-2026-003',
    invoiceLineNumber: 1,
    poNumber: 'PO-MX-1003',
    poLineNumber: 2,
    reservedQuantity: 250,
    reservedAmount: 4_450.0,
    status: ReservationStatus.RESERVED,
    reservedAt: new Date('2026-03-12T10:00:00Z'),
    consumedAt: null,
    releasedAt: null,
  },

  // ── INV-2026-004 : Brightway Tooling (CONSUMED — 2-way match approved) ───
  {
    invoiceNumber: 'INV-2026-004',
    invoiceLineNumber: 1,
    poNumber: 'PO-1004',
    poLineNumber: 1,
    reservedQuantity: 1,
    reservedAmount: 48_000.0,
    status: ReservationStatus.CONSUMED,
    reservedAt: new Date('2026-02-14T08:00:00Z'),
    consumedAt: new Date('2026-02-15T09:00:00Z'),
    releasedAt: null,
  },
  {
    invoiceNumber: 'INV-2026-004',
    invoiceLineNumber: 2,
    poNumber: 'PO-1004',
    poLineNumber: 2,
    reservedQuantity: 1,
    reservedAmount: 9_800.0,
    status: ReservationStatus.CONSUMED,
    reservedAt: new Date('2026-02-14T08:00:00Z'),
    consumedAt: new Date('2026-02-15T09:00:00Z'),
    releasedAt: null,
  },
  {
    invoiceNumber: 'INV-2026-004',
    invoiceLineNumber: 2,
    poNumber: 'PO-1004',
    poLineNumber: 3,
    reservedQuantity: 1,
    reservedAmount: 4_500.0,
    status: ReservationStatus.CONSUMED,
    reservedAt: new Date('2026-02-14T08:00:00Z'),
    consumedAt: new Date('2026-02-15T09:00:00Z'),
    releasedAt: null,
  },

  // ── INV-2026-005 : Delta Fabrications (RELEASED — amount mismatch) ───────
  {
    invoiceNumber: 'INV-2026-005',
    invoiceLineNumber: 1,
    poNumber: 'PO-1005',
    poLineNumber: 1,
    reservedQuantity: 200,
    reservedAmount: 23_000.0,
    status: ReservationStatus.RELEASED,
    reservedAt: new Date('2026-06-10T07:00:00Z'),
    consumedAt: null,
    releasedAt: new Date('2026-06-11T10:00:00Z'),
  },
  {
    invoiceNumber: 'INV-2026-005',
    invoiceLineNumber: 2,
    poNumber: 'PO-1005',
    poLineNumber: 2,
    reservedQuantity: 1,
    reservedAmount: 500.0,
    status: ReservationStatus.RELEASED,
    reservedAt: new Date('2026-06-10T07:00:00Z'),
    consumedAt: null,
    releasedAt: new Date('2026-06-11T10:00:00Z'),
  },

  // ── INV-2026-006 : Pacific Metals (CONSUMED — manually matched) ──────────
  {
    invoiceNumber: 'INV-2026-006',
    invoiceLineNumber: 1,
    poNumber: 'PO-1006',
    poLineNumber: 1,
    reservedQuantity: 80,
    reservedAmount: 2_000.0,
    status: ReservationStatus.CONSUMED,
    reservedAt: new Date('2026-06-12T09:00:00Z'),
    consumedAt: new Date('2026-06-13T14:00:00Z'),
    releasedAt: null,
  },
  {
    invoiceNumber: 'INV-2026-006',
    invoiceLineNumber: 2,
    poNumber: 'PO-1006',
    poLineNumber: 2,
    reservedQuantity: 48,
    reservedAmount: 1_200.0,
    status: ReservationStatus.CONSUMED,
    reservedAt: new Date('2026-06-12T09:00:00Z'),
    consumedAt: new Date('2026-06-13T14:00:00Z'),
    releasedAt: null,
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [
      User, AuditLog,
      Invoice, InvoiceLineItem, InvoicePoLineReservation,
      PurchaseOrder, PurchaseOrderLine,
    ],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log('Seeding invoice PO line reservations...\n');
  let created = 0;
  let updated = 0;

  for (const entry of sampleReservations) {
    // Resolve invoice UUID
    const invoice = await Invoice.findOne({ where: { invoiceNumber: entry.invoiceNumber } });
    if (!invoice) {
      console.warn(`  ⚠ Invoice not found: ${entry.invoiceNumber} — skipping`);
      continue;
    }

    // Resolve invoice line UUID
    const invoiceLineId = entry.invoiceLineNumber != null
      ? (await InvoiceLineItem.findOne({
          where: { invoiceId: invoice.id, lineNumber: entry.invoiceLineNumber },
        }))?.id ?? null
      : null;

    // Resolve PO UUID
    const po = await PurchaseOrder.findOne({ where: { poNumber: entry.poNumber } });
    if (!po) {
      console.warn(`  ⚠ PO not found: ${entry.poNumber} — skipping`);
      continue;
    }

    // Resolve PO line UUID
    const purchaseOrderLineId = entry.poLineNumber != null
      ? (await PurchaseOrderLine.findOne({
          where: { purchaseOrderId: po.id, lineNumber: entry.poLineNumber },
        }))?.id ?? null
      : null;

    const payload = {
      invoiceId: invoice.id,
      invoiceLineId,
      purchaseOrderId: po.id,
      purchaseOrderLineId,
      reservedQuantity: entry.reservedQuantity,
      reservedAmount: entry.reservedAmount,
      status: entry.status,
      reservedAt: entry.reservedAt,
      consumedAt: entry.consumedAt,
      releasedAt: entry.releasedAt,
    };

    // Upsert by (invoiceId, invoiceLineId, purchaseOrderLineId)
    const existing = await InvoicePoLineReservation.findOne({
      where: {
        invoiceId: invoice.id,
        purchaseOrderId: po.id,
        ...(purchaseOrderLineId ? { purchaseOrderLineId } : {}),
      },
    });

    if (existing) {
      await existing.update(payload);
      console.log(
        `  ~ Updated  ${entry.invoiceNumber} / ${entry.poNumber} L${entry.poLineNumber ?? '-'} ` +
        `[${entry.status}] qty=${entry.reservedQuantity} amt=$${entry.reservedAmount}`,
      );
      updated++;
    } else {
      await InvoicePoLineReservation.create(payload as InvoicePoLineReservation);
      console.log(
        `  + Created  ${entry.invoiceNumber} / ${entry.poNumber} L${entry.poLineNumber ?? '-'} ` +
        `[${entry.status}] qty=${entry.reservedQuantity} amt=$${entry.reservedAmount}`,
      );
      created++;
    }
  }

  console.log(`\nDone. Created ${created}, updated ${updated}.`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
