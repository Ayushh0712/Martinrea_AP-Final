import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import {
  BlobUploadClient,
  StagedDocument,
  StorageUnavailableError,
  UploadResult,
} from '../../shared';

export interface OciParBlobUploaderOptions {
  /** Per-attempt request timeout in ms (AbortController). Default 15s. */
  timeoutMs?: number;
  /** Total attempts per request (>=1). Default 3. */
  maxAttempts?: number;
  /** Base backoff between retries in ms (doubles each attempt). Default 300. */
  baseBackoffMs?: number;
  /**
   * Object-name prefix for accepted documents. Must match the workflow OCR
   * poller's OCI_AUTOINGEST_PREFIX. Default 'AP-Accepted_Correct/'. A trailing
   * slash is added if missing.
   */
  rawPrefix?: string;
  /**
   * Object-name prefix for rejected (quarantined) documents. Default
   * 'quarantine/'. A trailing slash is added if missing.
   */
  quarantinePrefix?: string;
  /**
   * Object-name prefix for the content-hash dedup records. Default 'meta/'.
   * Versioning this (e.g. 'meta-fresh/') resets dedup so previously-ingested
   * content can be re-ingested -- OCI PARs cannot delete the old records, so
   * pointing at a new prefix is the supported way to clear dedup. A trailing
   * slash is added if missing.
   */
  metaPrefix?: string;
}

/**
 * BlobUploadClient backed by an OCI Object Storage Pre-Authenticated
 * Request (BLOB_TRANSPORT=par) -- the team's shared POC bucket.
 *
 * A PAR is a tokenized base URL that accepts plain HTTP against the bucket:
 *   PUT  {par}{objectName}   upload raw bytes
 *   GET  {par}{objectName}   download / existence check (404 when absent)
 *
 * Object layout in the bucket:
 *   AP-Accepted_Correct/<hash12>-<originalName>  accepted document payload
 *   meta/<contentHash>.json              dedup record, keyed by hash ONLY:
 *                                        { documentId, blobPath, metadata }
 *   quarantine/<ts>-<reason>-<name>      rejected payloads (+ .meta.json)
 *
 * Dedup contract: before uploading we GET meta/<contentHash>.json. A 200
 * means this exact content was ingested before (regardless of filename or
 * channel) -- we return the ORIGINAL documentId with isDuplicate=true and
 * upload nothing. Only after a successful payload PUT do we write the meta
 * object, so a half-failed upload is retried, never half-deduped.
 *
 * NOTE: PARs expire (set at creation in the OCI console). When uploads
 * suddenly return 401/404, check the PAR's expiry first.
 */
export class OciParBlobUploader implements BlobUploadClient {
  private readonly logger = new Logger(OciParBlobUploader.name);
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly rawPrefix: string;
  private readonly quarantinePrefix: string;
  private readonly metaPrefix: string;

  constructor(
    private readonly parBaseUrl: string,
    options: OciParBlobUploaderOptions = {},
  ) {
    if (!parBaseUrl) {
      throw new Error(
        'OciParBlobUploader requires BLOB_PAR_BASE_URL (the OCI pre-authenticated ' +
          'request URL ending in /o/). Set it in .env or switch BLOB_TRANSPORT.',
      );
    }
    this.parBaseUrl = parBaseUrl.endsWith('/') ? parBaseUrl : `${parBaseUrl}/`;
    this.timeoutMs = positiveOr(options.timeoutMs, 15_000);
    this.maxAttempts = Math.max(1, Math.trunc(positiveOr(options.maxAttempts, 3)));
    this.baseBackoffMs = positiveOr(options.baseBackoffMs, 300);
    const prefix = (options.rawPrefix ?? 'AP-Accepted_Correct/').trim();
    this.rawPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const qPrefix = (options.quarantinePrefix ?? 'quarantine/').trim();
    this.quarantinePrefix = qPrefix.endsWith('/') ? qPrefix : `${qPrefix}/`;
    const mPrefix = (options.metaPrefix ?? 'meta/').trim();
    this.metaPrefix = mPrefix.endsWith('/') ? mPrefix : `${mPrefix}/`;
  }

  async upload(doc: StagedDocument): Promise<UploadResult> {
    const metaObject = `${this.metaPrefix}${doc.metadata.contentHash}.json`;

    const existing = await this.getJson<UploadResult & { metadata: unknown }>(metaObject);
    if (existing) {
      return {
        documentId: existing.documentId,
        blobPath: existing.blobPath,
        isDuplicate: true,
      };
    }

    const documentId = randomUUID();
    const blobPath = `${this.rawPrefix}${doc.metadata.contentHash.slice(0, 12)}-${sanitize(doc.metadata.originalName)}`;

    await this.put(blobPath, doc.buffer, doc.metadata.mimeType);
    await this.put(
      metaObject,
      Buffer.from(JSON.stringify({ documentId, blobPath, metadata: doc.metadata }, null, 2)),
      'application/json',
    );

    this.logger.log(`Uploaded ${doc.metadata.originalName} -> ${blobPath}`);
    return { documentId, blobPath, isDuplicate: false };
  }

  async quarantine(
    buffer: Buffer,
    metadata: Partial<StagedDocument['metadata']>,
    reason: string,
  ): Promise<void> {
    const name = `${this.quarantinePrefix}${Date.now()}-${sanitize(reason)}-${sanitize(metadata.originalName ?? 'unnamed')}`;
    await this.put(name, buffer, metadata.mimeType ?? 'application/octet-stream');
    await this.put(
      `${name}.meta.json`,
      Buffer.from(JSON.stringify({ reason, ...metadata }, null, 2)),
      'application/json',
    );
    this.logger.warn(`Quarantined ${metadata.originalName ?? 'unnamed'} -> ${name} (${reason})`);
  }

  private async put(objectName: string, body: Buffer, contentType: string): Promise<void> {
    await this.ociFetch(
      this.parBaseUrl + encodeObjectName(objectName),
      {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(body),
      },
      `PAR PUT ${objectName}`,
    );
  }

  /** Returns the parsed object, or undefined when the object doesn't exist. */
  private async getJson<T>(objectName: string): Promise<T | undefined> {
    const res = await this.ociFetch(
      this.parBaseUrl + encodeObjectName(objectName),
      { method: 'GET' },
      `PAR GET ${objectName}`,
      { allow404: true },
    );
    if (res.status === 404) return undefined;
    return (await res.json()) as T;
  }

  /**
   * Single choke-point for every OCI request. Adds the resilience the bare
   * `fetch` lacked, which is why a flaky connection used to bubble up as an
   * unhandled `TypeError: fetch failed` -> generic HTTP 500:
   *
   *   - Per-attempt timeout (AbortController) so a stalled socket fails fast
   *     instead of hanging on undici's long default timeouts.
   *   - Retry-with-backoff on transient failures (network errors, timeouts,
   *     and 5xx). All PAR ops are idempotent -- GETs are reads and the meta
   *     object is only written after a successful payload PUT -- so retrying
   *     is safe.
   *   - On genuine exhaustion or a non-retryable response (e.g. an expired
   *     PAR returning 401/403/404 on a write), throws StorageUnavailableError
   *     (HTTP 503) with a readable message instead of leaking a raw fetch error.
   */
  private async ociFetch(
    url: string,
    init: RequestInit,
    description: string,
    opts: { allow404?: boolean } = {},
  ): Promise<Response> {
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });

        if (opts.allow404 && res.status === 404) return res;
        if (res.ok) return res;

        // 5xx is transient (retry); anything else (401/403/404 on a write,
        // etc.) is a configuration/PAR problem we should not hammer.
        if (res.status < 500) {
          throw new StorageUnavailableError(
            `${description} returned HTTP ${res.status}` +
              (res.status === 401 || res.status === 403 || res.status === 404
                ? ' -- the OCI PAR may have expired (regenerate it in the OCI console).'
                : '.'),
          );
        }
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        if (err instanceof StorageUnavailableError) throw err;
        lastError = describeFetchError(err);
        this.logger.warn(
          `${description} attempt ${attempt}/${this.maxAttempts} failed: ${lastError}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.maxAttempts) await this.backoff(attempt);
    }

    throw new StorageUnavailableError(
      `${description} failed after ${this.maxAttempts} attempt(s): ${lastError}.`,
    );
  }

  private backoff(attempt: number): Promise<void> {
    const ms = this.baseBackoffMs * 2 ** (attempt - 1);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Native fetch hides the real cause behind a terse `TypeError: fetch failed`;
 * dig out the underlying socket error (ECONNRESET, ETIMEDOUT, ENOTFOUND, ...)
 * and name aborts as timeouts so logs and the 503 body are actionable.
 */
function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'request timed out';
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return `${err.message} (${cause.code})`;
    if (cause?.message) return `${err.message}: ${cause.message}`;
    return err.message;
  }
  return String(err);
}

/** Keep `/` (bucket folder separator), encode everything else per segment. */
function encodeObjectName(objectName: string): string {
  return objectName.split('/').map(encodeURIComponent).join('/');
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
