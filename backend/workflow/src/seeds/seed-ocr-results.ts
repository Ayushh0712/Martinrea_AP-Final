/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { OcrResult } from '../ocr-results/entities/ocr-result.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { sequelizeConfig } from './sequelize-config';

interface OcrResultData {
  extractionEngine: string | null;
  modelVersion: string | null;
  rawResponse: Record<string, unknown> | null;
  extractedInvoiceNumber: string | null;
  extractedSupplierName: string | null;
  extractedPoNumber: string | null;
  extractedTotalAmount: number | null;
  extractedTaxAmount: number | null;
  extractedInvoiceDate: string | null;
  extractedLineItems: Array<{
    lineNumber: number;
    description?: string;
    skuOrPartNumber?: string;
    quantity?: number;
    unitPrice?: number;
    lineTotal?: number;
  }> | null;
  confidenceInvoiceNum: number | null;
  confidenceSupplier: number | null;
  confidencePoNumber: number | null;
  confidenceAmount: number | null;
  overallConfidence: number | null;
  requiresHumanReview: boolean;
  languageDetected: string | null;
  documentType: string | null;
  humanVerified: boolean;
  humanVerifiedAt: Date | null;
  createdAt: string;
}

const sampleOcrResults: Array<{
  invoiceNumber: string;
  overallConfidence: number;
  verifiedByEmail?: string;
  data: OcrResultData;
}> = [
  {
    invoiceNumber: 'INV-2026-001',
    overallConfidence: 0.9898,
    verifiedByEmail: 'clerk@martinrea.dev',
    data: {
      extractionEngine: 'AWS Textract',
      modelVersion: 'textract-2023-10-01',
      extractedInvoiceNumber: 'INV-2026-001',
      extractedSupplierName: 'Acme Steel Co.',
      extractedPoNumber: 'PO-1001',
      extractedTotalAmount: 5400.0,
      extractedTaxAmount: 432.0,
      extractedInvoiceDate: '2026-01-18',
      extractedLineItems: [
        { lineNumber: 1, description: 'Hot-rolled steel coil', skuOrPartNumber: 'STL-HR-0.25x48', quantity: 15, unitPrice: 270.0, lineTotal: 4050.0 },
        { lineNumber: 2, description: 'Freight surcharge', skuOrPartNumber: 'SVC-FREIGHT-01', quantity: 1, unitPrice: 1350.0, lineTotal: 1350.0 },
      ],
      confidenceInvoiceNum: 0.9921,
      confidenceSupplier: 0.9875,
      confidencePoNumber: 0.9840,
      confidenceAmount: 0.9955,
      overallConfidence: 0.9898,
      requiresHumanReview: false,
      languageDetected: 'en',
      documentType: 'INVOICE',
      humanVerified: true,
      humanVerifiedAt: new Date('2026-01-19T09:30:00Z'),
      rawResponse: { pages: 1, blocks: 142, processingTimeMs: 1240 },
      createdAt: '2026-01-18T10:00:00.000Z',
    },
  },
  {
    invoiceNumber: 'INV-2026-002',
    overallConfidence: 0.9742,
    data: {
      extractionEngine: 'Google Document AI',
      modelVersion: 'docai-invoice-v2.1',
      extractedInvoiceNumber: 'INV-2026-002',
      extractedSupplierName: 'Northbridge Castings',
      extractedPoNumber: 'PO-1002',
      extractedTotalAmount: 12750.5,
      extractedTaxAmount: 1020.04,
      extractedInvoiceDate: '2026-01-22',
      extractedLineItems: [
        { lineNumber: 1, description: 'Ductile iron casting - Diff housing', skuOrPartNumber: 'DI-DIFFHSG-A', quantity: 50, unitPrice: 145.0, lineTotal: 7250.0 },
        { lineNumber: 2, description: 'Ductile iron casting - Knuckle LH', skuOrPartNumber: 'DI-KNKL-LH', quantity: 80, unitPrice: 68.756, lineTotal: 5500.5 },
      ],
      confidenceInvoiceNum: 0.9812,
      confidenceSupplier: 0.9634,
      confidencePoNumber: 0.9720,
      confidenceAmount: 0.9801,
      overallConfidence: 0.9742,
      requiresHumanReview: false,
      languageDetected: 'en',
      documentType: 'INVOICE',
      humanVerified: false,
      humanVerifiedAt: null,
      rawResponse: { pages: 2, blocks: 218, processingTimeMs: 1870 },
      createdAt: '2026-01-22T11:00:00.000Z',
    },
  },
  {
    invoiceNumber: 'INV-2026-003',
    overallConfidence: 0.8254,
    verifiedByEmail: 'clerk@martinrea.dev',
    data: {
      extractionEngine: 'Azure Form Recognizer',
      modelVersion: 'prebuilt-invoice-2023-07-31',
      extractedInvoiceNumber: 'INV-2026-003',
      extractedSupplierName: 'Industrias Saltillo S.A.',
      extractedPoNumber: 'PO-MX-1003',
      extractedTotalAmount: 8900.0,
      extractedTaxAmount: 1424.0,
      extractedInvoiceDate: '2026-02-05',
      extractedLineItems: [
        { lineNumber: 1, description: 'Stamped steel bracket MX-44', skuOrPartNumber: 'BRKT-STMP-MX-44', quantity: 500, unitPrice: 17.8, lineTotal: 8900.0 },
      ],
      confidenceInvoiceNum: 0.8412,
      confidenceSupplier: 0.7935,
      confidencePoNumber: 0.8120,
      confidenceAmount: 0.8550,
      overallConfidence: 0.8254,
      requiresHumanReview: true,
      languageDetected: 'es',
      documentType: 'INVOICE',
      humanVerified: true,
      humanVerifiedAt: new Date('2026-02-06T14:15:00Z'),
      rawResponse: { pages: 1, blocks: 97, processingTimeMs: 990 },
      createdAt: '2026-02-05T12:00:00.000Z',
    },
  },
  {
    invoiceNumber: 'INV-2026-004',
    overallConfidence: 0.9717,
    data: {
      extractionEngine: 'AWS Textract',
      modelVersion: 'textract-2023-10-01',
      extractedInvoiceNumber: 'INV-2026-004',
      extractedSupplierName: 'Brightway Tooling Inc.',
      extractedPoNumber: 'PO-1004',
      extractedTotalAmount: 62300.0,
      extractedTaxAmount: 4984.0,
      extractedInvoiceDate: '2026-02-14',
      extractedLineItems: [
        { lineNumber: 1, description: 'Progressive die tooling set', skuOrPartNumber: 'DIE-PROG-PLT2-A', quantity: 1, unitPrice: 55000.0, lineTotal: 55000.0 },
        { lineNumber: 2, description: 'Installation & commissioning', skuOrPartNumber: 'SVC-INSTALL-01', quantity: 1, unitPrice: 7300.0, lineTotal: 7300.0 },
      ],
      confidenceInvoiceNum: 0.9745,
      confidenceSupplier: 0.9612,
      confidencePoNumber: 0.9688,
      confidenceAmount: 0.9821,
      overallConfidence: 0.9717,
      requiresHumanReview: false,
      languageDetected: 'en',
      documentType: 'INVOICE',
      humanVerified: false,
      humanVerifiedAt: null,
      rawResponse: { pages: 3, blocks: 312, processingTimeMs: 2450 },
      createdAt: '2026-02-14T09:00:00.000Z',
    },
  },
  {
    invoiceNumber: 'INV-2026-005',
    overallConfidence: 0.9609,
    data: {
      extractionEngine: 'Google Document AI',
      modelVersion: 'docai-invoice-v2.1',
      extractedInvoiceNumber: 'INV-2026-005',
      extractedSupplierName: 'Delta Fabrications Ltd.',
      extractedPoNumber: 'PO-1005',
      extractedTotalAmount: 23500.0,
      extractedTaxAmount: 1880.0,
      extractedInvoiceDate: '2026-06-10',
      extractedLineItems: [
        { lineNumber: 1, description: 'Precision stamped bracket assembly', skuOrPartNumber: 'BRKT-PRES-D12', quantity: 200, unitPrice: 115.0, lineTotal: 23000.0 },
        { lineNumber: 2, description: 'Quality certification', skuOrPartNumber: 'SVC-QC-DOC', quantity: 1, unitPrice: 500.0, lineTotal: 500.0 },
      ],
      confidenceInvoiceNum: 0.9634,
      confidenceSupplier: 0.9501,
      confidencePoNumber: 0.9589,
      confidenceAmount: 0.9710,
      overallConfidence: 0.9609,
      requiresHumanReview: false,
      languageDetected: 'en',
      documentType: 'INVOICE',
      humanVerified: false,
      humanVerifiedAt: null,
      rawResponse: { pages: 2, blocks: 198, processingTimeMs: 1650 },
      createdAt: '2026-06-10T08:00:00.000Z',
    },
  },
  {
    invoiceNumber: 'INV-2026-006',
    overallConfidence: 0.9840,
    data: {
      extractionEngine: 'AWS Textract',
      modelVersion: 'textract-2023-10-01',
      extractedInvoiceNumber: 'INV-2026-006',
      extractedSupplierName: 'Pacific Metals Corp.',
      extractedPoNumber: 'PO-1006',
      extractedTotalAmount: 42600.0,
      extractedTaxAmount: 3408.0,
      extractedInvoiceDate: '2026-06-12',
      extractedLineItems: [
        { lineNumber: 1, description: 'Cold-rolled steel sheet 1.2mm gauge', skuOrPartNumber: 'STL-CR-1.2MM', quantity: 30, unitPrice: 1260.0, lineTotal: 37800.0 },
        { lineNumber: 2, description: 'Zinc coating treatment', skuOrPartNumber: 'SVC-ZINC-COAT', quantity: 30, unitPrice: 80.0, lineTotal: 2400.0 },
        { lineNumber: 3, description: 'Freight & logistics', skuOrPartNumber: 'SVC-FREIGHT-02', quantity: 1, unitPrice: 2400.0, lineTotal: 2400.0 },
      ],
      confidenceInvoiceNum: 0.9888,
      confidenceSupplier: 0.9756,
      confidencePoNumber: 0.9801,
      confidenceAmount: 0.9912,
      overallConfidence: 0.9840,
      requiresHumanReview: false,
      languageDetected: 'en',
      documentType: 'INVOICE',
      humanVerified: false,
      humanVerifiedAt: null,
      rawResponse: { pages: 2, blocks: 267, processingTimeMs: 2010 },
      createdAt: '2026-06-12T09:00:00.000Z',
    },
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [User, AuditLog, Invoice, InvoiceLineItem, OcrResult],
  });

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log('Seeding OCR results...\n');

  for (const entry of sampleOcrResults) {
    const invoice = await Invoice.findOne({
      where: { invoiceNumber: entry.invoiceNumber },
    });

    if (!invoice) {
      console.log(`! Invoice ${entry.invoiceNumber} not found — skipping`);
      continue;
    }

    let verifierId: string | null = null;
    if (entry.verifiedByEmail) {
      const verifier = await User.findOne({ where: { email: entry.verifiedByEmail } });
      verifierId = verifier?.id ?? null;
    }

    const existing = await OcrResult.findOne({ where: { invoiceId: invoice.id } });
    if (existing) {
      await existing.update({ ...entry.data, humanVerifiedBy: verifierId, createdAt: new Date(entry.data.createdAt) });
      console.log(`~ Updated OCR result for ${entry.invoiceNumber} (confidence: ${entry.data.overallConfidence})`);
    } else {
      await OcrResult.create({
        invoiceId: invoice.id,
        humanVerifiedBy: verifierId,
        ...entry.data,
        createdAt: new Date(entry.data.createdAt),
      } as unknown as OcrResult);
      console.log(`+ Created OCR result for ${entry.invoiceNumber} (confidence: ${entry.data.overallConfidence}, engine: ${entry.data.extractionEngine})`);
    }
  }

  console.log('\nDone.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
