/**
 * Source channel an invoice arrived through. Stamped on every document
 * so downstream services (matching, KPI dashboards) can attribute it.
 */
export type SourceChannel = 'email' | 'sftp' | 'portal';

/**
 * Sanitised metadata stamped onto every ingested document before it
 * leaves the Ingestion Epic and lands in Roshni's Blob storage.
 */
export interface IngestionMetadata {
  sourceChannel: SourceChannel;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  ingestedAt: string;
  sourceMeta: Record<string, unknown>;
}

/**
 * The full payload Ayush hands to Roshni's BlobUploadClient.
 */
export interface StagedDocument {
  buffer: Buffer;
  metadata: IngestionMetadata;
}

/**
 * Response shape returned by Roshni's BlobUploadClient.
 * `isDuplicate=true` means the content hash matched an existing row;
 * the caller should treat this as a successful no-op, not an error.
 */
export interface UploadResult {
  documentId: string;
  blobPath: string;
  isDuplicate: boolean;
}

/**
 * Quarantine reasons for files that failed pre-processing. These are
 * recorded alongside the bad file so QA / ops can inspect later.
 */
export type QuarantineReason = 'INVALID_TYPE' | 'FILE_TOO_LARGE' | 'EMPTY_FILE' | 'UNREADABLE';
