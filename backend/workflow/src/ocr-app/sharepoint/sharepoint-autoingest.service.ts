import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UPLOAD_SUBFOLDERS } from '../common/constants';
import { FilesService } from '../files/files.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SharePointService } from './sharepoint.service';

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
 * Cross-service link (SharePoint variant of OciAutoIngestService): the ingestion
 * service writes validated documents to a SharePoint/OneDrive drive folder under
 * <root>/raw/. This poller pulls any NEW objects into the OCR pipeline — the same
 * path a direct upload takes (RECEIVED -> OCR_PROCESSING -> ...). The drive folder
 * is the contract; no message bus required.
 *
 * Idempotency ("if not already in the queue"): ingestion names objects
 * `raw/<hash12>-<name>`, so we dedup on the basename via
 * InvoicesService.existsByOriginalFilename — an object is processed exactly once,
 * even across restarts.
 *
 * Toggle with SP_AUTOINGEST_ENABLED; cadence via SP_AUTOINGEST_CRON; folder via
 * SP_AUTOINGEST_PREFIX (default `raw/`). Leave disabled to keep OCI as the source.
 */
@Injectable()
export class SharePointAutoIngestService {
  private readonly logger = new Logger(SharePointAutoIngestService.name);
  private readonly enabled: boolean;
  private readonly prefix: string;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly sharePoint: SharePointService,
    private readonly files: FilesService,
    private readonly invoices: InvoicesService,
  ) {
    this.enabled = ['1', 'true', 'yes', 'on'].includes(
      (this.config.get<string>('SP_AUTOINGEST_ENABLED') ?? 'false').toLowerCase(),
    );
    this.prefix = this.config.get<string>('SP_AUTOINGEST_PREFIX') ?? 'raw/';
    this.logger.log(
      `SharePoint auto-ingest ${this.enabled ? 'ENABLED' : 'disabled'} (prefix="${this.prefix}")`,
    );
  }

  @Cron(process.env.SP_AUTOINGEST_CRON || '0 */2 * * * *', {
    name: 'sharepoint-autoingest',
  })
  async poll(): Promise<void> {
    if (!this.enabled) return;
    await this.runScan();
  }

  /**
   * List the SharePoint raw/ folder once and enqueue any new documents for OCR.
   * Shared by the cron `poll()` and the on-demand `POST /api/ocr/sharepoint/scan`
   * trigger so a freshly-uploaded document enters OCR immediately instead of
   * waiting for the next poll tick. Dedup on basename keeps it idempotent.
   *
   * Unlike `poll()`, this ignores the `enabled` flag — an explicit on-demand
   * request should always run — but it still respects the `running` guard and
   * the configured-Graph check.
   */
  async runScan(): Promise<{ ingested: number; skipped: number; scanned: number }> {
    if (!this.sharePoint.isConfigured()) {
      this.logger.warn(
        'SharePoint scan requested but Graph drive is not configured ' +
          '(need SP_DRIVE_ID + SP_GRAPH_*/GRAPH_* creds) — nothing to scan.',
      );
      return { ingested: 0, skipped: 0, scanned: 0 };
    }
    if (this.running) {
      this.logger.debug('Previous SharePoint auto-ingest run still in progress — skipping');
      return { ingested: 0, skipped: 0, scanned: 0 };
    }
    this.running = true;
    try {
      const docs = await this.sharePoint.listDocuments(this.prefix);
      if (docs.length === 0) return { ingested: 0, skipped: 0, scanned: 0 };

      let ingested = 0;
      let skipped = 0;
      for (const doc of docs) {
        const ext = path.extname(doc.name).toLowerCase();
        if (!SUPPORTED_EXT.has(ext)) continue;

        const storedName = path.basename(doc.name);
        if (await this.invoices.existsByOriginalFilename(storedName)) {
          skipped++;
          continue;
        }

        try {
          await this.ingestOne(doc.name, ext, doc.downloadUrl);
          ingested++;
        } catch (err) {
          this.logger.error(
            `SharePoint auto-ingest failed for ${doc.name}: ${(err as Error).message}`,
          );
        }
      }

      if (ingested > 0 || skipped > 0) {
        this.logger.log(
          `SharePoint auto-ingest: ${ingested} new, ${skipped} already-ingested (scanned ${docs.length})`,
        );
      }
      return { ingested, skipped, scanned: docs.length };
    } catch (err) {
      this.logger.warn(`SharePoint auto-ingest poll error: ${(err as Error).message}`);
      return { ingested: 0, skipped: 0, scanned: 0 };
    } finally {
      this.running = false;
    }
  }

  private async ingestOne(objectName: string, ext: string, downloadUrl?: string): Promise<void> {
    const rawDir = this.files.getSubfolderPath(UPLOAD_SUBFOLDERS.RAW);
    const localPath = await this.sharePoint.downloadToTmp(objectName, rawDir, downloadUrl);

    const stat = await fs.stat(localPath);
    const syntheticFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: path.basename(objectName),
      encoding: '7bit',
      mimetype: MIME_MAP[ext] ?? 'application/octet-stream',
      size: stat.size,
      buffer: await fs.readFile(localPath),
      destination: rawDir,
      filename: path.basename(localPath),
      path: localPath,
      stream: null as never,
    };

    // Remove the pre-downloaded file so upload() doesn't double-write.
    await this.files.deleteIfExists(localPath);

    const result = await this.invoices.upload(syntheticFile);
    this.logger.log(
      `Auto-ingested SharePoint object ${objectName} -> invoice ${result.invoiceId}`,
    );
  }
}
