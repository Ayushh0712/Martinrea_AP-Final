import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
} from './entities/purchase-order.entity';
import {
  PurchaseOrderLine,
  PurchaseOrderLineStatus,
} from './entities/purchase-order-line.entity';
import {
  InvoicePoLineReservation,
  ReservationStatus,
} from '../invoices/entities/invoice-po-line-reservation.entity';
import { rollupLineStatus, rollupPoStatus } from './drawdown-rollup';

/**
 * One draw against a PO line produced by a passing 2-way match. Structurally
 * identical to MatchService's LineAllocation (kept local to avoid a module
 * dependency from purchase-orders back into match-records).
 */
export interface ReserveAllocation {
  purchaseOrderLineId: string;
  invoiceLineId: string | null;
  quantity: number;
  amount: number;
}

/**
 * Owns every mutation of PO draw-down state so match / approve / reject stay
 * atomic. All methods are transaction-aware and take a caller-supplied
 * transaction (the invoice lifecycle owns the transaction and the invoice row
 * lock); PO lines and reservations are locked FOR UPDATE here.
 *
 * Lifecycle of the draw-down against a PO line:
 *   match   -> reserve  (order - reserved - consumed shrinks; RESERVED ledger row)
 *   approve -> consume  (reserved -> consumed; ledger CONSUMED)
 *   reject  -> release  (reserved reverted; ledger RELEASED)
 */
@Injectable()
export class PurchaseOrderAllocationService {
  private readonly logger = new Logger(PurchaseOrderAllocationService.name);

  constructor(
    @InjectModel(PurchaseOrder) private readonly poModel: typeof PurchaseOrder,
    @InjectModel(PurchaseOrderLine)
    private readonly poLineModel: typeof PurchaseOrderLine,
    @InjectModel(InvoicePoLineReservation)
    private readonly reservationModel: typeof InvoicePoLineReservation,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Reserve PO quantity/amount for a freshly-matched invoice: increment each PO
   * line's reservedQuantity + the PO header's reservedAmount and write a
   * RESERVED ledger row. No-op when there are no allocations.
   */
  async reserve(
    invoiceId: string,
    allocations: ReserveAllocation[],
    tx: Transaction,
  ): Promise<void> {
    if (allocations.length === 0) return;

    let purchaseOrderId: string | null = null;
    let headerAmount = 0;

    for (const alloc of allocations) {
      const poLine = await this.poLineModel.findByPk(
        alloc.purchaseOrderLineId,
        { transaction: tx, lock: tx.LOCK.UPDATE },
      );
      if (!poLine) continue;

      poLine.reservedQuantity =
        Number(poLine.reservedQuantity) + alloc.quantity;
      poLine.status = this.rollupLineStatus(poLine);
      await poLine.save({ transaction: tx });

      purchaseOrderId = poLine.purchaseOrderId;
      headerAmount += alloc.amount;

      await this.reservationModel.create(
        {
          invoiceId,
          invoiceLineId: alloc.invoiceLineId,
          purchaseOrderId: poLine.purchaseOrderId,
          purchaseOrderLineId: poLine.id,
          reservedQuantity: alloc.quantity,
          reservedAmount: alloc.amount,
          status: ReservationStatus.RESERVED,
          reservedAt: new Date(),
        } as unknown as InvoicePoLineReservation,
        { transaction: tx },
      );
    }

    if (purchaseOrderId) {
      await this.bumpHeader(purchaseOrderId, headerAmount, 0, tx);
    }

    await this.audit.record(
      {
        actionType: 'PO_RESERVED',
        invoiceId,
        newValue: { lines: allocations.length, reservedAmount: headerAmount },
        notes: `Reserved PO draw-down for ${allocations.length} line(s).`,
      },
      tx,
    );
    this.logger.log(
      `Invoice ${invoiceId}: reserved ${allocations.length} PO line(s), amount ${headerAmount}.`,
    );
  }

  /**
   * Consume the invoice's RESERVED draw-down on approval: move reserved -> consumed
   * on each PO line and reservedAmount -> consumedAmount on the header. Idempotent
   * (only acts on rows still in RESERVED).
   */
  async consume(invoiceId: string, tx: Transaction): Promise<void> {
    const reservations = await this.reservationModel.findAll({
      where: { invoiceId, status: ReservationStatus.RESERVED },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (reservations.length === 0) return;

    let purchaseOrderId: string | null = null;
    let headerAmount = 0;

    for (const r of reservations) {
      const qty = Number(r.reservedQuantity);
      const amount = Number(r.reservedAmount);

      const poLine = r.purchaseOrderLineId
        ? await this.poLineModel.findByPk(r.purchaseOrderLineId, {
            transaction: tx,
            lock: tx.LOCK.UPDATE,
          })
        : null;
      if (poLine) {
        poLine.reservedQuantity = Math.max(
          0,
          Number(poLine.reservedQuantity) - qty,
        );
        poLine.consumedQuantity = Number(poLine.consumedQuantity) + qty;
        poLine.status = this.rollupLineStatus(poLine);
        await poLine.save({ transaction: tx });
      }

      purchaseOrderId = r.purchaseOrderId;
      headerAmount += amount;

      r.status = ReservationStatus.CONSUMED;
      r.consumedAt = new Date();
      await r.save({ transaction: tx });
    }

    if (purchaseOrderId) {
      await this.bumpHeader(purchaseOrderId, -headerAmount, headerAmount, tx);
    }

    await this.audit.record(
      {
        actionType: 'PO_CONSUMED',
        invoiceId,
        newValue: { lines: reservations.length, consumedAmount: headerAmount },
        notes: `Consumed PO draw-down for ${reservations.length} line(s) on approval.`,
      },
      tx,
    );
    this.logger.log(
      `Invoice ${invoiceId}: consumed ${reservations.length} PO line(s), amount ${headerAmount}.`,
    );
  }

  /**
   * Release the invoice's RESERVED draw-down on rejection: revert each PO line's
   * reservedQuantity and the header reservedAmount, restoring remaining. Idempotent
   * (only acts on rows still in RESERVED).
   */
  async release(invoiceId: string, tx: Transaction): Promise<void> {
    const reservations = await this.reservationModel.findAll({
      where: { invoiceId, status: ReservationStatus.RESERVED },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (reservations.length === 0) return;

    let purchaseOrderId: string | null = null;
    let headerAmount = 0;

    for (const r of reservations) {
      const qty = Number(r.reservedQuantity);
      const amount = Number(r.reservedAmount);

      const poLine = r.purchaseOrderLineId
        ? await this.poLineModel.findByPk(r.purchaseOrderLineId, {
            transaction: tx,
            lock: tx.LOCK.UPDATE,
          })
        : null;
      if (poLine) {
        poLine.reservedQuantity = Math.max(
          0,
          Number(poLine.reservedQuantity) - qty,
        );
        poLine.status = this.rollupLineStatus(poLine);
        await poLine.save({ transaction: tx });
      }

      purchaseOrderId = r.purchaseOrderId;
      headerAmount += amount;

      r.status = ReservationStatus.RELEASED;
      r.releasedAt = new Date();
      await r.save({ transaction: tx });
    }

    if (purchaseOrderId) {
      await this.bumpHeader(purchaseOrderId, -headerAmount, 0, tx);
    }

    await this.audit.record(
      {
        actionType: 'PO_RELEASED',
        invoiceId,
        newValue: { lines: reservations.length, releasedAmount: headerAmount },
        notes: `Released PO draw-down for ${reservations.length} line(s) on rejection.`,
      },
      tx,
    );
    this.logger.log(
      `Invoice ${invoiceId}: released ${reservations.length} PO line(s), amount ${headerAmount}.`,
    );
  }

  /**
   * Apply deltas to the PO header reserved/consumed rollups and refresh its
   * status. reservedDelta/consumedDelta may be negative.
   */
  private async bumpHeader(
    purchaseOrderId: string,
    reservedDelta: number,
    consumedDelta: number,
    tx: Transaction,
  ): Promise<void> {
    const po = await this.poModel.findByPk(purchaseOrderId, {
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (!po) return;

    po.reservedAmount = Math.max(0, Number(po.reservedAmount) + reservedDelta);
    po.consumedAmount = Math.max(0, Number(po.consumedAmount) + consumedDelta);
    po.status = this.rollupPoStatus(po);
    await po.save({ transaction: tx });
  }

  /** Delegates to the shared rollup rules (drawdown-rollup.ts). */
  private rollupLineStatus(line: PurchaseOrderLine): PurchaseOrderLineStatus {
    return rollupLineStatus(line);
  }

  /** Delegates to the shared rollup rules (drawdown-rollup.ts). */
  private rollupPoStatus(po: PurchaseOrder): PurchaseOrderStatus {
    return rollupPoStatus(po);
  }
}
