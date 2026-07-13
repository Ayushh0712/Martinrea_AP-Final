import { createHash } from 'crypto';
import { HttpStatus } from '@nestjs/common';
import { OciParBlobUploader } from './oci-par-blob-uploader';
import { IngestionMetadata, StorageUnavailableError } from '../../shared';

const PAR = 'https://oci.example.test/p/token/n/ns/b/bucket/o/';

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

/** Minimal Response-shaped stub -- the uploader only touches ok/status/json. */
function resp(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

function transientError(): Error {
  // Shape of Node's native-fetch failure: a TypeError wrapping a socket cause.
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = { code: 'ECONNRESET', message: 'socket hang up' };
  return err;
}

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

describe('OciParBlobUploader resilience', () => {
  it('retries a transient network blip and then succeeds', async () => {
    const buffer = Buffer.from('pdf-bytes');
    let call = 0;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      call += 1;
      // First call (the dedup existence GET) fails once, mimicking the flaky
      // OCI connection that previously surfaced as an unhandled 500.
      if (call === 1) return Promise.reject(transientError());
      if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(resp(404));
      return Promise.resolve(resp(200));
    });

    const uploader = new OciParBlobUploader(PAR, { maxAttempts: 3, baseBackoffMs: 1 });
    const result = await uploader.upload({ buffer, metadata: meta(buffer) });

    expect(result.isDuplicate).toBe(false);
    expect(result.documentId).toMatch(/[0-9a-f-]{36}/);
    // GET retried once (2) + PUT raw (1) + PUT meta (1).
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns the original id (isDuplicate) when the meta object already exists', async () => {
    const buffer = Buffer.from('pdf-bytes');
    fetchMock.mockResolvedValue(
      resp(200, { documentId: 'existing-id', blobPath: 'raw/abc-invoice.pdf' }),
    );

    const uploader = new OciParBlobUploader(PAR, { maxAttempts: 3, baseBackoffMs: 1 });
    const result = await uploader.upload({ buffer, metadata: meta(buffer) });

    expect(result).toEqual({
      documentId: 'existing-id',
      blobPath: 'raw/abc-invoice.pdf',
      isDuplicate: true,
    });
    // Only the existence GET runs; no writes for a duplicate.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps exhausted transient failures to a 503 StorageUnavailableError', async () => {
    const buffer = Buffer.from('pdf-bytes');
    fetchMock.mockRejectedValue(transientError());

    const uploader = new OciParBlobUploader(PAR, { maxAttempts: 3, baseBackoffMs: 1 });

    await expect(uploader.upload({ buffer, metadata: meta(buffer) })).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear();
    fetchMock.mockRejectedValue(transientError());
    const caught = await uploader
      .upload({ buffer, metadata: meta(buffer) })
      .catch((e: StorageUnavailableError) => e);
    expect((caught as StorageUnavailableError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('does not retry a non-transient response (expired PAR) and fails as 503', async () => {
    const buffer = Buffer.from('pdf-bytes');
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(resp(404));
      return Promise.resolve(resp(401)); // PAR rejected the write
    });

    const uploader = new OciParBlobUploader(PAR, { maxAttempts: 3, baseBackoffMs: 1 });

    await expect(uploader.upload({ buffer, metadata: meta(buffer) })).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
    // 1 GET + exactly 1 PUT (no retry on a 4xx).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a hung request via the per-attempt timeout', async () => {
    const buffer = Buffer.from('pdf-bytes');
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const uploader = new OciParBlobUploader(PAR, { maxAttempts: 1, timeoutMs: 20 });

    await expect(uploader.upload({ buffer, metadata: meta(buffer) })).rejects.toThrow(
      /timed out/i,
    );
  });
});
