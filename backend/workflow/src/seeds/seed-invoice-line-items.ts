/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { sequelizeConfig } from './sequelize-config';

const sampleLineItems: Array<{
  invoiceNumber: string;
  lines: Array<{
    lineNumber: number;
    itemCode: string | null;
    description: string;
    skuOrPartNumber: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
    lineTotal: number;
  }>;
}> = [
  {
    invoiceNumber: 'INV-2026-001',
    lines: [
      {
        lineNumber: 1,
        itemCode: 'STL-HR-0.25x48',
        description: 'Hot-rolled steel coil 0.25" x 48" wide',
        skuOrPartNumber: 'STL-HR-0.25x48 / SKU-10011',
        quantity: 15,
        unitOfMeasure: 'MT',
        unitPrice: 270.0,
        lineTotal: 4_050.0,
      },
      {
        lineNumber: 2,
        itemCode: 'SVC-FREIGHT-01',
        description: 'Steel handling & freight surcharge',
        skuOrPartNumber: 'SVC-FREIGHT-01 / SKU-10012',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 1_350.0,
        lineTotal: 1_350.0,
      },
    ],
  },
  {
    invoiceNumber: 'INV-2026-002',
    lines: [
      {
        lineNumber: 1,
        itemCode: 'DI-DIFFHSG-A',
        description: 'Ductile iron casting A380 grade - Diff housing',
        skuOrPartNumber: 'DI-DIFFHSG-A / SKU-20021',
        quantity: 50,
        unitOfMeasure: 'EA',
        unitPrice: 145.0,
        lineTotal: 7_250.0,
      },
      {
        lineNumber: 2,
        itemCode: 'DI-KNKL-LH',
        description: 'Ductile iron casting - Knuckle LH',
        skuOrPartNumber: 'DI-KNKL-LH / SKU-20022',
        quantity: 80,
        unitOfMeasure: 'EA',
        unitPrice: 68.756,
        lineTotal: 5_500.5,
      },
    ],
  },
  {
    invoiceNumber: 'INV-2026-003',
    lines: [
      {
        lineNumber: 1,
        itemCode: 'BRKT-STMP-MX-44',
        description: 'Stamped steel bracket MX-44 series',
        skuOrPartNumber: 'BRKT-STMP-MX-44 / SKU-MX-30031',
        quantity: 500,
        unitOfMeasure: 'EA',
        unitPrice: 17.8,
        lineTotal: 8_900.0,
      },
    ],
  },
  {
    invoiceNumber: 'INV-2026-004',
    lines: [
      {
        lineNumber: 1,
        itemCode: 'DIE-PROG-PLT2-A',
        description: 'Progressive die tooling set - PLT-002 press line upgrade',
        skuOrPartNumber: 'DIE-PROG-PLT2-A / SKU-40041',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 55_000.0,
        lineTotal: 55_000.0,
      },
      {
        lineNumber: 2,
        itemCode: 'SVC-INSTALL-01',
        description: 'Tooling installation & commissioning service',
        skuOrPartNumber: 'SVC-INSTALL-01 / SKU-40042',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 7_300.0,
        lineTotal: 7_300.0,
      },
    ],
  },
  {
    invoiceNumber: 'INV-2026-005',
    lines: [
      {
        lineNumber: 1,
        itemCode: 'BRKT-PRES-D12',
        description: 'Precision stamped bracket assembly',
        skuOrPartNumber: 'BRKT-PRES-D12 / SKU-50051',
        quantity: 200,
        unitOfMeasure: 'EA',
        unitPrice: 115.0,
        lineTotal: 23_000.0,
      },
      {
        lineNumber: 2,
        itemCode: 'SVC-QC-DOC',
        description: 'Quality certification documentation',
        skuOrPartNumber: 'SVC-QC-DOC / SKU-50052',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 500.0,
        lineTotal: 500.0,
      },
    ],
  },
  {
    invoiceNumber: 'INV-2026-006',
    lines: [
      {
        lineNumber: 1,
        itemCode: 'STL-CR-1.2MM',
        description: 'Cold-rolled steel sheet 1.2mm gauge',
        skuOrPartNumber: 'STL-CR-1.2MM / SKU-60061',
        quantity: 30,
        unitOfMeasure: 'MT',
        unitPrice: 1_260.0,
        lineTotal: 37_800.0,
      },
      {
        lineNumber: 2,
        itemCode: 'SVC-ZINC-COAT',
        description: 'Zinc coating treatment per MT',
        skuOrPartNumber: 'SVC-ZINC-COAT / SKU-60062',
        quantity: 30,
        unitOfMeasure: 'MT',
        unitPrice: 80.0,
        lineTotal: 2_400.0,
      },
      {
        lineNumber: 3,
        itemCode: 'SVC-FREIGHT-02',
        description: 'Freight & logistics',
        skuOrPartNumber: 'SVC-FREIGHT-02 / SKU-60063',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 2_400.0,
        lineTotal: 2_400.0,
      },
    ],
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [User, AuditLog, Invoice, InvoiceLineItem],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log('Seeding invoice line items...\n');

  for (const entry of sampleLineItems) {
    const invoice = await Invoice.findOne({
      where: { invoiceNumber: entry.invoiceNumber },
    });

    if (!invoice) {
      console.log(`! Invoice ${entry.invoiceNumber} not found — skipping`);
      continue;
    }

    for (const line of entry.lines) {
      const [, created] = await InvoiceLineItem.upsert({
        invoiceId: invoice.id,
        ...line,
      } as InvoiceLineItem);

      console.log(
        `${created ? '+' : '~'} ${created ? 'Created' : 'Updated'} ${entry.invoiceNumber} L${line.lineNumber}: ${line.skuOrPartNumber} x${line.quantity} @ $${line.unitPrice} = $${line.lineTotal}`,
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
