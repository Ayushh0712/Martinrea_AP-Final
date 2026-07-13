import { Logger } from '@nestjs/common';
import { BlobUploadClient, StagedDocument, UploadResult } from '../../shared';

/**
 * BlobUploadClient that hands documents to the backend over HTTP
 * (BLOB_TRANSPORT=http) -- the integration point Mohd Aman wires the
 * ingestion service to the backend with.
 *
 * Assumed contract (see NEEDS.md item 1.1 -- confirm with the backend team):
 *   POST {baseUrl}/api/documents/upload
 *     body: { fileBase64, metadata }            -> 200/201 { documentId, blobPath, isDuplicate }
 *   POST {baseUrl}/api/documents/quarantine
 *     body: { fileBase64, metadata, reason }    -> 2xx
 *
 * Fails loudly at construction if BLOB_API_BASE_URL is missing so a
 * misconfigured deploy never silently drops invoices.
 */
export class HttpBlobUploader implements BlobUploadClient {
  private readonly logger = new Logger(HttpBlobUploader.name);

  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
  ) {
    if (!baseUrl) {
      throw new Error(
        'HttpBlobUploader requires BLOB_API_BASE_URL (the backend document API). ' +
          'Set it in .env or switch BLOB_TRANSPORT to "local".',
      );
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async upload(doc: StagedDocument): Promise<UploadResult> {
    const res = await this.post('/api/documents/upload', {
      fileBase64: doc.buffer.toString('base64'),
      metadata: doc.metadata,
    });

    const body = (await res.json()) as Partial<UploadResult>;
    if (!body.documentId) {
      throw new Error(
        `Backend upload response missing documentId (got: ${JSON.stringify(body).slice(0, 200)})`,
      );
    }
    return {
      documentId: body.documentId,
      blobPath: body.blobPath ?? '',
      isDuplicate: body.isDuplicate ?? false,
    };
  }

  async quarantine(
    buffer: Buffer,
    metadata: Partial<StagedDocument['metadata']>,
    reason: string,
  ): Promise<void> {
    await this.post('/api/documents/quarantine', {
      fileBase64: buffer.toString('base64'),
      metadata,
      reason,
    });
    this.logger.warn(`Quarantined ${metadata.originalName ?? 'unnamed'} via backend (${reason})`);
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Backend ${path} responded ${res.status}: ${text.slice(0, 300)}`);
    }
    return res;
  }
}
