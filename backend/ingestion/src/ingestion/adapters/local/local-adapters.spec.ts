import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { LocalBlobUploader } from './local-blob-uploader';
import { LocalMailClient } from './local-mail.client';
import { LocalSftpClientFactory } from './local-sftp.client';
import { IngestionMetadata } from '../../shared';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-adapters-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function meta(buffer: Buffer, name = 'invoice.pdf'): IngestionMetadata {
  return {
    sourceChannel: 'portal',
    originalName: name,
    mimeType: 'application/pdf',
    sizeBytes: buffer.length,
    contentHash: createHash('sha256').update(buffer).digest('hex'),
    ingestedAt: new Date().toISOString(),
    sourceMeta: {},
  };
}

describe('LocalBlobUploader', () => {
  it('writes the payload and a metadata sidecar into raw/', async () => {
    const uploader = new LocalBlobUploader(dir);
    const buffer = Buffer.from('pdf-bytes-1');

    const result = await uploader.upload({ buffer, metadata: meta(buffer) });

    expect(result.isDuplicate).toBe(false);
    expect(result.documentId).toMatch(/[0-9a-f-]{36}/);
    await expect(fs.readFile(result.blobPath)).resolves.toEqual(buffer);
    const sidecar = JSON.parse(await fs.readFile(`${result.blobPath}.meta.json`, 'utf8'));
    expect(sidecar.originalName).toBe('invoice.pdf');
  });

  it('deduplicates by content hash and returns the original documentId', async () => {
    const uploader = new LocalBlobUploader(dir);
    const buffer = Buffer.from('same-bytes');

    const first = await uploader.upload({ buffer, metadata: meta(buffer, 'a.pdf') });
    const second = await uploader.upload({ buffer, metadata: meta(buffer, 'b.pdf') });

    expect(second.isDuplicate).toBe(true);
    expect(second.documentId).toBe(first.documentId);
    const rawFiles = (await fs.readdir(path.join(dir, 'raw'))).filter(
      (f) => !f.endsWith('.meta.json'),
    );
    expect(rawFiles).toHaveLength(1);
  });

  it('persists the dedup index across instances (restart survival)', async () => {
    const buffer = Buffer.from('persistent-bytes');
    const first = await new LocalBlobUploader(dir).upload({ buffer, metadata: meta(buffer) });

    const second = await new LocalBlobUploader(dir).upload({ buffer, metadata: meta(buffer) });

    expect(second.isDuplicate).toBe(true);
    expect(second.documentId).toBe(first.documentId);
  });

  it('quarantines rejected files with a reason in the sidecar', async () => {
    const uploader = new LocalBlobUploader(dir);

    await uploader.quarantine(Buffer.from('bad'), { originalName: 'evil.exe' }, 'INVALID_TYPE');

    const files = await fs.readdir(path.join(dir, 'quarantine'));
    const payload = files.find((f) => !f.endsWith('.meta.json'));
    expect(payload).toContain('INVALID_TYPE');
    expect(payload).toContain('evil.exe');
  });

  it('sanitizes path-hostile original names', async () => {
    const uploader = new LocalBlobUploader(dir);
    const buffer = Buffer.from('tricky');

    const result = await uploader.upload({
      buffer,
      metadata: meta(buffer, '..\\..\\windows\\system32:evil.pdf'),
    });

    expect(path.dirname(result.blobPath)).toBe(path.join(dir, 'raw'));
  });
});

describe('LocalMailClient', () => {
  const MAILBOX = 'ap-test@local';

  async function seedMessage(
    msgId: string,
    attachments: Record<string, Buffer>,
    metaJson?: object,
  ): Promise<void> {
    const msgDir = path.join(dir, MAILBOX, msgId);
    await fs.mkdir(msgDir, { recursive: true });
    if (metaJson) {
      await fs.writeFile(path.join(msgDir, 'meta.json'), JSON.stringify(metaJson));
    }
    for (const [name, buffer] of Object.entries(attachments)) {
      await fs.writeFile(path.join(msgDir, name), buffer);
    }
  }

  it('returns an empty list when the mailbox directory does not exist', async () => {
    const client = new LocalMailClient(dir);
    await expect(client.fetchUnreadWithAttachments('missing@local')).resolves.toEqual([]);
  });

  it('reads messages with attachments and meta.json fields', async () => {
    await seedMessage(
      'msg-1',
      { 'invoice.pdf': Buffer.from('pdf') },
      { fromAddress: 'v@x.com', subject: 'Inv 1', receivedAt: '2026-06-01T00:00:00.000Z' },
    );
    const client = new LocalMailClient(dir);

    const messages = await client.fetchUnreadWithAttachments(MAILBOX);

    expect(messages).toHaveLength(1);
    expect(messages[0].fromAddress).toBe('v@x.com');
    expect(messages[0].subject).toBe('Inv 1');
    expect(messages[0].attachments).toHaveLength(1); // meta.json is not an attachment
    expect(messages[0].attachments[0].name).toBe('invoice.pdf');
    expect(messages[0].attachments[0].contentType).toBe('application/pdf');
    expect(messages[0].attachments[0].contentBytes).toEqual(Buffer.from('pdf'));
  });

  it('does not treat AP-* destination folders as unread messages', async () => {
    await seedMessage('msg-1', { 'a.pdf': Buffer.from('x') });
    const client = new LocalMailClient(dir);
    await client.markReadAndMove(MAILBOX, 'msg-1', 'AP-Processed');

    const messages = await client.fetchUnreadWithAttachments(MAILBOX);

    expect(messages).toEqual([]);
    await expect(
      fs.access(path.join(dir, MAILBOX, 'AP-Processed', 'msg-1', 'a.pdf')),
    ).resolves.toBeUndefined();
  });

  it('falls back to defaults when meta.json is missing or malformed', async () => {
    await seedMessage('msg-broken', { 'a.pdf': Buffer.from('x') });
    await fs.writeFile(path.join(dir, MAILBOX, 'msg-broken', 'meta.json'), 'not-json{');
    const client = new LocalMailClient(dir);

    const [message] = await client.fetchUnreadWithAttachments(MAILBOX);

    expect(message.fromAddress).toBe('vendor@example.com');
    expect(message.attachments).toHaveLength(1);
  });
});

describe('LocalSftpClientFactory', () => {
  it('lists only files, with posix remote paths and stat metadata', async () => {
    const plantDir = path.join(dir, 'incoming', 'welland');
    await fs.mkdir(path.join(plantDir, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(plantDir, 'scan.pdf'), Buffer.from('pdf-bytes'));
    const client = await new LocalSftpClientFactory(dir).connect();

    const files = await client.list('/incoming/welland');

    expect(files).toHaveLength(1); // subdir excluded
    expect(files[0]).toMatchObject({
      name: 'scan.pdf',
      path: '/incoming/welland/scan.pdf',
      sizeBytes: 9,
    });
    expect(files[0].modifiedAtMs).toBeGreaterThan(0);
  });

  it('returns an empty list for a directory that does not exist', async () => {
    const client = await new LocalSftpClientFactory(dir).connect();
    await expect(client.list('/incoming/nowhere')).resolves.toEqual([]);
  });

  it('round-trips get and delete through the remote path mapping', async () => {
    const plantDir = path.join(dir, 'incoming', 'welland');
    await fs.mkdir(plantDir, { recursive: true });
    await fs.writeFile(path.join(plantDir, 'scan.pdf'), Buffer.from('payload'));
    const client = await new LocalSftpClientFactory(dir).connect();

    await expect(client.get('/incoming/welland/scan.pdf')).resolves.toEqual(Buffer.from('payload'));
    await client.delete('/incoming/welland/scan.pdf');
    await expect(client.list('/incoming/welland')).resolves.toEqual([]);
    await expect(client.disconnect()).resolves.toBeUndefined();
  });
});
