/**
 * Seeds the local-profile working directories with sample invoices so the
 * whole pipeline can be demoed with zero external infrastructure:
 *
 *   npm run seed:local
 *   npm run poll:email     # ingests the seeded email attachments
 *   npm run poll:sftp      # ingests the seeded SFTP files
 *
 * Layout produced (defaults; override with LOCAL_MAILDIR / LOCAL_SFTP_DIR):
 *
 *   .local-maildir/<mailbox>/msg-001-valid-invoice/   valid PDF + meta.json
 *   .local-maildir/<mailbox>/msg-002-cfdi/            CFDI XML
 *   .local-maildir/<mailbox>/msg-003-no-attachment/   meta.json only -> AP-No-Attachment
 *   .local-maildir/<mailbox>/msg-004-bad-file/        .exe-shaped file -> AP-Failed + quarantine
 *   .local-maildir/<mailbox>/msg-005-duplicate/       same PDF as msg-001 -> dedup no-op
 *   .local-sftp/incoming/welland/                     valid PDF + PNG
 *   .local-sftp/incoming/saltillo/                    CFDI XML + oversized PDF (quarantined)
 *
 * NOTE: seeded SFTP files have their mtime backdated past the partial-write
 * grace window so the very next poll picks them up.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { makeJpeg, makePdf, makePng, makeXml } from '../test/fixtures/file-bytes';

const MAILDIR = process.env.LOCAL_MAILDIR ?? '.local-maildir';
const SFTPDIR = process.env.LOCAL_SFTP_DIR ?? '.local-sftp';
const MAILBOX = (process.env.MAIL_AP_MAILBOXES ?? 'ap-canada@martinrea.com')
  .split(',')[0]
  .trim()
  .replace(/[^a-zA-Z0-9.@_-]/g, '_');

/** An "oversized" file: just past the 10 MiB default cap. */
function makeOversized(): Buffer {
  const buf = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20);
  makePdf().copy(buf, 0); // valid PDF magic bytes, so only the SIZE rule rejects it
  return buf;
}

/** A file whose magic bytes are a Windows executable (MZ header). */
function makeExecutable(): Buffer {
  return Buffer.concat([Buffer.from('MZ'), Buffer.alloc(512, 0)]);
}

async function seedMessage(
  name: string,
  attachments: Record<string, Buffer>,
  meta: { fromAddress: string; subject: string },
): Promise<void> {
  const dir = path.join(MAILDIR, MAILBOX, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({ ...meta, receivedAt: new Date().toISOString() }, null, 2),
  );
  for (const [fileName, buffer] of Object.entries(attachments)) {
    await fs.writeFile(path.join(dir, fileName), buffer);
  }
  console.log(`  email   ${name} (${Object.keys(attachments).length} attachment(s))`);
}

async function seedSftpFile(plant: string, fileName: string, buffer: Buffer): Promise<void> {
  const dir = path.join(SFTPDIR, 'incoming', plant);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);
  // Backdate mtime past the partial-write grace window (default 30s).
  const past = new Date(Date.now() - 5 * 60 * 1000);
  await fs.utimes(filePath, past, past);
  console.log(`  sftp    incoming/${plant}/${fileName} (${buffer.length} bytes)`);
}

(async () => {
  console.log(`Seeding local fixtures (maildir=${MAILDIR}, sftp=${SFTPDIR})`);
  console.log(`Mailbox: ${MAILBOX}`);

  const validPdf = makePdf();

  await seedMessage(
    'msg-001-valid-invoice',
    { 'invoice-acme-1001.pdf': validPdf },
    { fromAddress: 'billing@acme-steel.com', subject: 'Invoice 1001 - Acme Steel' },
  );
  await seedMessage(
    'msg-002-cfdi',
    { 'factura-ATI-2044.xml': makeXml(), 'factura-scan.jpg': makeJpeg() },
    { fromAddress: 'facturacion@acero-tijuana.mx', subject: 'Factura ATI-2044 (CFDI)' },
  );
  await seedMessage('msg-003-no-attachment', {}, {
    fromAddress: 'vendor@nofiles.com',
    subject: 'Where is my payment?',
  });
  await seedMessage(
    'msg-004-bad-file',
    { 'totally-an-invoice.pdf.exe': makeExecutable() },
    { fromAddress: 'suspicious@vendor.biz', subject: 'Invoice attached (trust me)' },
  );
  await seedMessage(
    'msg-005-duplicate',
    { 'invoice-acme-1001-resend.pdf': validPdf },
    { fromAddress: 'billing@acme-steel.com', subject: 'RE: Invoice 1001 (resending)' },
  );

  await seedSftpFile('welland', 'scan-batch-0001.pdf', makePdf());
  await seedSftpFile('welland', 'scan-batch-0002.png', makePng());
  await seedSftpFile('saltillo', 'factura-SAL-993.xml', makeXml());
  await seedSftpFile('saltillo', 'oversized-scan.pdf', makeOversized());

  console.log('Done. Run `npm run poll:email` / `npm run poll:sftp` to ingest.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
