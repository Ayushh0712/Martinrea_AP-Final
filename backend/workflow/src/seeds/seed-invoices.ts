/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { InvoiceStatus } from '../common/enums/invoice-status.enum';
import { sequelizeConfig } from './sequelize-config';

/**
 * taxAmount = totalAmount - subtotal + discount
 * purchaseOrderId is resolved at seed time by looking up the PO by poNumber.
 * If the PO does not exist yet (seed:purchase-orders not run), purchaseOrderId is set to null.
 */
const sampleInvoices = [
  {
    invoiceNumber: 'INV-2026-001',
    supplierName: 'Acme Steel Co.',
    supplierId: 'SUP-001',
    poNumber: 'PO-1001',
    subtotal: 5_000.0,
    discount: 100.0,
    taxAmount: 500.0,
    totalAmount: 5_400.0,
    currency: 'USD',
    dueDate: '2026-07-15',
    supplierTaxId: 'EIN-12-3456789',
    billToName: 'Martinrea Plant - Windsor',
    paymentTerm: 'Net 30',
    ingestionChannel: 'EMAIL',
    plantId: 'PLT-001',
    status: InvoiceStatus.PENDING_REVIEW,
    rejectionReason: null,
    createdAt: '2026-01-18T08:00:00.000Z',
  },
  {
    invoiceNumber: 'INV-2026-002',
    supplierName: 'Northbridge Castings',
    supplierId: 'SUP-002',
    poNumber: 'PO-1002',
    subtotal: 12_500.0,
    discount: 250.0,
    taxAmount: 500.5,
    totalAmount: 12_750.5,
    currency: 'USD',
    dueDate: '2026-07-20',
    supplierTaxId: 'EIN-98-7654321',
    billToName: 'Martinrea Plant - Windsor',
    paymentTerm: 'Net 45',
    ingestionChannel: 'SFTP',
    plantId: 'PLT-001',
    status: InvoiceStatus.PENDING_MATCH,
    rejectionReason: null,
    createdAt: '2026-01-22T09:00:00.000Z',
  },
  {
    invoiceNumber: 'INV-2026-003',
    supplierName: 'Industrias Saltillo S.A.',
    supplierId: 'SUP-MX-003',
    poNumber: 'PO-MX-1003',
    subtotal: 8_700.0,
    discount: 0.0,
    taxAmount: 200.0,
    totalAmount: 8_900.0,
    currency: 'MXN',
    dueDate: '2026-07-10',
    supplierTaxId: 'RFC-ISA-780301-XX1',
    billToName: 'Martinrea Saltillo S.A.',
    paymentTerm: 'Net 30',
    ingestionChannel: 'PORTAL',
    plantId: 'PLT-MX-001',
    status: InvoiceStatus.PENDING_MATCH,
    rejectionReason: null,
    createdAt: '2026-02-05T10:00:00.000Z',
  },
  {
    invoiceNumber: 'INV-2026-004',
    supplierName: 'Brightway Tooling Inc.',
    supplierId: 'SUP-004',
    poNumber: 'PO-1004',
    subtotal: 60_000.0,
    discount: 1_200.0,
    taxAmount: 3_500.0,
    totalAmount: 62_300.0,
    currency: 'USD',
    dueDate: '2026-08-01',
    supplierTaxId: 'EIN-55-1122334',
    billToName: 'Martinrea Plant - Hopkinsville',
    paymentTerm: 'Net 60',
    ingestionChannel: 'EMAIL',
    plantId: 'PLT-002',
    status: InvoiceStatus.PENDING_APPROVAL,
    rejectionReason: null,
    createdAt: '2026-02-14T08:30:00.000Z',
  },
  {
    invoiceNumber: 'INV-2026-005',
    supplierName: 'Delta Fabrications Ltd.',
    supplierId: 'SUP-005',
    poNumber: 'PO-1005',
    subtotal: 23_000.0,
    discount: 500.0,
    taxAmount: 1_000.0,
    totalAmount: 23_500.0,
    currency: 'USD',
    dueDate: '2026-07-25',
    supplierTaxId: 'EIN-33-9988776',
    billToName: 'Martinrea Plant - Shelbyville',
    paymentTerm: 'Net 30',
    ingestionChannel: 'EMAIL',
    plantId: 'PLT-003',
    status: InvoiceStatus.PENDING_REVIEW,
    rejectionReason: null,
    createdAt: '2026-06-10T07:00:00.000Z',
  },
  {
    invoiceNumber: 'INV-2026-006',
    supplierName: 'Pacific Metals Corp.',
    supplierId: 'SUP-006',
    poNumber: 'PO-1006',
    subtotal: 41_800.0,
    discount: 800.0,
    taxAmount: 1_600.0,
    totalAmount: 42_600.0,
    currency: 'USD',
    dueDate: '2026-08-10',
    supplierTaxId: 'EIN-77-4455667',
    billToName: 'Martinrea Plant - Hopkinsville',
    paymentTerm: 'Net 45',
    ingestionChannel: 'SFTP',
    plantId: 'PLT-002',
    status: InvoiceStatus.PENDING_MATCH,
    rejectionReason: null,
    createdAt: '2026-06-12T08:00:00.000Z',
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [User, AuditLog, Invoice, PurchaseOrder],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  // Build a poNumber → UUID map from existing purchase orders
  const allPos = await PurchaseOrder.findAll({ attributes: ['id', 'poNumber'] });
  const poIdMap = new Map<string, string>(allPos.map((po) => [po.poNumber, po.id]));
  if (poIdMap.size === 0) {
    console.warn('⚠  No purchase orders found — purchaseOrderId will be null. Run seed:purchase-orders first.\n');
  }

  console.log('Seeding sample invoices...\n');
  for (const inv of sampleInvoices) {
    const purchaseOrderId = poIdMap.get(inv.poNumber) ?? null;
    const data = { ...inv, purchaseOrderId };

    const [record, created] = await Invoice.upsert(data as Invoice);
    console.log(
      `${created ? '+' : '~'} ${created ? 'Created' : 'Updated'} ${record.invoiceNumber} ` +
        `(${record.status}) - $${record.totalAmount} ${record.currency} | ` +
        `tax: $${(data as { taxAmount: number }).taxAmount} | po_id: ${purchaseOrderId ?? 'null'}`,
    );
  }

  console.log('\nDone.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
