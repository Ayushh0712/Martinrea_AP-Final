/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { User } from '../users/entities/user.entity';
import { sequelizeConfig } from './sequelize-config';

/**
 * Sample audit log entries covering the main action types from PRD DAT-04.
 *
 * Real invoice/user IDs are resolved at runtime so the FK-like references
 * remain consistent with the other seed data. If a referenced invoice or
 * user has not been seeded yet, that entry is skipped with a warning.
 */

type AuditEntry = {
  actionType: string;
  invoiceNumber?: string;
  performedByEmail?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  notes?: string;
};

const sampleEntries: AuditEntry[] = [
  // Invoice created via portal
  {
    actionType: 'INVOICE_CREATED',
    invoiceNumber: 'INV-2026-001',
    performedByEmail: 'clerk@martinrea.dev',
    newValue: {
      invoiceNumber: 'INV-2026-001',
      supplierName: 'Acme Steel Co.',
      totalAmount: 5400.0,
      status: 'PENDING_REVIEW',
    },
    notes: 'Ingested via EMAIL channel',
  },
  // Status transition: PENDING_REVIEW -> PENDING_MATCH
  {
    actionType: 'STATUS_CHANGED',
    invoiceNumber: 'INV-2026-001',
    performedByEmail: 'clerk@martinrea.dev',
    oldValue: { status: 'PENDING_REVIEW' },
    newValue: { status: 'PENDING_MATCH' },
    notes: 'Clerk submitted for 3-way match',
  },
  // 3-way match passed
  {
    actionType: 'MATCH_COMPLETED',
    invoiceNumber: 'INV-2026-001',
    performedByEmail: 'clerk@martinrea.dev',
    oldValue: { status: 'PENDING_MATCH' },
    newValue: { status: 'MATCHED' },
    notes: 'PO-1001 + GR-1001 matched within tolerance',
  },
  // Invoice submitted for approval
  {
    actionType: 'APPROVAL_SUBMITTED',
    invoiceNumber: 'INV-2026-001',
    performedByEmail: 'clerk@martinrea.dev',
    oldValue: { status: 'MATCHED' },
    newValue: {
      status: 'PENDING_APPROVAL',
      approvalChain: ['Finance_Manager'],
    },
    notes: 'Tier-1 rule applied (amount <= $10,000)',
  },
  // Finance Manager approves
  {
    actionType: 'INVOICE_APPROVED',
    invoiceNumber: 'INV-2026-001',
    performedByEmail: 'fm@martinrea.dev',
    oldValue: { status: 'PENDING_APPROVAL' },
    newValue: { status: 'APPROVED' },
    notes: 'Approved by Finance Manager',
  },

  // Second invoice - created
  {
    actionType: 'INVOICE_CREATED',
    invoiceNumber: 'INV-2026-002',
    performedByEmail: 'clerk@martinrea.dev',
    newValue: {
      invoiceNumber: 'INV-2026-002',
      supplierName: 'Northbridge Castings',
      totalAmount: 12750.5,
      status: 'PENDING_REVIEW',
    },
    notes: 'Ingested via SFTP channel',
  },
  // Status transition: PENDING_REVIEW -> PENDING_MATCH
  {
    actionType: 'STATUS_CHANGED',
    invoiceNumber: 'INV-2026-002',
    performedByEmail: 'clerk@martinrea.dev',
    oldValue: { status: 'PENDING_REVIEW' },
    newValue: { status: 'PENDING_MATCH' },
    notes: 'OCR data validated, sent to match workbench',
  },

  // MX invoice - created
  {
    actionType: 'INVOICE_CREATED',
    invoiceNumber: 'INV-2026-003',
    performedByEmail: 'clerk@martinrea.dev',
    newValue: {
      invoiceNumber: 'INV-2026-003',
      supplierName: 'Industrias Saltillo S.A.',
      totalAmount: 8900.0,
      currency: 'MXN',
      status: 'PENDING_REVIEW',
    },
    notes: 'Ingested via PORTAL channel',
  },

  // Large invoice - escalation event
  {
    actionType: 'INVOICE_CREATED',
    invoiceNumber: 'INV-2026-004',
    performedByEmail: 'clerk@martinrea.dev',
    newValue: {
      invoiceNumber: 'INV-2026-004',
      supplierName: 'Brightway Tooling Inc.',
      totalAmount: 62300.0,
      status: 'PENDING_REVIEW',
    },
    notes: 'Ingested via EMAIL channel',
  },
  {
    actionType: 'APPROVAL_SUBMITTED',
    invoiceNumber: 'INV-2026-004',
    performedByEmail: 'clerk@martinrea.dev',
    oldValue: { status: 'MATCHED' },
    newValue: {
      status: 'PENDING_APPROVAL',
      approvalChain: ['Plant_Manager', 'Finance_Manager'],
    },
    notes: 'Tier-3 rule applied (amount > $50,000) - routed to PM first',
  },
  {
    actionType: 'SLA_ESCALATION',
    invoiceNumber: 'INV-2026-004',
    oldValue: { currentApprover: 'pm@martinrea.dev' },
    newValue: { escalatedTo: 'fm@martinrea.dev', reason: 'SLA_BREACH_48H' },
    notes: 'Escalation cron: Plant Manager did not act within 48 hours',
  },

  // User login event (no invoice)
  {
    actionType: 'USER_LOGIN',
    invoiceNumber: undefined,
    performedByEmail: 'fm@martinrea.dev',
    newValue: { email: 'fm@martinrea.dev', role: 'Finance_Manager' },
    notes: 'Successful login',
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [AuditLog, Invoice, User],
  });

  await sequelize.authenticate();
  await sequelize.sync();

  console.log('Seeding audit logs...\n');
  let created = 0;

  for (const entry of sampleEntries) {
    // Resolve invoice ID
    let invoiceId: string | null = null;
    if (entry.invoiceNumber) {
      const inv = await Invoice.findOne({ where: { invoiceNumber: entry.invoiceNumber } });
      if (!inv) {
        console.log(`! Invoice ${entry.invoiceNumber} not found - run seed-invoices first`);
        continue;
      }
      invoiceId = inv.id;
    }

    // Resolve user ID
    let performedBy: string | null = null;
    if (entry.performedByEmail) {
      const user = await User.findOne({ where: { email: entry.performedByEmail } });
      if (!user) {
        console.log(`! User ${entry.performedByEmail} not found - run seed-users first`);
        continue;
      }
      performedBy = user.id;
    }

    await AuditLog.create({
      actionType: entry.actionType,
      invoiceId,
      performedBy,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      notes: entry.notes ?? null,
    } as AuditLog);

    console.log(
      `+ ${entry.actionType}${entry.invoiceNumber ? ` | ${entry.invoiceNumber}` : ''}${entry.performedByEmail ? ` | by ${entry.performedByEmail}` : ''}`,
    );
    created++;
  }

  console.log(`\nDone. Created ${created} audit log entries.`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
