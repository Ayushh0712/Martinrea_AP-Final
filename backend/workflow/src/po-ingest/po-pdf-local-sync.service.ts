import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import * as path from 'path';
import { OciService } from '../ocr-app/oci/oci.service';

export interface PoPdfSyncResult {
  scanned: number;
  uploaded: number;
  failed: number;
}

const UPLOADED_SUBFOLDER = 'uploaded';

/**
 * Local PO-PDF drop folder -> OCI auto-upload.
 *
 * Drop a PDF named after its PO number (PO-001.pdf) into the project's
 * `PO-PDFs/` folder and this service uploads it to the bucket's `PO-PDFs/`
 * prefix (the folder the document endpoint fetches from by filename), then
 * moves the local file into `PO-PDFs/uploaded/` so it isn't re-uploaded but
 * you keep a copy. Failed uploads stay in place and retry on the next tick.
 *
 * Folder: PO_PDF_LOCAL_DIR (relative paths resolve against the service cwd,
 * backend/workflow — the default `../../PO-PDFs` is the project root folder).
 * Toggle with PO_PDF_LOCAL_SYNC_ENABLED; cadence via PO_PDF_LOCAL_SYNC_CRON.
 */
@Injectable()
export class PoPdfLocalSyncService implements OnModuleInit {
  private readonly logger = new Logger(PoPdfLocalSyncService.name);
  private readonly enabled: boolean;
  private readonly localDir: string;
  private readonly prefix: string;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly oci: OciService,
  ) {
    this.enabled = !['0', 'false', 'no', 'off'].includes(
      (this.config.get<string>('PO_PDF_LOCAL_SYNC_ENABLED') ?? 'true').toLowerCase(),
    );
    this.localDir = path.resolve(
      process.cwd(),
      this.config.get<string>('PO_PDF_LOCAL_DIR') ?? '../../PO-PDFs',
    );
    this.prefix = this.config.get<string>('PO_PDF_PREFIX') ?? 'PO-PDFs/';
    this.logger.log(
      `PO PDF local sync ${this.enabled ? 'ENABLED' : 'disabled'} ` +
        `(dir="${this.localDir}" -> prefix="${this.prefix}")`,
    );
  }

  /** Make sure the drop folder and its uploaded/ archive exist on startup. */
  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    try {
      await fs.mkdir(path.join(this.localDir, UPLOADED_SUBFOLDER), {
        recursive: true,
      });
    } catch (err) {
      this.logger.warn(
        `Could not create PO PDF drop folder ${this.localDir}: ${(err as Error).message}`,
      );
    }
  }

  @Cron(process.env.PO_PDF_LOCAL_SYNC_CRON || '*/30 * * * * *', {
    name: 'po-pdf-local-sync',
  })
  async poll(): Promise<void> {
    if (!this.enabled) return;
    await this.runSync();
  }

  /**
   * Scan the drop folder once and upload any PDFs found. Shared by the cron
   * `poll()` and the on-demand /po-ingest/scan endpoint (which ignores the
   * `enabled` flag — an explicit request should always run).
   */
  async runSync(): Promise<PoPdfSyncResult> {
    const result: PoPdfSyncResult = { scanned: 0, uploaded: 0, failed: 0 };
    if (this.running) {
      this.logger.debug('Previous PO PDF sync still in progress — skipping');
      return result;
    }
    this.running = true;
    try {
      let entries;
      try {
        entries = await fs.readdir(this.localDir, { withFileTypes: true });
      } catch {
        return result; // Folder doesn't exist yet — nothing to sync.
      }
      const pdfs = entries.filter(
        (e) => e.isFile() && path.extname(e.name).toLowerCase() === '.pdf',
      );
      result.scanned = pdfs.length;

      for (const entry of pdfs) {
        const localPath = path.join(this.localDir, entry.name);
        try {
          const stat = await fs.stat(localPath);
          if (stat.size === 0) continue; // Likely mid-copy; retry next tick.

          await this.oci.uploadObject(
            `${this.prefix}${entry.name}`,
            localPath,
            'application/pdf',
          );
          await this.archive(localPath, entry.name);
          result.uploaded++;
        } catch (err) {
          result.failed++;
          this.logger.error(
            `PO PDF upload failed for ${entry.name}: ${(err as Error).message}`,
          );
          // Without a configured PAR every file fails identically — stop the
          // tick instead of logging one error per file.
          if (err instanceof ServiceUnavailableException) break;
        }
      }

      if (result.uploaded > 0 || result.failed > 0) {
        this.logger.log(
          `PO PDF sync: ${result.uploaded} uploaded, ${result.failed} failed ` +
            `(scanned ${result.scanned})`,
        );
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  /** Move a synced file into uploaded/, overwriting any previous copy. */
  private async archive(localPath: string, fileName: string): Promise<void> {
    const dest = path.join(this.localDir, UPLOADED_SUBFOLDER, fileName);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rm(dest, { force: true });
    try {
      await fs.rename(localPath, dest);
    } catch {
      // rename can fail across devices or on Windows locks — fall back to copy+delete.
      await fs.copyFile(localPath, dest);
      await fs.unlink(localPath);
    }
  }
}
