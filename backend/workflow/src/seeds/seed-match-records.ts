/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { MatchRecord, MatchType, MatchStatus } from '../match-records/entities/match-record.entity';
import { OcrResult } from '../ocr-results/entities/ocr-result.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { sequelizeConfig } from './sequelize-config';

const sampleMatches: Array<{
  invoiceNumber: string;
  poNumber: string;
  matchedByEmail?: string;
  data: {
    matchType: MatchType;
    matchStatus: MatchStatus;
    amountMatch: boolean;
    quantityMatch: boolean | null;
    vendorMatch: boolean;
    poNumberMatch: boolean;
    supplierMatch: boolean;
    currencyMatch: boolean;
    priceMatch: boolean | null;
    poAvailableAmount: number | null;
    invoiceAmount: number;
    poAmount: number;
    tolerancePct: number;
    discrepancyCount: number;
    matchedBy: string;
    matchedAt: Date;
    updatedAt: Date | null;
    exceptionReason: string | null;
  };
}> = [
  {
    invoiceNumber: 'INV-2026-001',
    poNumber: 'PO-1001',
    matchedByEmail: 'clerk@martinrea.dev',
    data: {
      matchType: MatchType.THREE_WAY,
      matchStatus: MatchStatus.MATCHED,
      amountMatch: true,
      quantityMatch: true,
      vendorMatch: true,
      poNumberMatch: true,
      supplierMatch: true,
      currencyMatch: true,
      priceMatch: true,
      poAvailableAmount: 0.0,      // fully consumed
      invoiceAmount: 5400.0,
      poAmount: 5400.0,
      tolerancePct: 2.0,
      discrepancyCount: 0,
      matchedBy: 'AUTO',
      matchedAt: new Date('2026-02-09T08:45:00Z'),
      updatedAt: new Date('2026-02-09T08:45:00Z'),
      exceptionReason: null,
    },
  },
  {
    invoiceNumber: 'INV-2026-002',
    poNumber: 'PO-1002',
    matchedByEmail: 'clerk@martinrea.dev',
    data: {
      matchType: MatchType.THREE_WAY,
      matchStatus: MatchStatus.PARTIAL_MATCH,
      amountMatch: false,
      quantityMatch: false,
      vendorMatch: true,
      poNumberMatch: true,
      supplierMatch: true,
      currencyMatch: true,
      priceMatch: true,
      poAvailableAmount: 6375.25,  // partial — remainder still open
      invoiceAmount: 12750.5,
      poAmount: 12750.5,
      tolerancePct: 2.0,
      discrepancyCount: 2,
      matchedBy: 'AUTO',
      matchedAt: new Date('2026-02-21T10:00:00Z'),
      updatedAt: new Date('2026-02-22T09:00:00Z'),
      exceptionReason: 'GRN quantity short — Knuckle LH backordered (80 units pending)',
    },
  },
  {
    invoiceNumber: 'INV-2026-003',
    poNumber: 'PO-MX-1003',
    data: {
      matchType: MatchType.THREE_WAY,
      matchStatus: MatchStatus.EXCEPTION,
      amountMatch: true,
      quantityMatch: null,
      vendorMatch: true,
      poNumberMatch: true,
      supplierMatch: true,
      currencyMatch: true,
      priceMatch: null,
      poAvailableAmount: 8900.0,   // fully reserved, not consumed
      invoiceAmount: 8900.0,
      poAmount: 8900.0,
      tolerancePct: 2.0,
      discrepancyCount: 1,
      matchedBy: 'AUTO',
      matchedAt: new Date('2026-03-13T11:30:00Z'),
      updatedAt: new Date('2026-03-13T11:30:00Z'),
      exceptionReason: 'GRN physical count pending',
    },
  },
  {
    invoiceNumber: 'INV-2026-004',
    poNumber: 'PO-1004',
    data: {
      matchType: MatchType.TWO_WAY,
      matchStatus: MatchStatus.MATCHED,
      amountMatch: true,
      quantityMatch: null,
      vendorMatch: true,
      poNumberMatch: true,
      supplierMatch: true,
      currencyMatch: true,
      priceMatch: true,
      poAvailableAmount: 62300.0,  // service PO — reserved, GRN not yet raised
      invoiceAmount: 62300.0,
      poAmount: 62300.0,
      tolerancePct: 2.0,
      discrepancyCount: 0,
      matchedBy: 'AUTO',
      matchedAt: new Date('2026-02-15T09:00:00Z'),
      updatedAt: new Date('2026-02-15T09:00:00Z'),
      exceptionReason: null,
    },
  },
  {
    invoiceNumber: 'INV-2026-005',
    poNumber: 'PO-1005',
    data: {
      matchType: MatchType.TWO_WAY,
      matchStatus: MatchStatus.PENDING,
      amountMatch: false,
      quantityMatch: null,
      vendorMatch: true,
      poNumberMatch: true,
      supplierMatch: true,
      currencyMatch: true,
      priceMatch: false,
      poAvailableAmount: 9800.0,   // PO fully reserved, invoice exceeds it
      invoiceAmount: 23500.0,
      poAmount: 9800.0,
      tolerancePct: 2.0,
      discrepancyCount: 1,
      matchedBy: 'AUTO',
      matchedAt: new Date('2026-06-11T07:30:00Z'),
      updatedAt: new Date('2026-06-11T07:30:00Z'),
      exceptionReason: 'Invoice amount ($23,500) exceeds PO amount ($9,800) — possible PO amendment required',
    },
  },
  {
    invoiceNumber: 'INV-2026-006',
    poNumber: 'PO-1006',
    data: {
      matchType: MatchType.THREE_WAY,
      matchStatus: MatchStatus.MATCHED,
      amountMatch: true,
      quantityMatch: true,
      vendorMatch: true,
      poNumberMatch: true,
      supplierMatch: true,
      currencyMatch: true,
      priceMatch: true,
      poAvailableAmount: 0.0,      // fully consumed
      invoiceAmount: 42600.0,
      poAmount: 3200.0,
      tolerancePct: 2.0,
      discrepancyCount: 0,
      matchedBy: 'MANUAL',
      matchedAt: new Date('2026-06-13T14:00:00Z'),
      updatedAt: new Date('2026-06-13T14:00:00Z'),
      exceptionReason: null,
    },
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [User, AuditLog, Invoice, InvoiceLineItem, PurchaseOrder, OcrResult, MatchRecord],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log('Seeding match records...\n');

  for (const entry of sampleMatches) {
    const invoice = await Invoice.findOne({ where: { invoiceNumber: entry.invoiceNumber } });
    if (!invoice) { console.log(`! Invoice ${entry.invoiceNumber} not found — skipping`); continue; }

    const po = await PurchaseOrder.findOne({ where: { poNumber: entry.poNumber } });
    if (!po) { console.log(`! PO ${entry.poNumber} not found — skipping`); continue; }

    let userId: string | null = null;
    if (entry.matchedByEmail) {
      const user = await User.findOne({ where: { email: entry.matchedByEmail } });
      userId = user?.id ?? null;
    }

    const existing = await MatchRecord.findOne({ where: { invoiceId: invoice.id } });
    if (existing) {
      await existing.update({
        poId: po.id,
        matchedByUser: userId,
        ...entry.data,
      });
      console.log(`~ Updated match for ${entry.invoiceNumber} [${entry.data.matchStatus}]`);
    } else {
      await MatchRecord.create({
        invoiceId: invoice.id,
        poId: po.id,
        matchedByUser: userId,
        ...entry.data,
      } as MatchRecord);
      console.log(
        `+ Created ${entry.data.matchType} match for ${entry.invoiceNumber} [${entry.data.matchStatus}] — ${entry.data.discrepancyCount} discrepancies`,
      );
    }
  }

  console.log('\nDone.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
