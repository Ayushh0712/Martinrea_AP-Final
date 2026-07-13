import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OciService } from '../ocr-app/oci/oci.service';
import { PoUpsertStats } from '../purchase-orders/po-upsert';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';

export interface PoJsonScanResult {
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
 * OCI PO-JSON source poller. Drop a `.json` file (a single PO object or an
 * array of them, same shape as seeds/data/all_purchase_orders.json) into the
 * bucket's `PO-JSON/` folder and this poller upserts the data straight into
 * `purchase_orders` + `purchase_order_lines` — no human review step, since the
 * JSON is trusted structured data (unlike invoice PDFs, which go through OCR).
 *
 * Idempotency: the upsert is keyed on poNumber/lineNumber and never writes
 * the live draw-down columns of existing rows (see po-upsert.ts), so
 * re-processing a file is harmless. Dedup within a process is on object name
 * + timeModified, which means OVERWRITING a JSON in the bucket re-ingests the
 * new content.
 *
 * Toggle with PO_JSON_INGEST_ENABLED (default ON when OCI is configured);
 * folder via PO_JSON_PREFIX; cadence via PO_JSON_INGEST_CRON.
 */
@Injectable()
export class PoJsonAutoIngestService {
  private readonly logger = new Logger(PoJsonAutoIngestService.name);
  private readonly enabled: boolean;
  private readonly prefix: string;
  private readonly processed = new Set<string>();
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly oci: OciService,
    private readonly purchaseOrders: PurchaseOrdersService,
  ) {
    this.enabled = !['0', 'false', 'no', 'off'].includes(
      (this.config.get<string>('PO_JSON_INGEST_ENABLED') ?? 'true').toLowerCase(),
    );
    this.prefix = this.config.get<string>('PO_JSON_PREFIX') ?? 'PO-JSON/';
    this.logger.log(
      `PO JSON auto-ingest ${this.enabled ? 'ENABLED' : 'disabled'} (prefix="${this.prefix}")`,
    );
  }

  @Cron(process.env.PO_JSON_INGEST_CRON || '0 */2 * * * *', {
    name: 'po-json-ingest',
  })
  async poll(): Promise<void> {
    if (!this.enabled) return;
    await this.runScan();
  }

  /**
   * Scan the PO-JSON folder once and upsert any new/changed files. Shared by
   * the cron `poll()` and the on-demand scan endpoint; the on-demand path
   * ignores the `enabled` flag (an explicit request should always run) but
   * still respects the `running` guard.
   */
  async runScan(): Promise<PoJsonScanResult> {
    const empty: PoJsonScanResult = {
      scanned: 0, ingested: 0, skipped: 0, failed: 0,
      posCreated: 0, posUpdated: 0, linesCreated: 0, linesUpdated: 0,
    };
    if (this.running) {
      this.logger.debug('Previous PO JSON ingest run still in progress — skipping');
      return empty;
    }
    this.running = true;
    try {
      const { objects } = await this.oci.listObjects(this.prefix);
      const jsonObjects = objects.filter(
        (o) => path.extname(o.name).toLowerCase() === '.json',
      );
      const result = { ...empty, scanned: jsonObjects.length };

      for (const obj of jsonObjects) {
        // Include timeModified so overwriting a file re-ingests its content.
        const dedupKey = `${obj.name}@${obj.timeModified ?? ''}`;
        if (this.processed.has(dedupKey)) {
          result.skipped++;
          continue;
        }
        try {
          const stats = await this.ingestObject(obj.name);
          this.processed.add(dedupKey);
          result.ingested++;
          result.posCreated += stats.poCreated;
          result.posUpdated += stats.poUpdated;
          result.linesCreated += stats.lineCreated;
          result.linesUpdated += stats.lineUpdated;
        } catch (err) {
          result.failed++;
          this.logger.error(
            `PO JSON ingest failed for ${obj.name}: ${(err as Error).message}`,
          );
        }
      }

      if (result.ingested > 0 || result.failed > 0) {
        this.logger.log(
          `PO JSON ingest: ${result.ingested} file(s) processed ` +
            `(POs +${result.posCreated}/~${result.posUpdated}, ` +
            `lines +${result.linesCreated}/~${result.linesUpdated}), ` +
            `${result.failed} failed, ${result.skipped} already ingested`,
        );
      }
      return result;
    } catch (err) {
      this.logger.warn(`PO JSON ingest scan error: ${(err as Error).message}`);
      return empty;
    } finally {
      this.running = false;
    }
  }

  /** Download one JSON object, parse it and upsert its POs. Temp file always removed. */
  private async ingestObject(objectName: string): Promise<PoUpsertStats> {
    const stagingDir = path.join(os.tmpdir(), 'po-json-ingest');
    const localPath = await this.oci.downloadToTmp(objectName, stagingDir);
    try {
      const raw = await fs.readFile(localPath, 'utf8');
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error('file is not valid JSON');
      }
      const stats = await this.purchaseOrders.upsertFromJson(payload);
      this.logger.log(
        `Ingested ${objectName}: POs +${stats.poCreated}/~${stats.poUpdated}, ` +
          `lines +${stats.lineCreated}/~${stats.lineUpdated}`,
      );
      return stats;
    } finally {
      await fs.unlink(localPath).catch(() => undefined);
    }
  }
}
