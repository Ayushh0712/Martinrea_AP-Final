import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  BLOB_UPLOAD_CLIENT,
  BlobUploadClient,
  EmptyFileError,
  FileTooLargeError,
  InvalidFileTypeError,
  StagedDocument,
  UploadResult,
} from '../shared';
import { PreProcessingService } from './pre-processing.service';
import { makeJpeg, makePdf, makePng, makeXml } from '../../../test/fixtures/file-bytes';

class FakeBlobClient implements BlobUploadClient {
  public uploaded: StagedDocument[] = [];
  public quarantined: { reason: string; size: number }[] = [];
  public nextDuplicate = false;
  public failNext = false;

  async upload(doc: StagedDocument): Promise<UploadResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('blob unreachable');
    }
    this.uploaded.push(doc);
    return {
      documentId: `doc-${this.uploaded.length}`,
      blobPath: `invoices-raw/${doc.metadata.contentHash}`,
      isDuplicate: this.nextDuplicate,
    };
  }

  async quarantine(buffer: Buffer, _meta: unknown, reason: string): Promise<void> {
    this.quarantined.push({ reason, size: buffer.length });
  }
}

const makeService = async (overrides: Record<string, string> = {}) => {
  const blob = new FakeBlobClient();
  const env: Record<string, string> = {
    MAX_FILE_BYTES: '10485760',
    ALLOWED_MIME_TYPES: 'application/pdf,image/jpeg,image/png,image/tiff,application/xml,text/xml',
    ...overrides,
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      PreProcessingService,
      { provide: BLOB_UPLOAD_CLIENT, useValue: blob },
      { provide: ConfigService, useValue: { get: (k: string, d?: string) => env[k] ?? d } },
    ],
  }).compile();
  return { service: moduleRef.get(PreProcessingService), blob };
};

describe('PreProcessingService', () => {
  it('accepts a valid PDF and hands it off to the blob client', async () => {
    const { service, blob } = await makeService();
    const result = await service.validateAndHandoff(makePdf(), {
      sourceChannel: 'portal',
      originalName: 'invoice.pdf',
      sourceMeta: { uploadedBy: 'marcus' },
    });

    expect(result.documentId).toBe('doc-1');
    expect(blob.uploaded).toHaveLength(1);
    const stamped = blob.uploaded[0].metadata;
    expect(stamped.sourceChannel).toBe('portal');
    expect(stamped.originalName).toBe('invoice.pdf');
    expect(stamped.mimeType).toBe('application/pdf');
    expect(stamped.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stamped.sourceMeta).toEqual({ uploadedBy: 'marcus' });
  });

  it('accepts JPEG, PNG and CFDI-style XML', async () => {
    const { service, blob } = await makeService();
    await service.validateAndHandoff(makeJpeg(), { sourceChannel: 'email', originalName: 'a.jpg' });
    await service.validateAndHandoff(makePng(), { sourceChannel: 'email', originalName: 'b.png' });
    await service.validateAndHandoff(makeXml(), { sourceChannel: 'email', originalName: 'c.xml' });
    expect(blob.uploaded.map((d) => d.metadata.mimeType)).toEqual([
      'image/jpeg',
      'image/png',
      'application/xml',
    ]);
  });

  it('rejects empty buffers with EmptyFileError', async () => {
    const { service, blob } = await makeService();
    await expect(
      service.validateAndHandoff(Buffer.alloc(0), {
        sourceChannel: 'portal',
        originalName: 'empty.pdf',
      }),
    ).rejects.toBeInstanceOf(EmptyFileError);
    expect(blob.uploaded).toHaveLength(0);
  });

  it('rejects oversized buffers with FileTooLargeError and quarantines', async () => {
    const { service, blob } = await makeService({ MAX_FILE_BYTES: '1024' });
    const big = Buffer.concat([makePdf(), Buffer.alloc(2048, 0)]);
    await expect(
      service.validateAndHandoff(big, { sourceChannel: 'sftp', originalName: 'big.pdf' }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(blob.uploaded).toHaveLength(0);
    expect(blob.quarantined[0].reason).toBe('FILE_TOO_LARGE');
  });

  it('rejects disallowed MIME types (e.g. .exe renamed to .pdf)', async () => {
    const { service, blob } = await makeService();
    const exe = Buffer.from(
      'MZ\x90\x00\x03\x00\x00\x00This-is-actually-a-windows-exe-payload-padded-to-look-bigger-please',
    );
    await expect(
      service.validateAndHandoff(exe, { sourceChannel: 'portal', originalName: 'sneaky.pdf' }),
    ).rejects.toBeInstanceOf(InvalidFileTypeError);
    expect(blob.uploaded).toHaveLength(0);
    expect(blob.quarantined[0].reason).toMatch(/^INVALID_TYPE:/);
  });

  it('treats duplicate uploads from blob client as a successful no-op', async () => {
    const { service, blob } = await makeService();
    blob.nextDuplicate = true;
    const result = await service.validateAndHandoff(makePdf(), {
      sourceChannel: 'sftp',
      originalName: 'dup.pdf',
    });
    expect(result.isDuplicate).toBe(true);
    expect(blob.uploaded).toHaveLength(1);
  });

  it('produces identical content hashes for identical buffers', async () => {
    const { service, blob } = await makeService();
    const pdf = makePdf();
    await service.validateAndHandoff(pdf, { sourceChannel: 'email', originalName: '1.pdf' });
    await service.validateAndHandoff(pdf, { sourceChannel: 'sftp', originalName: '2.pdf' });
    expect(blob.uploaded[0].metadata.contentHash).toBe(blob.uploaded[1].metadata.contentHash);
  });
});
