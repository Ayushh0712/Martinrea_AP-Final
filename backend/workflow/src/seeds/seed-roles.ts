/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { RolePermission } from '../roles/entities/role-permission.entity';
import { Role } from '../common/enums/role.enum';
import { sequelizeConfig } from './sequelize-config';

/**
 * RBAC permission matrix per PRD Section 4.7.
 *
 * Permissions follow the pattern RESOURCE:ACTION.
 * This seed defines the Phase 1 baseline; rows can be toggled (isActive)
 * or extended without code changes.
 */
const rolePermissions: Array<{ role: Role; permission: string; description: string }> = [
  // ── AP_Clerk ─────────────────────────────────────────────────────────────
  {
    role: Role.AP_CLERK,
    permission: 'invoice:create',
    description: 'Create new invoice records',
  },
  {
    role: Role.AP_CLERK,
    permission: 'invoice:view',
    description: 'View invoice details and status',
  },
  {
    role: Role.AP_CLERK,
    permission: 'invoice:edit',
    description: 'Edit invoices in PENDING_REVIEW state',
  },
  {
    role: Role.AP_CLERK,
    permission: 'invoice:submit',
    description: 'Submit invoice for 3-way match',
  },
  {
    role: Role.AP_CLERK,
    permission: 'supplier:view',
    description: 'Look up supplier master data',
  },
  {
    role: Role.AP_CLERK,
    permission: 'purchase_order:view',
    description: 'View PO details for matching',
  },
  {
    role: Role.AP_CLERK,
    permission: 'goods_receipt:view',
    description: 'View GR details for matching',
  },

  // ── Plant_Manager ────────────────────────────────────────────────────────
  {
    role: Role.PLANT_MANAGER,
    permission: 'invoice:view',
    description: 'View invoices assigned to their plant',
  },
  {
    role: Role.PLANT_MANAGER,
    permission: 'invoice:approve',
    description: 'Approve invoices up to $50,000',
  },
  {
    role: Role.PLANT_MANAGER,
    permission: 'invoice:reject',
    description: 'Reject invoices with reason',
  },
  {
    role: Role.PLANT_MANAGER,
    permission: 'supplier:view',
    description: 'Look up supplier master data',
  },
  {
    role: Role.PLANT_MANAGER,
    permission: 'purchase_order:view',
    description: 'View PO details for their plant',
  },
  {
    role: Role.PLANT_MANAGER,
    permission: 'goods_receipt:view',
    description: 'View GR details for their plant',
  },
  {
    role: Role.PLANT_MANAGER,
    permission: 'report:view_plant',
    description: 'View plant-level AP reports and dashboards',
  },

  // ── Finance_Director ─────────────────────────────────────────────────────
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'invoice:view',
    description: 'View all invoices across all plants',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'invoice:approve',
    description: 'Approve invoices of any amount',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'invoice:reject',
    description: 'Reject invoices with reason',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'supplier:view',
    description: 'View and manage supplier master data',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'supplier:edit',
    description: 'Edit supplier payment terms and details',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'purchase_order:view',
    description: 'View all POs',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'goods_receipt:view',
    description: 'View all GRs',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'report:view_all',
    description: 'View company-wide AP reports and dashboards',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'rules_engine:view',
    description: 'View approval routing rules',
  },
  {
    role: Role.FINANCE_DIRECTOR,
    permission: 'rules_engine:edit',
    description: 'Update approval routing thresholds',
  },

  // ── VP_Finance ───────────────────────────────────────────────────────────
  {
    role: Role.VP_FINANCE,
    permission: 'invoice:view',
    description: 'View all invoices',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'invoice:approve',
    description: 'Approve invoices > $50,000 (final step in Tier-3 chain)',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'invoice:reject',
    description: 'Reject invoices with reason',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'supplier:view',
    description: 'View supplier master data',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'purchase_order:view',
    description: 'View all POs',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'goods_receipt:view',
    description: 'View all GRs',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'report:view_all',
    description: 'View company-wide AP reports and dashboards',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'report:export',
    description: 'Export AP reports to CSV/Excel',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'rules_engine:view',
    description: 'View approval routing rules',
  },
  {
    role: Role.VP_FINANCE,
    permission: 'audit_log:view',
    description: 'View full audit trail',
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [RolePermission],
  });

  await sequelize.authenticate();
  await sequelize.sync();

  console.log('Seeding role permissions...\n');
  let created = 0;
  let updated = 0;

  for (const rp of rolePermissions) {
    const existing = await RolePermission.findOne({
      where: { role: rp.role, permission: rp.permission },
    });
    if (existing) {
      await existing.update({ description: rp.description, isActive: true });
      console.log(`  ~ Updated [${rp.role}] ${rp.permission}`);
      updated++;
      continue;
    }
    await RolePermission.create({ ...rp, isActive: true } as RolePermission);
    console.log(`  + Created [${rp.role}] ${rp.permission}`);
    created++;
  }

  console.log(`\nDone. Created ${created}, updated ${updated}.`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
