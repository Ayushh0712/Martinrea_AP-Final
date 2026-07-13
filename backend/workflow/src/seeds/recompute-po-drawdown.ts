/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import {
  InvoicePoLineReservation,
  ReservationStatus,
} from '../invoices/entities/invoice-po-line-reservation.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchase-orders/entities/purchase-order-line.entity';
import {
  rollupLineStatus,
  rollupPoStatus,
} from '../purchase-orders/drawdown-rollup';
import { sequelizeConfig } from './sequelize-config';

/**
 * Rebuild the PO draw-down rollups from the invoice_po_line_reservations
 * ledger — the durable record of every draw an invoice made against a PO:
 *
 *   purchase_order_lines.reservedQuantity / consumedQuantity (+ status)
 *   purchase_orders.reservedAmount / consumedAmount (+ status)
 *
 * Aggregation rules (mirror PurchaseOrderAllocationService):
 *   RESERVED / PARTIAL -> still reserved
 *   CONSUMED           -> consumed
 *   RELEASED           -> contributes nothing
 *
 * Statuses are recomputed with the shared rollup rules (drawdown-rollup.ts);
 * terminal header states (CLOSED / CANCELLED) are preserved.
 *
 * Use cases:
 *   - Repair POs whose live rollups were clobbered (the PO JSON ingest used to
 *     overwrite them with the fixture's zeros on re-ingest).
 *   - Align the seeded demo data: seed:invoice-po-line-reservations writes the
 *     ledger only, so run this afterwards to roll it up into the PO columns
 *     (seed:all does this automatically).
 *
 * Idempotent: rows already consistent with the ledger are left untouched.
 */

/** Round to the purchase_order_lines quantity column scale, DECIMAL(14,3). */
const roundQty = (n: number) => Math.round(n * 1_000) / 1_000;
/** Round to the purchase_orders amount column scale, DECIMAL(16,2). */
const roundAmt = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [InvoicePoLineReservation, PurchaseOrder, PurchaseOrderLine],
  });
  await sequelize.authenticate();

  console.log('Recomputing PO draw-down from the reservation ledger...\n');

  const reservations = await InvoicePoLineReservation.findAll();

  const lineAgg = new Map<string, { reserved: number; consumed: number }>();
  const poAgg = new Map<string, { reserved: number; consumed: number }>();

  for (const r of reservations) {
    let bucket: 'reserved' | 'consumed';
    if (
      r.status === ReservationStatus.RESERVED ||
      r.status === ReservationStatus.PARTIAL
    ) {
      bucket = 'reserved';
    } else if (r.status === ReservationStatus.CONSUMED) {
      bucket = 'consumed';
    } else {
      continue; // RELEASED — the draw was reverted.
    }

    if (r.purchaseOrderLineId) {
      const cur = lineAgg.get(r.purchaseOrderLineId) ?? { reserved: 0, consumed: 0 };
      cur[bucket] += Number(r.reservedQuantity);
      lineAgg.set(r.purchaseOrderLineId, cur);
    }
    const cur = poAgg.get(r.purchaseOrderId) ?? { reserved: 0, consumed: 0 };
    cur[bucket] += Number(r.reservedAmount);
    poAgg.set(r.purchaseOrderId, cur);
  }

  // Every line/PO is visited, so rows with no surviving ledger entries are
  // reset to zero (e.g. after their reservations were deleted).
  const lines = await PurchaseOrderLine.findAll();
  let linesChanged = 0;
  for (const line of lines) {
    const raw = lineAgg.get(line.id) ?? { reserved: 0, consumed: 0 };
    const agg = { reserved: roundQty(raw.reserved), consumed: roundQty(raw.consumed) };
    const status = rollupLineStatus({
      orderQuantity: line.orderQuantity,
      reservedQuantity: agg.reserved,
      consumedQuantity: agg.consumed,
    });
    if (
      Number(line.reservedQuantity) === agg.reserved &&
      Number(line.consumedQuantity) === agg.consumed &&
      line.status === status
    ) {
      continue;
    }
    console.log(
      `  ~ Line ${line.itemCode ?? line.id} (#${line.lineNumber}): ` +
        `reserved ${Number(line.reservedQuantity)} -> ${agg.reserved}, ` +
        `consumed ${Number(line.consumedQuantity)} -> ${agg.consumed} [${status}]`,
    );
    await line.update({
      reservedQuantity: agg.reserved,
      consumedQuantity: agg.consumed,
      status,
    });
    linesChanged++;
  }

  const pos = await PurchaseOrder.findAll();
  let posChanged = 0;
  for (const po of pos) {
    const raw = poAgg.get(po.id) ?? { reserved: 0, consumed: 0 };
    const agg = { reserved: roundAmt(raw.reserved), consumed: roundAmt(raw.consumed) };
    const status = rollupPoStatus({
      status: po.status,
      totalAmount: po.totalAmount,
      orderTotal: po.orderTotal,
      reservedAmount: agg.reserved,
      consumedAmount: agg.consumed,
    });
    if (
      Number(po.reservedAmount) === agg.reserved &&
      Number(po.consumedAmount) === agg.consumed &&
      po.status === status
    ) {
      continue;
    }
    console.log(
      `  ~ ${po.poNumber}: reserved ${Number(po.reservedAmount)} -> ${agg.reserved}, ` +
        `consumed ${Number(po.consumedAmount)} -> ${agg.consumed} [${status}]`,
    );
    await po.update({
      reservedAmount: agg.reserved,
      consumedAmount: agg.consumed,
      status,
    });
    posChanged++;
  }

  console.log(
    `\nDone. ${posChanged} PO(s) and ${linesChanged} line(s) updated ` +
      `(${pos.length} POs / ${lines.length} lines checked, ` +
      `${reservations.length} ledger rows).`,
  );
  await sequelize.close();
}

main().catch((err) => {
  console.error('Recompute failed:', err);
  process.exit(1);
});
