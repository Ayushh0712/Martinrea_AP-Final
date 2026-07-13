/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { sequelizeConfig } from './sequelize-config';

const sampleSuppliers = [
  {
    supplierCode: 'SUP-001',
    name: 'Acme Steel Co.',
    taxId: '12-3456789',
    email: 'ap@acmesteel.com',
    phone: '+1-313-555-0101',
    address: '4500 Industrial Pkwy, Detroit, MI 48201, USA',
    currency: 'USD',
    countryCode: 'US',
    paymentTermsDays: 30,
  },
  {
    supplierCode: 'SUP-002',
    name: 'Northbridge Castings',
    taxId: '98-7654321',
    email: 'invoices@northbridgecastings.com',
    phone: '+1-416-555-0202',
    address: '210 Foundry Rd, Windsor, ON N9A 6J3, Canada',
    currency: 'USD',
    countryCode: 'CA',
    paymentTermsDays: 45,
  },
  {
    supplierCode: 'SUP-MX-003',
    name: 'Industrias Saltillo S.A.',
    taxId: 'ISA-930412-AB7',
    email: 'cuentas@industrias-saltillo.com.mx',
    phone: '+52-844-555-0303',
    address: 'Blvd. Isidro López Zertuche 2900, Saltillo, COAH 25070, MX',
    currency: 'MXN',
    countryCode: 'MX',
    paymentTermsDays: 30,
  },
  {
    supplierCode: 'SUP-004',
    name: 'Brightway Tooling Inc.',
    taxId: '55-1122334',
    email: 'billing@brightwaytooling.com',
    phone: '+1-248-555-0404',
    address: '1800 Automation Dr, Auburn Hills, MI 48326, USA',
    currency: 'USD',
    countryCode: 'US',
    paymentTermsDays: 60,
  },
  {
    supplierCode: 'SUP-005',
    name: 'Precision Parts GmbH',
    taxId: 'DE-293847561',
    email: 'rechnungen@precisionparts.de',
    phone: '+49-711-555-0505',
    address: 'Industriestrasse 42, 70565 Stuttgart, Germany',
    currency: 'EUR',
    countryCode: 'DE',
    paymentTermsDays: 45,
  },
  {
    supplierCode: 'SUP-006',
    name: 'Great Lakes Polymers LLC',
    taxId: '77-3344556',
    email: 'ap@greatlakespolymers.com',
    phone: '+1-440-555-0606',
    address: '900 Resin Way, Cleveland, OH 44101, USA',
    currency: 'USD',
    countryCode: 'US',
    paymentTermsDays: 30,
  },
];

async function main() {
  const sequelize = new Sequelize({
    ...sequelizeConfig,
    models: [Supplier],
  });

  await sequelize.authenticate();
  await sequelize.sync();

  console.log('Seeding suppliers...\n');
  for (const sup of sampleSuppliers) {
    const existing = await Supplier.findOne({
      where: { supplierCode: sup.supplierCode },
    });
    if (existing) {
      await existing.update(sup);
      console.log(`~ Updated ${sup.supplierCode} - ${sup.name}`);
      continue;
    }
    const created = await Supplier.create({ ...sup, isActive: true } as Supplier);
    console.log(
      `+ Created ${created.supplierCode} - ${created.name} (${created.countryCode}, ${created.currency})`,
    );
  }

  console.log('\nDone.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
