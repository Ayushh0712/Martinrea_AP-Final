import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { BlobUploadClient, StagedDocument, UploadResult } from '../../shared';

/**
 * Filesystem-backed BlobUploadClient for INGESTION_PROFILE=local.
 *
 * Mirrors the behaviour the real backend (Roshni's API / Azure Blob) is
 * contracted to provide, so the rest of the pipeline cannot tell the
 * difference:
 *   - accepted docs   -> <baseDir>/raw/<documentId>-<name>  (+ .meta.json sidecar)
 *   - rejected docs   -> <baseDir>/quarantine/<timestamp>-<reason>-<name>
 *   - dedup           -> by metadata.contentHash, persisted in
 *                        <baseDir>/.hash-index.json so it survives restarts
 *                        (returns isDuplicate=true instead of writing twice)
 */
export class LocalBlobUploader implements BlobUploadClient {
  private readonly logger = new Logger(LocalBlobUploader.name);
  private readonly rawDir: string;
  private readonly quarantineDir: string;
  private readonly indexFile: string;

  constructor(private readonly baseDir: string) {
    this.rawDir = path.join(baseDir, 'raw');
    this.quarantineDir = path.join(baseDir, 'quarantine');
    this.indexFile = path.join(baseDir, '.hash-index.json');
  }

  async upload(doc: StagedDocument): Promise<UploadResult> {
    await fs.mkdir(this.rawDir, { recursive: true });

    const index = await this.loadIndex();
    const existing = index[doc.metadata.contentHash];
    if (existing) {
      return { documentId: existing.documentId, blobPath: existing.blobPath, isDuplicate: true };
    }

    const documentId = randomUUID();
    const blobName = `${documentId}-${sanitize(doc.metadata.originalName)}`;
    const blobPath = path.join(this.rawDir, blobName);

    await fs.writeFile(blobPath, doc.buffer);
    await fs.writeFile(`${blobPath}.meta.json`, JSON.stringify(doc.metadata, null, 2), 'utf8');

    index[doc.metadata.contentHash] = { documentId, blobPath };
    await this.saveIndex(index);

    return { documentId, blobPath, isDuplicate: false };
  }

  async quarantine(
    buffer: Buffer,
    metadata: Partial<StagedDocument['metadata']>,
    reason: string,
  ): Promise<void> {
    await fs.mkdir(this.quarantineDir, { recursive: true });
    const name = `${Date.now()}-${sanitize(reason)}-${sanitize(metadata.originalName ?? 'unnamed')}`;
    const filePath = path.join(this.quarantineDir, name);
    await fs.writeFile(filePath, buffer);
    await fs.writeFile(
      `${filePath}.meta.json`,
      JSON.stringify({ reason, ...metadata }, null, 2),
      'utf8',
    );
    this.logger.warn(`Quarantined ${metadata.originalName ?? 'unnamed'} (${reason})`);
  }

  private async loadIndex(): Promise<Record<string, { documentId: string; blobPath: string }>> {
    try {
      return JSON.parse(await fs.readFile(this.indexFile, 'utf8'));
    } catch {
      return {};
    }
  }

  private async saveIndex(
    index: Record<string, { documentId: string; blobPath: string }>,
  ): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(this.indexFile, JSON.stringify(index, null, 2), 'utf8');
  }
}

/** Windows-safe filename: strips path separators, colons, etc. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
