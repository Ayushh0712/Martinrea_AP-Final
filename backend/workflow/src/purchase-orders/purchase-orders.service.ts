import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import {
  normalizePoJson,
  PoUpsertStats,
  upsertPurchaseOrdersFromJson,
} from './po-upsert';

/**
 * Read access to the seeded `purchase_orders` / `purchase_order_lines` tables
 * (the rows produced by seed-purchase-orders.ts). This is the same data the
 * 2-way match gate resolves against, so the match workbench PO panel and the
 * server-side match verdict share a single source of truth (no integrations/CMS
 * dependency).
 *
 * Also the write path for the OCI PO-JSON auto-ingest folder: JSON files
 * dropped in the bucket are upserted here via the same shared code path as the
 * seed script (po-upsert.ts).
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectModel(PurchaseOrder)
    private readonly poModel: typeof PurchaseOrder,
    @InjectModel(PurchaseOrderLine)
    private readonly poLineModel: typeof PurchaseOrderLine,
  ) {}

  findByPoNumber(poNumber: string): Promise<PurchaseOrder | null> {
    return this.poModel.findOne({ where: { poNumber } });
  }

  /** All PO headers, ordered by PO number (for the side-by-side / list views). */
  findAll(): Promise<PurchaseOrder[]> {
    return this.poModel.findAll({ order: [['poNumber', 'ASC']] });
  }

  /** All line items for a PO, ordered by line number (empty for header-only POs). */
  findLines(purchaseOrderId: string): Promise<PurchaseOrderLine[]> {
    return this.poLineModel.findAll({
      where: { purchaseOrderId },
      order: [['lineNumber', 'ASC']],
    });
  }

  /** Every PO line across all POs (one query for the list endpoint). */
  findAllLines(): Promise<PurchaseOrderLine[]> {
    return this.poLineModel.findAll({ order: [['lineNumber', 'ASC']] });
  }

  /**
   * Upsert PO headers + lines from a parsed JSON payload (single PO object or
   * array). Validation errors throw with a descriptive message; the upsert is
   * idempotent (keyed on poNumber / lineNumber).
   */
  upsertFromJson(payload: unknown): Promise<PoUpsertStats> {
    const rows = normalizePoJson(payload);
    return upsertPurchaseOrdersFromJson(rows);
  }
}
