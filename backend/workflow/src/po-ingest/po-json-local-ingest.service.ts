import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import * as path from 'path';
import { normalizePoJson } from '../purchase-orders/po-upsert';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';

export interface PoJsonLocalIngestResult {
  scanned: number;
  ingested: number;
  skipped: number;
  failed: number;
  posCreated: number;
  posUpdated: number;
  linesCreated: number;
  linesUpdated: number;
}

/**
 * Local PO-Data drop folder -> PO tables, no OCI involved.
 *
 * Drop (or edit) a `.json` file in the project's `PO-Data/` folder — a single
 * PO object or an array, same shape as seeds/data/all_purchase_orders.json —
 * and its data is upserted straight into `purchase_orders` +
 * `purchase_order_lines` through the same shared code path as the seed script
 * and the OCI PO-JSON bucket poller.
 *
 * Files STAY in the folder. A file is (re)read only when its last-modified
 * time changes: new files ingest on first sight, editing a file re-ingests it,
 * untouched files are skipped without being read. Malformed files record their
 * mtime too (error logged once) so they are not retried every tick — fixing
 * and saving the file triggers the re-read. Unexpected DB/infra errors do NOT
 * record the mtime, so those retry on the next tick.
 *
 * The mtime map is in-memory: a service restart re-ingests each file once.
 * This is safe because the upsert is idempotent (keyed on poNumber/lineNumber)
 * and never writes the live draw-down columns of existing rows (reserved/
 * consumed amount and quantity are owned by PurchaseOrderAllocationService —
 * see po-upsert.ts sanitize helpers), so a re-ingest cannot reset a
 * partially-invoiced PO.
 *
 * Folder: PO_JSON_LOCAL_DIR (relative paths resolve against the service cwd,
 * backend/workflow — the default `../../PO-Data` is the project root folder).
 * Toggle with PO_JSON_LOCAL_SYNC_ENABLED; cadence via PO_JSON_LOCAL_SYNC_CRON.
 */
@Injectable()
export class PoJsonLocalIngestService implements OnModuleInit {
  private readonly logger = new Logger(PoJsonLocalIngestService.name);
  private readonly enabled: boolean;
  private readonly localDir: string;
  /** filename -> mtimeMs at the last ingest attempt (success or bad-file). */
  private readonly mtimes = new Map<string, number>();
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly purchaseOrders: PurchaseOrdersService,
  ) {
    this.enabled = !['0', 'false', 'no', 'off'].includes(
      (this.config.get<string>('PO_JSON_LOCAL_SYNC_ENABLED') ?? 'true').toLowerCase(),
    );
    this.localDir = path.resolve(
      process.cwd(),
      this.config.get<string>('PO_JSON_LOCAL_DIR') ?? '../../PO-Data',
    );
    this.logger.log(
      `PO JSON local ingest ${this.enabled ? 'ENABLED' : 'disabled'} (dir="${this.localDir}")`,
    );
  }

  /** Make sure the drop folder exists on startup. */
  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    try {
      await fs.mkdir(this.localDir, { recursive: true });
    } catch (err) {
      this.logger.warn(
        `Could not create PO-Data drop folder ${this.localDir}: ${(err as Error).message}`,
      );
    }
  }

  @Cron(process.env.PO_JSON_LOCAL_SYNC_CRON || '*/30 * * * * *', {
    name: 'po-json-local-ingest',
  })
  async poll(): Promise<void> {
    if (!this.enabled) return;
    await this.runIngest();
  }

  /**
   * Scan the drop folder once and ingest any new/modified JSON files. Shared
   * by the cron `poll()` and the on-demand /po-ingest/scan endpoint (which
   * ignores the `enabled` flag — an explicit request should always run).
   */
  async runIngest(): Promise<PoJsonLocalIngestResult> {
    const result: PoJsonLocalIngestResult = {
      scanned: 0, ingested: 0, skipped: 0, failed: 0,
      posCreated: 0, posUpdated: 0, linesCreated: 0, linesUpdated: 0,
    };
    if (this.running) {
      this.logger.debug('Previous PO-Data ingest still in progress — skipping');
      return result;
    }
    this.running = true;
    try {
      let entries;
      try {
        entries = await fs.readdir(this.localDir, { withFileTypes: true });
      } catch {
        return result; // Folder doesn't exist yet — nothing to ingest.
      }
      const jsons = entries.filter(
        (e) => e.isFile() && path.extname(e.name).toLowerCase() === '.json',
      );
      result.scanned = jsons.length;

      for (const entry of jsons) {
        const localPath = path.join(this.localDir, entry.name);
        try {
          const stat = await fs.stat(localPath);
          if (stat.size === 0) continue; // Likely mid-copy; retry next tick.

          if (this.mtimes.get(entry.name) === stat.mtimeMs) {
            result.skipped++;
            continue;
          }
          await this.ingestFile(entry.name, localPath, stat.mtimeMs, result);
        } catch (err) {
          result.failed++;
          this.logger.error(
            `PO-Data ingest failed for ${entry.name}: ${(err as Error).message}`,
          );
        }
      }

      if (result.ingested > 0 || result.failed > 0) {
        this.logger.log(
          `PO-Data ingest: ${result.ingested} file(s) processed ` +
            `(POs +${result.posCreated}/~${result.posUpdated}, ` +
            `lines +${result.linesCreated}/~${result.linesUpdated}), ` +
            `${result.failed} failed, ${result.skipped} unchanged`,
        );
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  /**
   * Read + validate + upsert one file. Validation failures (bad JSON / not
   * PO-shaped) record the mtime so the file isn't retried until it's edited;
   * DB/infra failures leave the mtime unrecorded so the next tick retries.
   */
  private async ingestFile(
    fileName: string,
    localPath: string,
    mtimeMs: number,
    result: PoJsonLocalIngestResult,
  ): Promise<void> {
    const raw = await fs.readFile(localPath, 'utf8');

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
      normalizePoJson(payload);
    } catch (err) {
      this.mtimes.set(fileName, mtimeMs);
      result.failed++;
      this.logger.error(
        `PO-Data file ${fileName} is invalid and will be skipped until modified: ` +
          `${(err as Error).message}`,
      );
      return;
    }

    const stats = await this.purchaseOrders.upsertFromJson(payload);
    this.mtimes.set(fileName, mtimeMs);
    result.ingested++;
    result.posCreated += stats.poCreated;
    result.posUpdated += stats.poUpdated;
    result.linesCreated += stats.lineCreated;
    result.linesUpdated += stats.lineUpdated;
    this.logger.log(
      `Ingested PO-Data/${fileName}: POs +${stats.poCreated}/~${stats.poUpdated}, ` +
        `lines +${stats.lineCreated}/~${stats.lineUpdated}`,
    );
  }
}
