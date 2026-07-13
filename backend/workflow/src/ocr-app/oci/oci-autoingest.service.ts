import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UPLOAD_SUBFOLDERS } from '../common/constants';
import {
  ExtractionStoreService,
  StoredExtraction,
} from '../extractions/extraction-store.service';
import { FilesService } from '../files/files.service';
import { InvoicesService } from '../invoices/invoices.service';
import { OcrService } from '../ocr/ocr.service';
import { OcrParserService } from '../ocr/parser/ocr-parser.service';
import { OciService } from './oci.service';

const SUPPORTED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff']);
const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/**
 * OCI source poller. Ingestion writes validated documents to the shared OCI
 * bucket; this poller pulls any NEW objects from the source folder, runs OCR +
 * field parsing on them, and stores the result in memory for review. No DB is
 * involved — persistence is deferred to a later phase.
 *
 * Source folder: `AP-Accepted_Correct/` (override via OCI_AUTOINGEST_PREFIX).
 *
 * Idempotency, three layers:
 *   1. In-process: dedup on the full object name via ExtractionStoreService.
 *   2. Durable marker objects: once a document is persisted (sent for matching
 *      or rejected) a `ocr-processed/<basename>.json` marker is PUT to the
 *      bucket (prefix via OCI_PROCESSED_PREFIX). Markers survive restarts AND
 *      database resets (seed:reset truncates invoices, which used to resurrect
 *      every previously-triaged document in the OCR queue).
 *   3. Database check on the stored filename
 *      (InvoicesService.existsByOriginalFilename). A DB hit without a marker
 *      also self-heals: the missing marker is written so the exclusion becomes
 *      durable for rows persisted before markers existed.
 *
 * Toggle with OCI_AUTOINGEST_ENABLED; cadence via OCI_AUTOINGEST_CRON.
 */
@Injectable()
export class OciAutoIngestService {
  private readonly logger = new Logger(OciAutoIngestService.name);
  private readonly enabled: boolean;
  private readonly prefix: string;
  private readonly processedPrefix: string;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly oci: OciService,
    private readonly files: FilesService,
    private readonly ocr: OcrService,
    private readonly parser: OcrParserService,
    private readonly store: ExtractionStoreService,
    private readonly invoices: InvoicesService,
  ) {
    this.enabled = ['1', 'true', 'yes', 'on'].includes(
      (this.config.get<string>('OCI_AUTOINGEST_ENABLED') ?? 'false').toLowerCase(),
    );
    this.prefix =
      this.config.get<string>('OCI_AUTOINGEST_PREFIX') ?? 'AP-Accepted_Correct/';
    const processed =
      this.config.get<string>('OCI_PROCESSED_PREFIX') ?? 'ocr-processed/';
    this.processedPrefix = processed.endsWith('/') ? processed : `${processed}/`;
    this.logger.log(
      `OCI auto-ingest ${this.enabled ? 'ENABLED' : 'disabled'} ` +
        `(prefix="${this.prefix}", markers="${this.processedPrefix}")`,
    );
  }

  @Cron(process.env.OCI_AUTOINGEST_CRON || '0 */2 * * * *', {
    name: 'oci-autoingest',
  })
  async poll(): Promise<void> {
    if (!this.enabled) return;
    await this.runScan();
  }

  /**
   * Scan the source folder once and OCR-extract any new documents into the
   * in-memory store. Shared by the cron `poll()` and the on-demand scan trigger
   * so a freshly-uploaded document is extracted immediately instead of waiting
   * for the next poll tick. Dedup on the object name keeps it idempotent.
   *
   * Unlike `poll()`, this ignores the `enabled` flag — an explicit on-demand
   * request should always run — but it still respects the `running` guard.
   */
  async runScan(): Promise<{ ingested: number; skipped: number; scanned: number }> {
    if (this.running) {
      this.logger.debug('Previous auto-ingest run still in progress — skipping');
      return { ingested: 0, skipped: 0, scanned: 0 };
    }
    this.running = true;
    try {
      const docs = await this.oci.listDocuments(this.prefix);
      if (docs.length === 0) return { ingested: 0, skipped: 0, scanned: 0 };

      const processedBasenames = await this.listProcessedBasenames();

      let ingested = 0;
      let skipped = 0;
      for (const doc of docs) {
        const ext = path.extname(doc.name).toLowerCase();
        if (!SUPPORTED_EXT.has(ext)) continue;

        if (this.store.hasObject(doc.name)) {
          skipped++;
          continue;
        }

        const basename = path.basename(doc.name);

        // Durable marker: this document was already persisted (sent for
        // matching or rejected) in some past run. Survives DB resets.
        if (processedBasenames.has(basename)) {
          this.store.markObject(doc.name);
          skipped++;
          continue;
        }

        // A document already committed or rejected lives in the invoices table
        // (originalFilename is the object basename). Skip it, cache the hit in
        // the in-memory index, and self-heal the missing durable marker so the
        // exclusion survives future DB resets too.
        if (await this.invoices.existsByOriginalFilename(basename)) {
          this.store.markObject(doc.name);
          await this.markProcessed(basename, {
            sourceObjectName: doc.name,
            reason: 'self-heal: invoice row exists without a marker',
          });
          skipped++;
          continue;
        }

        try {
          await this.ingestObject(doc.name, ext);
          ingested++;
        } catch (err) {
          this.logger.error(
            `Auto-ingest failed for ${doc.name}: ${(err as Error).message}`,
          );
        }
      }

      if (ingested > 0 || skipped > 0) {
        this.logger.log(
          `OCI auto-ingest: ${ingested} new, ${skipped} already-extracted (scanned ${docs.length})`,
        );
      }
      return { ingested, skipped, scanned: docs.length };
    } catch (err) {
      this.logger.warn(`OCI auto-ingest scan error: ${(err as Error).message}`);
      return { ingested: 0, skipped: 0, scanned: 0 };
    } finally {
      this.running = false;
    }
  }

  /**
   * Write the durable "already processed" marker for a document:
   * `<processedPrefix><basename>.json`. Best-effort by design — a marker
   * failure must never fail the caller (the invoice row still excludes the
   * document, and the next scan self-heals the marker).
   */
  async markProcessed(
    basename: string,
    info: Record<string, unknown> = {},
  ): Promise<void> {
    const markerName = `${this.processedPrefix}${basename}.json`;
    try {
      await this.oci.putObject(
        markerName,
        Buffer.from(
          JSON.stringify({ basename, processedAt: new Date().toISOString(), ...info }, null, 2),
        ),
        'application/json',
      );
      this.logger.log(`Marked ${basename} as processed (${markerName})`);
    } catch (err) {
      this.logger.warn(
        `Could not write processed marker ${markerName}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Basenames of every document with a durable processed marker. A listing
   * failure degrades gracefully to an empty set — the DB check still applies.
   */
  private async listProcessedBasenames(): Promise<Set<string>> {
    try {
      const { objects } = await this.oci.listObjects(this.processedPrefix);
      const basenames = new Set<string>();
      for (const obj of objects) {
        const name = path.basename(obj.name);
        if (name.endsWith('.json')) basenames.add(name.slice(0, -'.json'.length));
      }
      return basenames;
    } catch (err) {
      this.logger.warn(
        `Could not list processed markers under ${this.processedPrefix}: ${(err as Error).message}`,
      );
      return new Set();
    }
  }

  /**
   * Download one OCI object, run OCR + field parsing, and store the result in
   * memory. Returns the stored extraction. The temp file is always removed.
   */
  async ingestObject(objectName: string, ext?: string): Promise<StoredExtraction> {
    const extension = (ext ?? path.extname(objectName)).toLowerCase();
    const stagingDir = this.files.getSubfolderPath(UPLOAD_SUBFOLDERS.STAGING);
    const localPath = await this.oci.downloadToTmp(objectName, stagingDir);

    try {
      const stat = await fs.stat(localPath);
      const ocrResult = await this.ocr.recognize(localPath);
      const fields = this.parser.parse({
        rawText: ocrResult.text,
        ocrConfidence: ocrResult.confidence,
        tokens: ocrResult.tokens,
      });

      const stored = this.store.add({
        sourceObjectName: objectName,
        originalFilename: path.basename(objectName),
        mimeType: MIME_MAP[extension] ?? 'application/octet-stream',
        fileSize: stat.size,
        ocrConfidence: ocrResult.confidence,
        viewUrl: this.oci.getViewUrl(objectName),
        fields,
      });

      this.logger.log(
        `Extracted OCI object ${objectName} -> extraction ${stored.id}`,
      );
      return stored;
    } finally {
      await this.files.deleteIfExists(localPath);
    }
  }
}
