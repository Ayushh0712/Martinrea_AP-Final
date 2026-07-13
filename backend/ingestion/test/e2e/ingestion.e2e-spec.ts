/**
 * ING-06: End-to-end ingestion suite.
 *
 * Boots the REAL IngestionModule under the `local` profile against
 * throwaway temp directories and exercises all three channels:
 *
 *   Email   - valid / no-attachment / invalid type / duplicate
 *   SFTP    - valid / oversized / invalid type / duplicate
 *   Portal  - valid / oversized / invalid type / duplicate / no file
 *
 * No network, no cloud: LocalMailClient, LocalSftpClientFactory and
 * LocalBlobUploader stand in for the real transports. The pipeline code
 * under test (PreProcessingService, the three channel services, the portal
 * controller) is exactly what runs in production.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EmailIngestionService } from '../../src/ingestion/email/email-ingestion.service';
import { SftpIngestionService } from '../../src/ingestion/sftp/sftp-ingestion.service';
import { makePdf, makePng, makeXml } from '../fixtures/file-bytes';

const MAILBOX = 'ap-test@local';

let workDir: string;
let storageDir: string;
let maildir: string;
let sftpDir: string;
let app: INestApplication;

/** A structurally valid PDF made unique per test by a trailing comment. */
function uniquePdf(tag: string): Buffer {
  return Buffer.concat([makePdf(), Buffer.from(`\n% e2e:${tag}\n`)]);
}

function oversizedPdf(): Buffer {
  const buf = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20);
  makePdf().copy(buf, 0);
  return buf;
}

function exeBytes(): Buffer {
  return Buffer.concat([Buffer.from('MZ'), Buffer.alloc(256, 0)]);
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => !f.endsWith('.meta.json'));
  } catch {
    return [];
  }
}

const rawFiles = () => listFiles(path.join(storageDir, 'raw'));
const quarantineFiles = () => listFiles(path.join(storageDir, 'quarantine'));

async function seedEmail(msgId: string, attachments: Record<string, Buffer>): Promise<void> {
  const dir = path.join(maildir, MAILBOX, msgId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({ fromAddress: 'vendor@e2e.test', subject: msgId }),
  );
  for (const [name, buffer] of Object.entries(attachments)) {
    await fs.writeFile(path.join(dir, name), buffer);
  }
}

async function emailFolder(folder: string, msgId: string): Promise<boolean> {
  try {
    await fs.access(path.join(maildir, MAILBOX, folder, msgId));
    return true;
  } catch {
    return false;
  }
}

async function seedSftp(name: string, buffer: Buffer): Promise<void> {
  const dir = path.join(sftpDir, 'incoming', 'welland');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, buffer);
  // Backdate the mtime past the partial-write grace window. Filesystem
  // timestamps can land a few ms AHEAD of Date.now() on Windows, which
  // would make the poller skip the file as "still being written".
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(filePath, past, past);
}

const sftpRemaining = () => listFiles(path.join(sftpDir, 'incoming', 'welland'));

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingestion-e2e-'));
  storageDir = path.join(workDir, 'storage');
  maildir = path.join(workDir, 'maildir');
  sftpDir = path.join(workDir, 'sftp');

  Object.assign(process.env, {
    INGESTION_PROFILE: 'local',
    MAIL_TRANSPORT: 'local',
    BLOB_TRANSPORT: 'local',
    SFTP_TRANSPORT: 'local',
    LOCAL_STORAGE_DIR: storageDir,
    LOCAL_MAILDIR: maildir,
    LOCAL_SFTP_DIR: sftpDir,
    MAIL_AP_MAILBOXES: MAILBOX,
    SFTP_INCOMING_PATHS: '/incoming/welland',
    SFTP_PARTIAL_WRITE_GRACE_MS: '0',
    // Far-future tick so cron never fires mid-test; polls are driven manually.
    EMAIL_POLL_CRON: '0 0 0 1 1 *',
    SFTP_POLL_CRON: '0 0 0 1 1 *',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 30000);

afterAll(async () => {
  await app?.close();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('Email channel (ING-02)', () => {
  const poll = () => app.get(EmailIngestionService).pollAllMailboxes();

  it('ingests a valid attachment and moves the message to AP-Processed', async () => {
    await seedEmail('msg-valid', { 'invoice-email-valid.pdf': uniquePdf('email-valid') });
    await poll();

    expect((await rawFiles()).some((f) => f.includes('invoice-email-valid'))).toBe(true);
    expect(await emailFolder('AP-Processed', 'msg-valid')).toBe(true);
  });

  it('moves messages without attachments to AP-No-Attachment', async () => {
    await seedEmail('msg-empty', {});
    await poll();

    expect(await emailFolder('AP-No-Attachment', 'msg-empty')).toBe(true);
  });

  it('quarantines invalid file types and moves the message to AP-Failed', async () => {
    await seedEmail('msg-bad', { 'invoice-email-bad.pdf': exeBytes() });
    await poll();

    expect((await rawFiles()).some((f) => f.includes('invoice-email-bad'))).toBe(false);
    expect((await quarantineFiles()).some((f) => f.includes('invoice-email-bad'))).toBe(true);
    expect(await emailFolder('AP-Failed', 'msg-bad')).toBe(true);
  });

  it('deduplicates identical content arriving in a second message (idempotency)', async () => {
    const same = uniquePdf('email-dup');
    await seedEmail('msg-dup-1', { 'invoice-email-dup-a.pdf': same });
    await poll();
    const countAfterFirst = (await rawFiles()).length;

    await seedEmail('msg-dup-2', { 'invoice-email-dup-b.pdf': same });
    await poll();

    expect((await rawFiles()).length).toBe(countAfterFirst); // nothing new written
    expect(await emailFolder('AP-Processed', 'msg-dup-2')).toBe(true); // still acked
  });
});

describe('SFTP channel (ING-03)', () => {
  const poll = () => app.get(SftpIngestionService).pollAllPaths();

  it('ingests a valid file and deletes it from the SFTP source', async () => {
    await seedSftp('scan-sftp-valid.pdf', uniquePdf('sftp-valid'));
    await poll();

    expect((await rawFiles()).some((f) => f.includes('scan-sftp-valid'))).toBe(true);
    expect(await sftpRemaining()).not.toContain('scan-sftp-valid.pdf');
  });

  it('quarantines oversized files and removes them from the source', async () => {
    await seedSftp('scan-sftp-oversized.pdf', oversizedPdf());
    await poll();

    expect((await rawFiles()).some((f) => f.includes('scan-sftp-oversized'))).toBe(false);
    expect((await quarantineFiles()).some((f) => f.includes('scan-sftp-oversized'))).toBe(true);
    expect(await sftpRemaining()).not.toContain('scan-sftp-oversized.pdf');
  });

  it('quarantines invalid file types and removes them from the source', async () => {
    await seedSftp('scan-sftp-bad.pdf', exeBytes());
    await poll();

    expect((await quarantineFiles()).some((f) => f.includes('scan-sftp-bad'))).toBe(true);
    expect(await sftpRemaining()).not.toContain('scan-sftp-bad.pdf');
  });

  it('treats re-delivered identical content as a no-op (idempotency)', async () => {
    const same = uniquePdf('sftp-dup');
    await seedSftp('scan-sftp-dup-a.pdf', same);
    await poll();
    const countAfterFirst = (await rawFiles()).length;

    await seedSftp('scan-sftp-dup-b.pdf', same);
    await poll();

    expect((await rawFiles()).length).toBe(countAfterFirst);
    expect(await sftpRemaining()).toEqual([]); // both source files cleaned up
  });

  it('accepts CFDI XML files', async () => {
    await seedSftp('factura-cfdi.xml', makeXml());
    await poll();

    expect((await rawFiles()).some((f) => f.includes('factura-cfdi'))).toBe(true);
  });
});

describe('Portal channel (ING-04)', () => {
  const upload = (name: string, buffer: Buffer) =>
    request(app.getHttpServer())
      .post('/api/ingestion/upload')
      .set('Authorization', 'Bearer e2e-dev-token')
      .attach('file', buffer, name);

  it('returns 201 with a documentId for a valid upload', async () => {
    const res = await upload('invoice-portal-valid.pdf', uniquePdf('portal-valid'));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.documentId).toBeDefined();
    expect(res.body.data.status).toBe('STAGED');
    expect((await rawFiles()).some((f) => f.includes('invoice-portal-valid'))).toBe(true);
  });

  it('rejects oversized uploads with 400 and quarantines them', async () => {
    const res = await upload('invoice-portal-oversized.pdf', oversizedPdf());
    expect(res.status).toBe(400);
    expect((await quarantineFiles()).some((f) => f.includes('invoice-portal-oversized'))).toBe(true);
  });

  it('rejects disallowed file types with 415 and quarantines them', async () => {
    const res = await upload('invoice-portal-bad.pdf', exeBytes());

    expect(res.status).toBe(415);
    expect((await quarantineFiles()).some((f) => f.includes('invoice-portal-bad'))).toBe(true);
  });

  it('reports duplicates as DUPLICATE instead of double-ingesting', async () => {
    const same = uniquePdf('portal-dup');
    const first = await upload('invoice-portal-dup.pdf', same);
    expect(first.body.data.status).toBe('STAGED');
    const countAfterFirst = (await rawFiles()).length;

    const second = await upload('invoice-portal-dup.pdf', same);

    expect(second.status).toBe(201);
    expect(second.body.data.status).toBe('DUPLICATE');
    expect(second.body.data.documentId).toBe(first.body.data.documentId);
    expect((await rawFiles()).length).toBe(countAfterFirst);
  });

  it('rejects requests without a file with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ingestion/upload')
      .set('Authorization', 'Bearer e2e-dev-token');
    expect(res.status).toBe(400);
  });

  it('rejects requests without a bearer token with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ingestion/upload')
      .attach('file', uniquePdf('portal-noauth'), 'invoice.pdf');
    expect(res.status).toBe(401);
  });

  it('accepts a PNG image upload', async () => {
    const res = await upload('photo-invoice.png', makePng());
    expect(res.status).toBe(201);
  });
});

describe('Health endpoint (ING-01)', () => {
  it('GET /ingestion/health returns 200 ok', async () => {
    const res = await request(app.getHttpServer()).get('/ingestion/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
