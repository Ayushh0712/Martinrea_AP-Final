import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import {
  BLOB_UPLOAD_CLIENT,
  BlobUploadClient,
  EmptyFileError,
  FileTooLargeError,
  IngestionMetadata,
  InvalidFileTypeError,
  SourceChannel,
  UploadResult,
} from '../shared';

export interface ValidateAndHandoffInput {
  sourceChannel: SourceChannel;
  originalName: string;
  sourceMeta?: Record<string, unknown>;
}

/**
 * The funnel. Every channel (email, sftp, portal) ends up calling
 * `validateAndHandoff()` with a buffer + minimal source context. This is
 * the ONLY place validation lives -- if you find yourself duplicating
 * type/size checks elsewhere, fold them in here instead.
 *
 * Pipeline:
 *   1. Reject empty buffers.
 *   2. Reject buffers larger than MAX_FILE_BYTES.
 *   3. Detect MIME by magic bytes (NOT by file extension -- extensions lie).
 *   4. Reject if MIME not in ALLOWED_MIME_TYPES.
 *   5. Compute SHA-256 content hash for downstream dedup.
 *   6. Stamp metadata.
 *   7. Hand off to Roshni's BlobUploadClient.
 *   8. On any rejection, push to quarantine (best-effort; never throws).
 */
@Injectable()
export class PreProcessingService {
  private readonly logger = new Logger(PreProcessingService.name);
  private readonly maxBytes: number;
  private readonly allowedMime: ReadonlySet<string>;

  static readonly DEFAULT_ALLOWED_MIME =
    'application/pdf,image/jpeg,image/png,image/tiff,application/xml,text/xml';

  constructor(
    @Inject(BLOB_UPLOAD_CLIENT) private readonly blobClient: BlobUploadClient,
    config: ConfigService,
  ) {
    this.maxBytes = Number(config.get<string>('MAX_FILE_BYTES', '10485760'));
    const configured = config.get<string>('ALLOWED_MIME_TYPES', '') || '';
    const list = configured.length > 0 ? configured : PreProcessingService.DEFAULT_ALLOWED_MIME;
    this.allowedMime = new Set(
      list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  async validateAndHandoff(buffer: Buffer, input: ValidateAndHandoffInput): Promise<UploadResult> {
    if (!buffer || buffer.length === 0) {
      await this.tryQuarantine(buffer, input, 'EMPTY_FILE');
      throw new EmptyFileError();
    }

    if (buffer.length > this.maxBytes) {
      await this.tryQuarantine(buffer, input, 'FILE_TOO_LARGE');
      throw new FileTooLargeError(buffer.length, this.maxBytes);
    }

    const detected = await this.detectMime(buffer, input.originalName);
    if (!detected || !this.allowedMime.has(detected)) {
      await this.tryQuarantine(buffer, input, `INVALID_TYPE:${detected ?? 'unknown'}`);
      throw new InvalidFileTypeError(detected);
    }

    const contentHash = createHash('sha256').update(buffer).digest('hex');

    const metadata: IngestionMetadata = {
      sourceChannel: input.sourceChannel,
      originalName: input.originalName,
      mimeType: detected,
      sizeBytes: buffer.length,
      contentHash,
      ingestedAt: new Date().toISOString(),
      sourceMeta: input.sourceMeta ?? {},
    };

    const result = await this.blobClient.upload({ buffer, metadata });

    if (result.isDuplicate) {
      this.logger.log(
        `[${input.sourceChannel}] duplicate ignored: ${input.originalName} (${contentHash.slice(0, 12)}...)`,
      );
    } else {
      this.logger.log(
        `[${input.sourceChannel}] ingested: ${input.originalName} -> ${result.documentId} (${detected}, ${buffer.length} bytes)`,
      );
    }

    return result;
  }

  /**
   * Magic-byte detection via `file-type`. Falls back to checking for XML
   * declarations (CFDI .xml files), which `file-type` does not always
   * sniff reliably for tiny payloads.
   */
  private async detectMime(buffer: Buffer, originalName: string): Promise<string | undefined> {
    const ft = await fileTypeFromBuffer(buffer);
    if (ft?.mime) return ft.mime;

    const head = buffer.slice(0, 256).toString('utf8').trim();
    if (head.startsWith('<?xml') || /<cfdi:Comprobante/i.test(head)) {
      return originalName.toLowerCase().endsWith('.xml') ? 'application/xml' : 'application/xml';
    }
    return undefined;
  }

  private async tryQuarantine(
    buffer: Buffer | undefined,
    input: ValidateAndHandoffInput,
    reason: string,
  ): Promise<void> {
    try {
      if (buffer && buffer.length > 0) {
        await this.blobClient.quarantine(
          buffer,
          {
            sourceChannel: input.sourceChannel,
            originalName: input.originalName,
            sourceMeta: input.sourceMeta ?? {},
          },
          reason,
        );
      }
    } catch (err) {
      this.logger.warn(`Quarantine failed for ${input.originalName}: ${(err as Error).message}`);
    }
  }
}
