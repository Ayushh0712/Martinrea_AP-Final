/* eslint-disable no-console */
import 'reflect-metadata';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { sequelizeConfig } from './sequelize-config';

/**
 * Phase-1 demo user hierarchy for WF-01..WF-05 (PRD WF-03 tiers):
 *
 *   Finance_Director (fd@)    - sole approver <= $10K; second approver > $10K
 *      ^ manager
 *   Plant_Manager    (pm@  - PLT-001)  - first approver > $10K
 *      ^ manager
 *   AP_Clerk         (clerk@ - PLT-001)
 */
async function main() {
  const sequelize = new Sequelize({ ...sequelizeConfig, models: [User] });

  await sequelize.authenticate();
  await sequelize.sync();

  async function upsert(email: string, fields: Partial<User>) {
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      await existing.update(fields);
      console.log(`~ Updated ${email} (${fields.role})`);
      return existing;
    }
    const created = await User.create({ email, ...fields } as User);
    console.log(`+ Created ${email} (${fields.role})`);
    return created;
  }

  const passwordHash = await bcrypt.hash('Password123!', 12);

  const fd = await upsert('fd@martinrea.dev', {
    fullName: 'Finance Director',
    passwordHash,
    role: Role.FINANCE_DIRECTOR,
    plantId: null,
    managerId: null,
    isActive: true,
  });
  const pm = await upsert('pm@martinrea.dev', {
    fullName: 'Plant Manager (PLT-001)',
    passwordHash,
    role: Role.PLANT_MANAGER,
    plantId: 'PLT-001',
    managerId: fd.id,
    isActive: true,
  });
  await upsert('clerk@martinrea.dev', {
    fullName: 'AP Clerk',
    passwordHash,
    role: Role.AP_CLERK,
    plantId: 'PLT-001',
    managerId: pm.id,
    isActive: true,
  });

  // Prune any user no longer in the phase-1 set (e.g. the removed VP_Finance
  // and PLT-002 Plant Manager) so re-running the seed makes the DB match
  // these definitions exactly.
  const keepEmails = [
    'fd@martinrea.dev',
    'pm@martinrea.dev',
    'clerk@martinrea.dev',
  ];
  const removed = await User.destroy({
    where: { email: { [Op.notIn]: keepEmails } },
  });
  if (removed > 0) {
    console.log(`- Removed ${removed} user(s) not in the phase-1 set`);
  }

  console.log('\nAll users seeded. Default password: Password123!');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
