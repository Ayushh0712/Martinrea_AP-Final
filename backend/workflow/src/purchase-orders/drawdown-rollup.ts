import {
  PurchaseOrder,
  PurchaseOrderStatus,
} from './entities/purchase-order.entity';
import {
  PurchaseOrderLine,
  PurchaseOrderLineStatus,
} from './entities/purchase-order-line.entity';

/** Quantity comparison epsilon (below any real UoM granularity). */
export const QTY_EPS = 1e-6;
/** Money comparison epsilon (half a cent). */
export const MONEY_EPS = 0.005;

/**
 * Pure rollup rules deriving PO / PO-line status from the draw-down state
 * (reserved + consumed vs ordered). Single source of truth shared by
 * PurchaseOrderAllocationService (live match/approve/reject flow) and the
 * recompute-po-drawdown repair script, so both always agree.
 */

/** OPEN / PARTIALLY_RECEIVED / FULLY_RECEIVED from reserved+consumed vs order. */
export function rollupLineStatus(
  line: Pick<
    PurchaseOrderLine,
    'orderQuantity' | 'reservedQuantity' | 'consumedQuantity'
  >,
): PurchaseOrderLineStatus {
  const order = Number(line.orderQuantity ?? 0);
  const committed =
    Number(line.reservedQuantity) + Number(line.consumedQuantity);
  if (committed <= QTY_EPS) return PurchaseOrderLineStatus.OPEN;
  if (order > 0 && committed >= order - QTY_EPS) {
    return PurchaseOrderLineStatus.FULLY_RECEIVED;
  }
  return PurchaseOrderLineStatus.PARTIALLY_RECEIVED;
}

/**
 * Roll up the PO header status from its committed amount vs total. Leaves
 * terminal states (CLOSED / CANCELLED) untouched.
 */
export function rollupPoStatus(
  po: Pick<
    PurchaseOrder,
    'status' | 'totalAmount' | 'orderTotal' | 'reservedAmount' | 'consumedAmount'
  >,
): PurchaseOrderStatus {
  if (
    po.status === PurchaseOrderStatus.CLOSED ||
    po.status === PurchaseOrderStatus.CANCELLED
  ) {
    return po.status;
  }
  const total = Number(po.totalAmount ?? po.orderTotal ?? 0);
  const committed = Number(po.reservedAmount) + Number(po.consumedAmount);
  if (committed <= QTY_EPS) return PurchaseOrderStatus.OPEN;
  if (total > 0 && committed >= total - MONEY_EPS) {
    return PurchaseOrderStatus.FULLY_RECEIVED;
  }
  return PurchaseOrderStatus.PARTIALLY_RECEIVED;
}
