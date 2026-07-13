import {
  PurchaseOrder,
  PurchaseOrderStatus,
} from './entities/purchase-order.entity';
import {
  PurchaseOrderLine,
  PurchaseOrderLineStatus,
} from './entities/purchase-order-line.entity';

/**
 * Shared PO header + lines upsert, used by BOTH the seed script
 * (seed-purchase-orders-from-json.ts) and the OCI PO-JSON auto-ingest poller
 * (po-ingest/po-json-autoingest.service.ts) so a JSON file dropped in the
 * bucket goes through the exact same code path as the seed fixture.
 *
 * Operates on the static sequelize-typescript model classes, which are bound
 * to whichever Sequelize instance registered them (the Nest app or a
 * standalone seed connection), so it works in both contexts.
 *
 * IMPORTANT: when a PO / line already exists, the update NEVER writes the live
 * draw-down state (reservedAmount/consumedAmount on the header,
 * reservedQuantity/consumedQuantity on lines) or the rollup-derived status.
 * Those columns are owned exclusively by PurchaseOrderAllocationService
 * (match reserve / approve consume / reject release); the JSON fixtures
 * hard-code zeros for them, so writing them through would silently reset a
 * PO's remaining every time a file is re-ingested (e.g. after a service
 * restart). See sanitizePoHeaderUpdate / sanitizePoLineUpdate.
 */

export interface PoLineJson {
  lineNumber: number;
  itemCode?: string | null;
  description?: string;
  orderQuantity?: number;
  reservedQuantity?: number;
  consumedQuantity?: number;
  unitOfMeasure?: string;
  unitPrice?: number;
  lineTotal?: number;
  status?: string;
}

export interface PoJson {
  poNumber: string;
  supplierCode?: string;
  supplierId?: string;
  supplierName?: string;
  plantId?: string;
  currency?: string;
  totalAmount?: number;
  orderTotal?: number;
  reservedAmount?: number;
  consumedAmount?: number;
  status?: string;
  issuedDate?: string;
  expectedDeliveryDate?: string;
  instanceId?: string;
  notes?: string;
  lines?: PoLineJson[];
}

export interface PoUpsertStats {
  poCreated: number;
  poUpdated: number;
  lineCreated: number;
  lineUpdated: number;
}

/** Header statuses external JSON may legitimately force (ERP close/cancel). */
const TERMINAL_PO_STATUSES: ReadonlySet<string> = new Set([
  PurchaseOrderStatus.CLOSED,
  PurchaseOrderStatus.CANCELLED,
]);

/**
 * Prepare a header payload for updating an EXISTING PO: drop the
 * allocation-owned draw-down rollups (reservedAmount / consumedAmount).
 * `status` is rollup-derived from those, so it only passes through when the
 * JSON explicitly closes/cancels the PO — a real ERP signal the rollup can
 * never produce on its own.
 */
export function sanitizePoHeaderUpdate<
  T extends { reservedAmount?: number; consumedAmount?: number; status?: string },
>(
  header: T,
): Omit<T, 'reservedAmount' | 'consumedAmount' | 'status'> &
  Partial<Pick<T, 'status'>> {
  const { reservedAmount: _r, consumedAmount: _c, status, ...rest } = header;
  return status != null && TERMINAL_PO_STATUSES.has(status)
    ? { ...rest, status }
    : rest;
}

/**
 * Prepare a line payload for updating an EXISTING PO line: drop the
 * allocation-owned draw-down counters (reservedQuantity / consumedQuantity)
 * and the status (PurchaseOrderLineStatus is purely rollup-derived — there is
 * no terminal line state an external system could legitimately force).
 */
export function sanitizePoLineUpdate<
  T extends { reservedQuantity?: number; consumedQuantity?: number; status?: string },
>(line: T): Omit<T, 'reservedQuantity' | 'consumedQuantity' | 'status'> {
  const { reservedQuantity: _r, consumedQuantity: _c, status: _s, ...rest } = line;
  return rest;
}

/**
 * Normalize an uploaded JSON payload into a PoJson[]: accepts either a single
 * PO object or an array of them. Throws with a descriptive message when the
 * payload is not PO-shaped (so the poller can log/skip the file cleanly).
 */
export function normalizePoJson(payload: unknown): PoJson[] {
  const rows = Array.isArray(payload) ? payload : [payload];
  if (rows.length === 0) {
    throw new Error('JSON payload contains no purchase orders');
  }
  for (const [i, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Entry ${i} is not an object`);
    }
    const poNumber = (row as PoJson).poNumber;
    if (typeof poNumber !== 'string' || poNumber.trim() === '') {
      throw new Error(`Entry ${i} is missing a "poNumber"`);
    }
    const lines = (row as PoJson).lines;
    if (lines !== undefined && !Array.isArray(lines)) {
      throw new Error(`Entry ${i} ("${poNumber}"): "lines" must be an array`);
    }
    for (const [j, line] of (lines ?? []).entries()) {
      if (!line || typeof line !== 'object' || typeof line.lineNumber !== 'number') {
        throw new Error(
          `Entry ${i} ("${poNumber}"): line ${j} is missing a numeric "lineNumber"`,
        );
      }
    }
  }
  return rows as PoJson[];
}

/**
 * Upsert PO headers (keyed on poNumber) and their lines (keyed on
 * purchaseOrderId + lineNumber). Idempotent AND draw-down-safe: re-running
 * with the same payload updates the descriptive fields of existing rows but
 * never touches their live reserved/consumed state (see the sanitize helpers
 * above), so re-ingesting a file cannot reset a partially-drawn PO.
 */
export async function upsertPurchaseOrdersFromJson(
  rows: PoJson[],
  log: (msg: string) => void = () => undefined,
): Promise<PoUpsertStats> {
  const stats: PoUpsertStats = {
    poCreated: 0,
    poUpdated: 0,
    lineCreated: 0,
    lineUpdated: 0,
  };

  for (const row of rows) {
    const { lines = [], ...header } = row;
    const headerData = {
      ...header,
      poNumber: header.poNumber.trim(),
      status: (header.status ?? PurchaseOrderStatus.OPEN) as PurchaseOrderStatus,
    };

    let po = await PurchaseOrder.findOne({
      where: { poNumber: headerData.poNumber },
    });
    if (po) {
      await po.update(sanitizePoHeaderUpdate(headerData));
      stats.poUpdated++;
      log(`~ Updated ${headerData.poNumber} [${headerData.status}] - $${header.totalAmount ?? '?'} ${header.currency ?? ''}`);
    } else {
      po = await PurchaseOrder.create(headerData as PurchaseOrder);
      stats.poCreated++;
      log(`+ Created ${headerData.poNumber} [${headerData.status}] - $${header.totalAmount ?? '?'} ${header.currency ?? ''} - ${header.supplierName ?? ''}`);
    }

    for (const line of lines) {
      const lineData = {
        ...line,
        status: (line.status ?? PurchaseOrderLineStatus.OPEN) as PurchaseOrderLineStatus,
        purchaseOrderId: po.id,
      };
      const existingLine = await PurchaseOrderLine.findOne({
        where: { purchaseOrderId: po.id, lineNumber: line.lineNumber },
      });
      if (existingLine) {
        await existingLine.update(sanitizePoLineUpdate(lineData));
        stats.lineUpdated++;
        log(`    ~ Line ${line.lineNumber} — ${line.itemCode ?? ''}`);
      } else {
        await PurchaseOrderLine.create(lineData as PurchaseOrderLine);
        stats.lineCreated++;
        log(`    + Line ${line.lineNumber} — ${line.itemCode ?? ''}`);
      }
    }
  }

  return stats;
}
