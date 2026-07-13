/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchase-orders/entities/purchase-order-line.entity';
import { GoodsReceipt } from '../goods-receipts/entities/goods-receipt.entity';
import { OcrResult } from '../ocr-results/entities/ocr-result.entity';
import { MatchRecord } from '../match-records/entities/match-record.entity';
import { MatchDiscrepancy, DiscrepancySeverity, DiscrepancyType } from '../match-records/entities/match-discrepancy.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { sequelizeConfig } from './sequelize-config';

/**
 * invoiceLineNumber / poLineNumber are used at seed time to resolve
 * the actual UUID FKs (invoiceLineId / purchaseOrderLineId).
 * null means the discrepancy is at header level (not tied to a specific line).
 */
const sampleDiscrepancies: Array<{
  invoiceNumber: string;
  poNumber?: string;
  resolvedByEmail?: string;
  discrepancies: Array<{
    invoiceLineNumber: number | null;
    poLineNumber: number | null;
    fieldName: string;
    invoiceValue: string | null;
    poValue: string | null;
    grnValue: string | null;
    differenceAmount: number | null;
    differencePct: number | null;
    severity: DiscrepancySeverity;
    discrepancyType: DiscrepancyType;
    blocking: boolean;
    resolved: boolean;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    updatedAt: Date | null;
  }>;
}> = [
  {
    // INV-2026-002: partial GRN — knuckle LH backordered
    invoiceNumber: 'INV-2026-002',
    poNumber: 'PO-1002',
    resolvedByEmail: 'clerk@martinrea.dev',
    discrepancies: [
      {
        invoiceLineNumber: null,  // header-level amount discrepancy
        poLineNumber: null,
        fieldName: 'totalAmount',
        invoiceValue: '12750.50',
        poValue: '12750.50',
        grnValue: '7250.00',
        differenceAmount: 5500.5,
        differencePct: 43.14,
        severity: DiscrepancySeverity.HIGH,
        discrepancyType: DiscrepancyType.AMOUNT_MISMATCH,
        blocking: true,
        resolved: true,
        resolvedAt: new Date('2026-02-22T09:00:00Z'),
        resolutionNote: 'GRN partial — Knuckle LH backorder confirmed by supplier. Invoice put on hold pending full delivery.',
        updatedAt: new Date('2026-02-22T09:00:00Z'),
      },
      {
        invoiceLineNumber: 2,     // DI-KNKL-LH line
        poLineNumber: 2,
        fieldName: 'quantityReceived',
        invoiceValue: '130',
        poValue: '130',
        grnValue: '50',
        differenceAmount: 80,
        differencePct: 61.54,
        severity: DiscrepancySeverity.HIGH,
        discrepancyType: DiscrepancyType.QUANTITY_MISMATCH,
        blocking: true,
        resolved: true,
        resolvedAt: new Date('2026-02-22T09:00:00Z'),
        resolutionNote: 'Knuckle LH (80 units) backordered. New GRN expected 2026-03-10.',
        updatedAt: new Date('2026-02-22T09:00:00Z'),
      },
    ],
  },
  {
    // INV-2026-003: GRN physical count not confirmed
    invoiceNumber: 'INV-2026-003',
    poNumber: 'PO-MX-1003',
    resolvedByEmail: 'clerk@martinrea.dev',
    discrepancies: [
      {
        invoiceLineNumber: 1,     // bracket line — GRN count not confirmed
        poLineNumber: 1,
        fieldName: 'grnPhysicalCount',
        invoiceValue: '500',
        poValue: '500',
        grnValue: null,
        differenceAmount: null,
        differencePct: null,
        severity: DiscrepancySeverity.MEDIUM,
        discrepancyType: DiscrepancyType.QUANTITY_MISMATCH,
        blocking: false,
        resolved: false,
        resolvedAt: null,
        resolutionNote: null,
        updatedAt: null,
      },
    ],
  },
  {
    // INV-2026-005: invoice amount exceeds PO amount
    invoiceNumber: 'INV-2026-005',
    poNumber: 'PO-1005',
    discrepancies: [
      {
        invoiceLineNumber: null,  // header-level
        poLineNumber: null,
        fieldName: 'totalAmount',
        invoiceValue: '23500.00',
        poValue: '9800.00',
        grnValue: null,
        differenceAmount: 13700.0,
        differencePct: 139.8,
        severity: DiscrepancySeverity.CRITICAL,
        discrepancyType: DiscrepancyType.AMOUNT_MISMATCH,
        blocking: true,
        resolved: false,
        resolvedAt: null,
        resolutionNote: null,
        updatedAt: null,
      },
      {
        invoiceLineNumber: 1,     // bracket line — unit price higher than PO
        poLineNumber: 1,
        fieldName: 'unitPrice',
        invoiceValue: '115.00',
        poValue: '245.00',
        grnValue: null,
        differenceAmount: 130.0,
        differencePct: 53.06,
        severity: DiscrepancySeverity.HIGH,
        discrepancyType: DiscrepancyType.UNIT_PRICE_MISMATCH,
        blocking: true,
        resolved: false,
        resolvedAt: null,
        resolutionNote: null,
        updatedAt: null,
      },
    ],
  },
  {
    // INV-2026-006: tax amount discrepancy (advisory only)
    invoiceNumber: 'INV-2026-006',
    poNumber: 'PO-1006',
    discrepancies: [
      {
        invoiceLineNumber: null,  // header-level tax
        poLineNumber: null,
        fieldName: 'taxAmount',
        invoiceValue: '3408.00',
        poValue: '256.00',
        grnValue: null,
        differenceAmount: 3152.0,
        differencePct: 1231.25,
        severity: DiscrepancySeverity.MEDIUM,
        discrepancyType: DiscrepancyType.TAX_MISMATCH,
        blocking: false,
        resolved: true,
        resolvedAt: new Date('2026-06-14T11:00:00Z'),
        resolutionNote: 'PO did not include tax line. Invoice tax validated against supplier tax registration. Approved by Finance Manager.',
        updatedAt: new Date('2026-06-14T11:00:00Z'),
      },
    ],
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [
      User, AuditLog, Invoice, InvoiceLineItem,
      PurchaseOrder, PurchaseOrderLine,
      GoodsReceipt, OcrResult, MatchRecord, MatchDiscrepancy,
    ],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log('Seeding match discrepancies...\n');

  for (const entry of sampleDiscrepancies) {
    const invoice = await Invoice.findOne({ where: { invoiceNumber: entry.invoiceNumber } });
    if (!invoice) { console.log(`! Invoice ${entry.invoiceNumber} not found — skipping`); continue; }

    const matchRecord = await MatchRecord.findOne({ where: { invoiceId: invoice.id } });
    if (!matchRecord) { console.log(`! Match record for ${entry.invoiceNumber} not found — skipping`); continue; }

    // Resolve PO uuid for line lookups
    const po = entry.poNumber
      ? await PurchaseOrder.findOne({ where: { poNumber: entry.poNumber } })
      : null;

    let resolverId: string | null = null;
    if (entry.resolvedByEmail) {
      const resolver = await User.findOne({ where: { email: entry.resolvedByEmail } });
      resolverId = resolver?.id ?? null;
    }

    for (const disc of entry.discrepancies) {
      // Resolve invoice line UUID from lineNumber
      const invoiceLineId = disc.invoiceLineNumber != null
        ? (await InvoiceLineItem.findOne({
            where: { invoiceId: invoice.id, lineNumber: disc.invoiceLineNumber },
          }))?.id ?? null
        : null;

      // Resolve PO line UUID from lineNumber
      const purchaseOrderLineId = (disc.poLineNumber != null && po)
        ? (await PurchaseOrderLine.findOne({
            where: { purchaseOrderId: po.id, lineNumber: disc.poLineNumber },
          }))?.id ?? null
        : null;

      const { invoiceLineNumber: _iln, poLineNumber: _pln, ...discData } = disc;

      const existing = await MatchDiscrepancy.findOne({
        where: { matchRecordId: matchRecord.id, fieldName: disc.fieldName },
      });

      if (existing) {
        await existing.update({ ...discData, invoiceLineId, purchaseOrderLineId, resolvedBy: resolverId });
        console.log(`~ Updated [${entry.invoiceNumber}] field="${disc.fieldName}" blocking=${disc.blocking} severity=${disc.severity}`);
      } else {
        await MatchDiscrepancy.create({
          matchRecordId: matchRecord.id,
          invoiceLineId,
          purchaseOrderLineId,
          resolvedBy: resolverId,
          ...discData,
        } as MatchDiscrepancy);
        console.log(`+ Created [${entry.invoiceNumber}] field="${disc.fieldName}" blocking=${disc.blocking} severity=${disc.severity} resolved=${disc.resolved}`);
      }
    }
  }

  console.log('\nDone.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
