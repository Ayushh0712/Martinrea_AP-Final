/* eslint-disable no-console */
import 'reflect-metadata';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { ApprovalRule } from '../rules-engine/entities/approval-rule.entity';
import { Role } from '../common/enums/role.enum';
import { sequelizeConfig } from './sequelize-config';

/**
 * Default approval routing rules per PRD WF-03.
 *
 * These are seeded as a working baseline. When Martinrea provides the
 * canonical DOA (Delegation of Authority) matrix the rows can be
 * updated in-place - no code change required.
 */
const rules = [
  {
    ruleName: 'Tier-1-Small',
    minAmount: null,
    maxAmount: 10_000,
    roleChain: [Role.FINANCE_DIRECTOR],
    priority: 10,
    description: 'Invoice <= $10,000 : single approval by Finance Director',
  },
  {
    ruleName: 'Tier-2-Medium',
    minAmount: 10_000,
    maxAmount: null,
    roleChain: [Role.PLANT_MANAGER, Role.FINANCE_DIRECTOR],
    priority: 20,
    description: 'Invoice > $10K : Plant Manager then Finance Director',
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [User, AuditLog, Invoice, ApprovalRule],
  });

  await sequelize.authenticate();
  await sequelize.sync();

  console.log('Seeding approval rules...\n');
  for (const r of rules) {
    const existing = await ApprovalRule.findOne({ where: { ruleName: r.ruleName } });
    if (existing) {
      await existing.update(r);
      console.log(`~ Updated rule '${r.ruleName}' chain=[${r.roleChain.join(',')}]`);
    } else {
      await ApprovalRule.create({ ...r, isActive: true } as ApprovalRule);
      console.log(`+ Created rule '${r.ruleName}' chain=[${r.roleChain.join(',')}]`);
    }
  }

  // Prune any rule no longer in the seed set (e.g. the removed Tier-3-Large)
  // so re-running the seed makes the DB match these definitions exactly.
  const keepNames = rules.map((r) => r.ruleName);
  const removed = await ApprovalRule.destroy({
    where: { ruleName: { [Op.notIn]: keepNames } },
  });
  if (removed > 0) {
    console.log(`- Removed ${removed} obsolete rule(s) not in the seed set`);
  }

  console.log('\nDone.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
