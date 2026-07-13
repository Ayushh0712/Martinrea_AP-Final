import { StagedDocument, UploadResult } from './ingestion.types';

/**
 * Contract owned by Roshni (Data & Repository Epic).
 *
 * Ayush's Ingestion Epic is the consumer. We never touch the database or
 * Azure Blob directly -- we hand a fully-validated StagedDocument to
 * `upload()` and trust Roshni's service to:
 *   1. Persist the binary in the appropriate Blob container.
 *   2. Insert the metadata row in PostgreSQL.
 *   3. Detect duplicates by `metadata.contentHash` (idempotent).
 *   4. Trigger the OCR queue (Abhay) for net-new documents.
 *
 * The production adapter lives under `src/ingestion/adapters/` -- create
 * either an `HttpBlobUploader` (Roshni's HTTP API) or an `AzureBlobUploader`
 * (@azure/storage-blob direct) and plug it into the `BLOB_UPLOAD_CLIENT`
 * useFactory in `ingestion.module.ts`.
 */
export interface BlobUploadClient {
  upload(doc: StagedDocument): Promise<UploadResult>;
  /**
   * Send a document that failed pre-processing to a quarantine container
   * so QA / ops can inspect it. Quarantined docs are NEVER linked into
   * the AP workflow.
   */
  quarantine(
    buffer: Buffer,
    metadata: Partial<StagedDocument['metadata']>,
    reason: string,
  ): Promise<void>;
}

export const BLOB_UPLOAD_CLIENT = Symbol('BlobUploadClient');
