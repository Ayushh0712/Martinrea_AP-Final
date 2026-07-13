/* eslint-disable no-console */
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import { sequelizeConfig } from './sequelize-config';

/**
 * Wipe all transactional data so the workflow can be re-seeded from scratch
 * (e.g. before loading a fresh set of purchase orders from JSON).
 *
 * TRUNCATEs the invoice / PO / match / OCR / audit tables and leaves the
 * reference data (users, roles, role_permissions, approval_rules, suppliers,
 * vendors) untouched. Editing/deleting rows from the TypeScript seed files does
 * NOT change the database — only running SQL like this does.
 *
 * Order does not matter: these tables carry loose UUID references (no FK
 * constraints), and we TRUNCATE with RESTART IDENTITY CASCADE in one statement.
 */
const TARGET_TABLES = [
  'invoice_po_line_reservations',
  'match_discrepancies',
  'match_records',
  'ocr_results',
  'invoice_line_items',
  'invoices',
  'goods_receipt_lines',
  'goods_receipts',
  'purchase_order_lines',
  'purchase_orders',
  'audit_logs',
];

async function main() {
  const sequelize = new Sequelize({ ...sequelizeConfig });
  await sequelize.authenticate();

  // Only truncate the tables that actually exist. Resolve each name with
  // to_regclass so this works no matter which schema on the search_path the
  // tables live in (the unqualified TRUNCATE below resolves the same way).
  const present: string[] = [];
  for (const t of TARGET_TABLES) {
    const [row] = await sequelize.query<{ reg: string | null }>(
      `SELECT to_regclass(:t) AS reg`,
      { type: QueryTypes.SELECT, replacements: { t } },
    );
    if (row?.reg) present.push(t);
  }

  if (present.length === 0) {
    console.log('No transactional tables found — nothing to reset.');
    await sequelize.close();
    return;
  }

  const list = present.map((t) => `"${t}"`).join(', ');
  console.log(`Resetting transactional data:\n  ${present.join('\n  ')}\n`);
  await sequelize.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);

  console.log('Done. Reference data (users, roles, suppliers, ...) preserved.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
