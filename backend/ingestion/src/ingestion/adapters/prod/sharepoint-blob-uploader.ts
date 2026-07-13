import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { BlobUploadClient, StagedDocument, UploadResult } from '../../shared';
import { GraphDriveClient, GraphDriveClientOptions } from './graph-drive.client';

export interface SharePointBlobUploaderOptions extends GraphDriveClientOptions {
  /**
   * Base folder inside the drive that the whole AP pipeline lives under.
   * Default 'AP-Ingestion'. The OCR poller (workflow service) must scan the
   * SAME root + raw prefix.
   */
  rootFolder?: string;
  /** Subfolder (under rootFolder) for accepted documents. Default 'raw'. */
  rawPrefix?: string;
}

/**
 * BlobUploadClient backed by a SharePoint document library / OneDrive drive via
 * Microsoft Graph (BLOB_TRANSPORT=sharepoint).
 *
 * Validated documents are written into the configured drive folder, where the
 * workflow OCR poller lists + fetches them (skipping anything already ingested).
 * This is the Graph equivalent of the OCI PAR adapter; the object layout and the
 * content-hash dedup contract are identical so nothing downstream changes:
 *
 *   <root>/raw/<hash12>-<originalName>        accepted document payload
 *   <root>/meta/<contentHash>.json           dedup record { documentId, blobPath, metadata }
 *   <root>/quarantine/<ts>-<reason>-<name>   rejected payloads (+ .meta.json)
 *
 * Dedup: before uploading we read meta/<hash>.json. A hit means this exact
 * content was ingested before (regardless of filename / channel) -- we return
 * the ORIGINAL documentId with isDuplicate=true and upload nothing. The meta
 * object is written only AFTER the payload PUT succeeds, so a half-failed upload
 * is retried, never half-deduped.
 *
 * NOTE: the provided SharePoint *sharing link* (".../:u:/g/personal/.../<id>")
 * CANNOT be used here -- it addresses a single file, not a writable container.
 * This adapter needs an app registration (SP_GRAPH_* or GRAPH_*) and the target
 * drive id (SP_DRIVE_ID). See backend/ingestion/.env.example.
 */
export class SharePointBlobUploader implements BlobUploadClient {
  private readonly logger = new Logger(SharePointBlobUploader.name);
  private readonly drive: GraphDriveClient;
  private readonly rootFolder: string;
  private readonly rawPrefix: string;

  constructor(options: SharePointBlobUploaderOptions) {
    this.drive = new GraphDriveClient(options);
    this.rootFolder = trimSlashes(options.rootFolder ?? 'AP-Ingestion');
    this.rawPrefix = trimSlashes(options.rawPrefix ?? 'raw');
  }

  async upload(doc: StagedDocument): Promise<UploadResult> {
    const metaObject = `${this.rootFolder}/meta/${doc.metadata.contentHash}.json`;

    const existing = await this.drive.getJson<UploadResult & { metadata: unknown }>(metaObject);
    if (existing) {
      return {
        documentId: existing.documentId,
        blobPath: existing.blobPath,
        isDuplicate: true,
      };
    }

    const documentId = randomUUID();
    const blobPath = `${this.rootFolder}/${this.rawPrefix}/${doc.metadata.contentHash.slice(0, 12)}-${sanitize(doc.metadata.originalName)}`;

    await this.drive.putContent(blobPath, doc.buffer, doc.metadata.mimeType);
    await this.drive.putContent(
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
    const name = `${this.rootFolder}/quarantine/${Date.now()}-${sanitize(reason)}-${sanitize(metadata.originalName ?? 'unnamed')}`;
    await this.drive.putContent(name, buffer, metadata.mimeType ?? 'application/octet-stream');
    await this.drive.putContent(
      `${name}.meta.json`,
      Buffer.from(JSON.stringify({ reason, ...metadata }, null, 2)),
      'application/json',
    );
    this.logger.warn(`Quarantined ${metadata.originalName ?? 'unnamed'} -> ${name} (${reason})`);
  }
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
