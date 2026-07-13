import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import {
  BLOB_UPLOAD_CLIENT,
  SFTP_CLIENT_FACTORY,
  SftpClient,
  SftpClientFactory,
  SftpRemoteFile,
} from '../shared';
import { PreProcessingService } from '../pre-processing/pre-processing.service';
import { SftpIngestionService } from './sftp-ingestion.service';
import { makePdf } from '../../../test/fixtures/file-bytes';

class InMemorySftp implements SftpClient {
  public disconnectCount = 0;
  constructor(private readonly files: Map<string, { buffer: Buffer; modifiedAtMs: number }>) {}
  async list(remotePath: string): Promise<SftpRemoteFile[]> {
    const out: SftpRemoteFile[] = [];
    for (const [p, v] of this.files.entries()) {
      if (!p.startsWith(remotePath)) continue;
      out.push({
        name: p.split('/').pop() as string,
        path: p,
        sizeBytes: v.buffer.length,
        modifiedAtMs: v.modifiedAtMs,
      });
    }
    return out;
  }
  async get(remotePath: string): Promise<Buffer> {
    const v = this.files.get(remotePath);
    if (!v) throw new Error('not found: ' + remotePath);
    return v.buffer;
  }
  async delete(remotePath: string): Promise<void> {
    this.files.delete(remotePath);
  }
  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
  }
}

class FakeFactory implements SftpClientFactory {
  constructor(public client: InMemorySftp) {}
  async connect(): Promise<SftpClient> {
    return this.client;
  }
}

class FakeBlob {
  public uploaded: string[] = [];
  public quarantined: Array<{ name: string; reason: string }> = [];
  public failNext = false;
  async upload(doc: { metadata: { originalName: string } }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('blob fail');
    }
    this.uploaded.push(doc.metadata.originalName);
    return { documentId: 'd' + this.uploaded.length, blobPath: 'x', isDuplicate: false };
  }
  async quarantine(
    _buffer: Buffer,
    meta: { originalName?: string },
    reason: string,
  ): Promise<void> {
    this.quarantined.push({ name: meta.originalName ?? 'unknown', reason });
  }
}

const buildModule = async (sftp: InMemorySftp, env: Record<string, string> = {}) => {
  const merged: Record<string, string> = {
    MAX_FILE_BYTES: '10485760',
    ALLOWED_MIME_TYPES: 'application/pdf,image/jpeg,image/png,image/tiff,application/xml,text/xml',
    SFTP_INCOMING_PATHS: '/incoming/welland',
    SFTP_PARTIAL_WRITE_GRACE_MS: '30000',
    ...env,
  };
  return Test.createTestingModule({
    providers: [
      SftpIngestionService,
      PreProcessingService,
      { provide: SFTP_CLIENT_FACTORY, useValue: new FakeFactory(sftp) },
      { provide: BLOB_UPLOAD_CLIENT, useValue: new FakeBlob() },
      { provide: ConfigService, useValue: { get: (k: string, d?: string) => merged[k] ?? d } },
      // onModuleInit not invoked in these tests (.compile() not .init()), but
      // the constructor still requires SchedulerRegistry.
      { provide: SchedulerRegistry, useValue: new SchedulerRegistry() },
    ],
  }).compile();
};

describe('SftpIngestionService', () => {
  it('downloads valid files, hands them to pre-processing, then deletes them from SFTP', async () => {
    const old = Date.now() - 60_000;
    const files = new Map([
      ['/incoming/welland/inv-001.pdf', { buffer: makePdf(), modifiedAtMs: old }],
      ['/incoming/welland/inv-002.pdf', { buffer: makePdf(), modifiedAtMs: old }],
    ]);
    const sftp = new InMemorySftp(files);
    const moduleRef = await buildModule(sftp);
    const service = moduleRef.get(SftpIngestionService);
    const blob = moduleRef.get(BLOB_UPLOAD_CLIENT) as unknown as FakeBlob;

    await service.pollPath('/incoming/welland');

    expect(blob.uploaded).toHaveLength(2);
    expect(files.size).toBe(0);
  });

  it('skips files modified within the partial-write grace window', async () => {
    const tooFresh = Date.now() - 5_000;
    const files = new Map([
      ['/incoming/welland/inv-fresh.pdf', { buffer: makePdf(), modifiedAtMs: tooFresh }],
    ]);
    const sftp = new InMemorySftp(files);
    const moduleRef = await buildModule(sftp);
    const service = moduleRef.get(SftpIngestionService);
    const blob = moduleRef.get(BLOB_UPLOAD_CLIENT) as unknown as FakeBlob;

    await service.pollPath('/incoming/welland');

    expect(blob.uploaded).toHaveLength(0);
    expect(files.size).toBe(1);
  });

  it('quarantines permanently rejected files and deletes them from SFTP', async () => {
    const old = Date.now() - 60_000;
    const garbage = Buffer.from('not-a-real-file');
    const files = new Map([['/incoming/welland/bad.pdf', { buffer: garbage, modifiedAtMs: old }]]);
    const sftp = new InMemorySftp(files);
    const moduleRef = await buildModule(sftp);
    const service = moduleRef.get(SftpIngestionService);
    const blob = moduleRef.get(BLOB_UPLOAD_CLIENT) as unknown as FakeBlob;

    await service.pollPath('/incoming/welland');

    expect(blob.uploaded).toHaveLength(0);
    expect(blob.quarantined).toHaveLength(1);
    expect(blob.quarantined[0].reason).toMatch(/^INVALID_TYPE/);
    expect(files.has('/incoming/welland/bad.pdf')).toBe(false);
  });

  it('downloads oversize files and quarantines them (audit trail) when below the hard ceiling', async () => {
    const old = Date.now() - 60_000;
    const big = Buffer.concat([makePdf(), Buffer.alloc(2048, 0)]);
    const files = new Map([['/incoming/welland/big.pdf', { buffer: big, modifiedAtMs: old }]]);
    const sftp = new InMemorySftp(files);
    const moduleRef = await buildModule(sftp, {
      MAX_FILE_BYTES: '1024',
      SFTP_HARD_CEILING_BYTES: '1048576',
    });
    const service = moduleRef.get(SftpIngestionService);
    const blob = moduleRef.get(BLOB_UPLOAD_CLIENT) as unknown as FakeBlob;

    await service.pollPath('/incoming/welland');

    expect(blob.uploaded).toHaveLength(0);
    expect(blob.quarantined).toHaveLength(1);
    expect(blob.quarantined[0].reason).toBe('FILE_TOO_LARGE');
    expect(files.has('/incoming/welland/big.pdf')).toBe(false);
  });

  it('skips files larger than the SFTP hard ceiling without downloading or quarantining', async () => {
    const old = Date.now() - 60_000;
    const huge = Buffer.concat([makePdf(), Buffer.alloc(8192, 0)]);
    const files = new Map([['/incoming/welland/huge.pdf', { buffer: huge, modifiedAtMs: old }]]);
    const sftp = new InMemorySftp(files);
    const moduleRef = await buildModule(sftp, {
      MAX_FILE_BYTES: '1024',
      SFTP_HARD_CEILING_BYTES: '2048',
    });
    const service = moduleRef.get(SftpIngestionService);
    const blob = moduleRef.get(BLOB_UPLOAD_CLIENT) as unknown as FakeBlob;

    await service.pollPath('/incoming/welland');

    expect(blob.uploaded).toHaveLength(0);
    expect(blob.quarantined).toHaveLength(0);
    expect(files.has('/incoming/welland/huge.pdf')).toBe(true);
  });

  it('leaves files on SFTP for transient (non-IngestionError) failures', async () => {
    const old = Date.now() - 60_000;
    const files = new Map([
      ['/incoming/welland/transient.pdf', { buffer: makePdf(), modifiedAtMs: old }],
    ]);
    const sftp = new InMemorySftp(files);
    const moduleRef = await buildModule(sftp);
    const service = moduleRef.get(SftpIngestionService);
    const blob = moduleRef.get(BLOB_UPLOAD_CLIENT) as unknown as FakeBlob;
    blob.failNext = true;

    await service.pollPath('/incoming/welland');

    expect(blob.uploaded).toHaveLength(0);
    expect(blob.quarantined).toHaveLength(0);
    expect(files.has('/incoming/welland/transient.pdf')).toBe(true);
  });

  it('always disconnects at the end of a poll (connect-per-poll contract)', async () => {
    const sftp = new InMemorySftp(new Map());
    const moduleRef = await buildModule(sftp);
    const service = moduleRef.get(SftpIngestionService);

    await service.pollPath('/incoming/welland');
    await service.pollPath('/incoming/welland');

    expect(sftp.disconnectCount).toBe(2);
  });
});
