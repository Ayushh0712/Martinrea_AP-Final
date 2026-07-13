import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Invoice } from '../invoices/entities/invoice.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchase-orders/entities/purchase-order-line.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  MatchRecord,
  MatchStatus,
  MatchType,
} from './entities/match-record.entity';
import {
  DiscrepancySeverity,
  DiscrepancyType,
  MatchDiscrepancy,
} from './entities/match-discrepancy.entity';

/**
 * Default amount tolerance, retained only as metadata persisted on the
 * MatchRecord. Line-level comparisons (unit price, quantity) are EXACT save for
 * a sub-cent / sub-unit rounding epsilon and do not use this percentage.
 * Override the stored value with MATCH_TOLERANCE_PCT.
 */
export const DEFAULT_MATCH_TOLERANCE_PCT = 0.02;

/** Epsilon for money comparisons (half a cent). */
const MONEY_EPS = 0.005;
/** Epsilon for quantity comparisons (well below any real UoM granularity). */
const QTY_EPS = 1e-6;

/** A single discrepancy produced by the match evaluation. */
export interface MatchDiscrepancyResult {
  fieldName: string;
  invoiceValue: string | null;
  poValue: string | null;
  differenceAmount: number | null;
  differencePct: number | null;
  severity: DiscrepancySeverity;
  discrepancyType: DiscrepancyType;
  /** Blocking discrepancies prevent the invoice from leaving PENDING_MATCH. */
  blocking: boolean;
  message: string;
  /** Line-level anchors (null for header-level discrepancies). */
  invoiceLineId?: string | null;
  purchaseOrderLineId?: string | null;
}

/**
 * One resolved draw against a PO line, produced only for a passing match. The
 * allocation service consumes these to reserve quantity/amount on the PO.
 */
export interface LineAllocation {
  purchaseOrderLineId: string;
  invoiceLineId: string | null;
  quantity: number;
  amount: number;
}

export interface MatchFlags {
  poNumberMatch: boolean;
  currencyMatch: boolean | null;
  supplierMatch: boolean | null;
  priceMatch: boolean | null;
  quantityMatch: boolean | null;
  amountMatch: boolean | null;
}

export interface MatchResult {
  matchStatus: MatchStatus;
  discrepancies: MatchDiscrepancyResult[];
  blockingDiscrepancies: MatchDiscrepancyResult[];
  /** Per-PO-line allocations to reserve; empty unless the match passed. */
  lineAllocations: LineAllocation[];
  flags: MatchFlags;
  /** Remaining PO monetary value available BEFORE this match. */
  poAvailableAmount: number | null;
  invoiceAmount: number;
  poAmount: number | null;
}

/**
 * Minimal PO header shape the 2-way rules compare against. Satisfied by the
 * locally-seeded `PurchaseOrder` entity.
 */
export interface MatchablePo {
  id?: string;
  poNumber?: string;
  currency?: string | null;
  supplierName?: string | null;
  totalAmount?: number | null;
  orderTotal?: number | null;
}

/** Minimal PO line shape (satisfied by PurchaseOrderLine). */
export interface MatchablePoLine {
  id: string;
  lineNumber?: number;
  itemCode?: string | null;
  description?: string | null;
  unitPrice?: number | null;
  orderQuantity?: number | null;
  reservedQuantity?: number | null;
  consumedQuantity?: number | null;
}

/** Minimal invoice line shape (satisfied by InvoiceLineItem). */
export interface MatchableInvoiceLine {
  id?: string | null;
  lineNumber?: number;
  itemCode?: string | null;
  description?: string | null;
  unitPrice?: number | null;
  quantity?: number | null;
}

/** Remaining (available) quantity on a PO line: order - reserved - consumed. */
function availableQty(line: MatchablePoLine): number {
  const order = Number(line.orderQuantity ?? 0);
  const reserved = Number(line.reservedQuantity ?? 0);
  const consumed = Number(line.consumedQuantity ?? 0);
  return order - reserved - consumed;
}

/** Normalized key for itemCode correspondence (trim + upper, whitespace-safe). */
function itemKey(code: string | null | undefined): string | null {
  const k = (code ?? '').trim().toUpperCase();
  return k.length > 0 ? k : null;
}

/**
 * Authoritative, server-side 2-way match (Invoice <-> Purchase Order) at the
 * LINE-ITEM level, supporting multiple invoices drawing down a single PO.
 *
 * The PO is resolved SOLELY from the workflow service's own seeded
 * `purchase_orders` / `purchase_order_lines` tables: the OCR-extracted PO number
 * on the invoice is compared directly against it. The verdict is persisted as a
 * MatchRecord (+ MatchDiscrepancy rows) so it is durable and auditable, and is
 * used by InvoicesService.submitMatch() to gate PENDING_MATCH -> MATCHED: an
 * invoice with any blocking discrepancy cannot be routed for approval, and the
 * PO is never modified on a failed match.
 */
@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);
  private readonly tolerancePct: number;

  constructor(
    @InjectModel(MatchRecord) private readonly matchModel: typeof MatchRecord,
    @InjectModel(MatchDiscrepancy)
    private readonly discrepancyModel: typeof MatchDiscrepancy,
    @InjectModel(PurchaseOrder) private readonly poModel: typeof PurchaseOrder,
    @InjectModel(PurchaseOrderLine)
    private readonly poLineModel: typeof PurchaseOrderLine,
    @InjectModel(InvoiceLineItem)
    private readonly invoiceLineModel: typeof InvoiceLineItem,
    private readonly audit: AuditLogsService,
  ) {
    const raw = Number(process.env.MATCH_TOLERANCE_PCT);
    this.tolerancePct =
      Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MATCH_TOLERANCE_PCT;
  }

  /**
   * Evaluate the 2-way match, persist a MatchRecord (+ discrepancies), write an
   * audit entry, and return the verdict. Idempotent per invoice (upsert). When a
   * transaction is supplied the PO lines are read FOR UPDATE so the draw-down
   * availability check is race-safe against concurrent invoices on the same PO.
   */
  async verifyAndRecord(
    invoice: Invoice,
    performedBy: string | null,
    tx?: Transaction,
  ): Promise<MatchResult> {
    const poNumber = invoice.poNumber?.trim() || null;

    let localPo: PurchaseOrder | null = null;
    let poLines: PurchaseOrderLine[] = [];
    if (poNumber) {
      localPo = await this.poModel.findOne({
        where: { poNumber },
        transaction: tx,
      });
      if (localPo) {
        poLines = await this.poLineModel.findAll({
          where: { purchaseOrderId: localPo.id },
          order: [['lineNumber', 'ASC']],
          transaction: tx,
          lock: tx ? tx.LOCK.UPDATE : undefined,
        });
      }
    }

    const invoiceLines = await this.invoiceLineModel.findAll({
      where: { invoiceId: invoice.id },
      order: [['lineNumber', 'ASC']],
      transaction: tx,
    });

    const result = this.evaluate(invoice, localPo, poLines, invoiceLines);
    await this.persist(invoice, localPo?.id ?? null, result, performedBy, tx);

    await this.audit.record(
      {
        actionType: 'INVOICE_MATCH_VERIFIED',
        invoiceId: invoice.id,
        performedBy,
        newValue: {
          matchStatus: result.matchStatus,
          matchType: MatchType.TWO_WAY,
          discrepancyCount: result.discrepancies.length,
          blocking: result.blockingDiscrepancies.map((d) => d.fieldName),
          allocations: result.lineAllocations.length,
        },
        notes:
          result.matchStatus === MatchStatus.MATCHED
            ? '2-way line-level match passed'
            : `2-way match failed: ${result.blockingDiscrepancies
                .map((d) => d.message)
                .join(' ')}`,
      },
      tx,
    );

    this.logger.log(
      `Invoice ${invoice.id} 2-way match: ${result.matchStatus} ` +
        `(${result.blockingDiscrepancies.length} blocking / ${result.discrepancies.length} total, ` +
        `${result.lineAllocations.length} allocations)`,
    );

    return result;
  }

  /**
   * Pure evaluation of the line-level 2-way match rules. No I/O - the PO, its
   * lines and the invoice lines are passed in so this is trivially unit-testable.
   *
   * Rules (all blocking): PO present + found, currency matches, supplier matches;
   * then per invoice line the corresponding PO line (by itemCode) must exist,
   * its unit price must equal the PO unit price, and the aggregate invoice
   * quantity for a PO line must not exceed that line's remaining quantity.
   */
  evaluate(
    invoice: Invoice,
    po: MatchablePo | null,
    poLines: MatchablePoLine[],
    invoiceLines: MatchableInvoiceLine[],
  ): MatchResult {
    const discrepancies: MatchDiscrepancyResult[] = [];
    const lineAllocations: LineAllocation[] = [];
    const poNumber = invoice.poNumber?.trim() || null;

    const poNumberMatch = !!po;
    let currencyMatch: boolean | null = null;
    let supplierMatch: boolean | null = null;
    let priceMatch: boolean | null = null;
    let quantityMatch: boolean | null = null;

    // ---- Header checks ------------------------------------------------------
    if (!poNumber) {
      discrepancies.push({
        fieldName: 'poNumber',
        invoiceValue: null,
        poValue: null,
        differenceAmount: null,
        differencePct: null,
        severity: DiscrepancySeverity.CRITICAL,
        discrepancyType: DiscrepancyType.OTHER,
        blocking: true,
        message: 'Invoice has no PO number - cannot perform a 2-way match.',
      });
    } else if (!po) {
      discrepancies.push({
        fieldName: 'poNumber',
        invoiceValue: poNumber,
        poValue: null,
        differenceAmount: null,
        differencePct: null,
        severity: DiscrepancySeverity.CRITICAL,
        discrepancyType: DiscrepancyType.OTHER,
        blocking: true,
        message: `Purchase order ${poNumber} not found in the purchase_orders table (seed).`,
      });
    }

    if (po) {
      const invCurrency = (invoice.currency || '').trim().toUpperCase();
      const poCurrency = (po.currency || '').trim().toUpperCase();
      if (invCurrency && poCurrency) {
        currencyMatch = invCurrency === poCurrency;
        if (!currencyMatch) {
          discrepancies.push({
            fieldName: 'currency',
            invoiceValue: invCurrency,
            poValue: poCurrency,
            differenceAmount: null,
            differencePct: null,
            severity: DiscrepancySeverity.HIGH,
            discrepancyType: DiscrepancyType.OTHER,
            blocking: true,
            message: `Currency mismatch: invoice ${invCurrency} vs PO ${poCurrency}.`,
          });
        }
      }

      const invSupplier = (invoice.supplierName || '').trim().toLowerCase();
      const poSupplier = (po.supplierName || '').trim().toLowerCase();
      if (invSupplier && poSupplier) {
        supplierMatch = invSupplier === poSupplier;
        if (!supplierMatch) {
          discrepancies.push({
            fieldName: 'supplierName',
            invoiceValue: invoice.supplierName ?? null,
            poValue: po.supplierName ?? null,
            differenceAmount: null,
            differencePct: null,
            severity: DiscrepancySeverity.HIGH,
            discrepancyType: DiscrepancyType.OTHER,
            blocking: true,
            message: `Supplier name mismatch: invoice '${invoice.supplierName}' vs PO '${po.supplierName}'.`,
          });
        }
      }
    }

    // ---- Invoice-total internal consistency --------------------------------
    // Each line total is quantity x unitPrice; the subtotal must equal the sum
    // of those, and the declared total must equal subtotal - discount + tax.
    // The OCR "send for matching" gate already enforces this, but re-check here
    // (independent of the PO) so an invoice created by any other path can never
    // be MATCHED with internally inconsistent totals. Blocking.
    {
      const priced = invoiceLines.filter(
        (il) => il.quantity != null && il.unitPrice != null,
      );
      if (priced.length > 0) {
        const computedSubtotal = priced.reduce(
          (sum, il) => sum + Number(il.quantity) * Number(il.unitPrice),
          0,
        );
        const subtotal =
          invoice.subtotal != null ? Number(invoice.subtotal) : computedSubtotal;
        const discount = invoice.discount != null ? Number(invoice.discount) : 0;
        const tax = invoice.taxAmount != null ? Number(invoice.taxAmount) : 0;
        const total = Number(invoice.totalAmount ?? 0);
        const expectedTotal = subtotal - discount + tax;
        const linesVsSubtotal = Math.abs(computedSubtotal - subtotal) > MONEY_EPS;
        const headerMath = Math.abs(total - expectedTotal) > MONEY_EPS;
        if (linesVsSubtotal || headerMath) {
          discrepancies.push({
            fieldName: 'invoiceTotal',
            invoiceValue: total.toFixed(2),
            poValue: expectedTotal.toFixed(2),
            differenceAmount: total - expectedTotal,
            differencePct: null,
            severity: DiscrepancySeverity.CRITICAL,
            discrepancyType: DiscrepancyType.OTHER,
            blocking: true,
            message:
              'Invoice total is not internally consistent: line items sum to ' +
              `${computedSubtotal.toFixed(2)}, subtotal ${subtotal.toFixed(2)}, ` +
              `declared total ${total.toFixed(2)} vs expected subtotal - ` +
              `discount + tax (${expectedTotal.toFixed(2)}).`,
          });
        }
      }
    }

    // ---- Line-item checks ---------------------------------------------------
    if (po) {
      if (poLines.length === 0) {
        discrepancies.push({
          fieldName: 'poLines',
          invoiceValue: null,
          poValue: null,
          differenceAmount: null,
          differencePct: null,
          severity: DiscrepancySeverity.CRITICAL,
          discrepancyType: DiscrepancyType.OTHER,
          blocking: true,
          message: `Purchase order ${poNumber} has no line items to match against.`,
        });
      }
      if (invoiceLines.length === 0) {
        discrepancies.push({
          fieldName: 'invoiceLines',
          invoiceValue: null,
          poValue: null,
          differenceAmount: null,
          differencePct: null,
          severity: DiscrepancySeverity.CRITICAL,
          discrepancyType: DiscrepancyType.OTHER,
          blocking: true,
          message:
            'Invoice has no line items - cannot perform a line-level match.',
        });
      }

      // Index PO lines by normalized itemCode (first wins on duplicates).
      const poByItem = new Map<string, MatchablePoLine>();
      for (const pl of poLines) {
        const key = itemKey(pl.itemCode);
        if (key && !poByItem.has(key)) poByItem.set(key, pl);
      }

      // Accumulate invoice quantity/amount per PO line so several invoice lines
      // (or repeats) draw a single line's remaining correctly.
      const agg = new Map<
        string,
        { qty: number; amount: number; line: MatchablePoLine; invLineIds: Array<string | null> }
      >();

      let sawPricedLine = false;
      let priceOk = true;

      for (const il of invoiceLines) {
        const key = itemKey(il.itemCode);
        const pl = key ? poByItem.get(key) : undefined;
        if (!pl) {
          discrepancies.push({
            fieldName: 'itemCode',
            invoiceValue: il.itemCode ?? null,
            poValue: null,
            differenceAmount: null,
            differencePct: null,
            severity: DiscrepancySeverity.HIGH,
            discrepancyType: DiscrepancyType.OTHER,
            blocking: true,
            message: `Invoice line item '${il.itemCode ?? '(no item code)'}' has no matching PO line.`,
            invoiceLineId: il.id ?? null,
          });
          continue;
        }

        sawPricedLine = true;
        const invPrice = Number(il.unitPrice ?? 0);
        const poPrice = Number(pl.unitPrice ?? 0);
        if (Math.abs(invPrice - poPrice) > MONEY_EPS) {
          priceOk = false;
          discrepancies.push({
            fieldName: 'unitPrice',
            invoiceValue: invPrice.toFixed(4),
            poValue: poPrice.toFixed(4),
            differenceAmount: invPrice - poPrice,
            differencePct: poPrice > 0 ? ((invPrice - poPrice) / poPrice) * 100 : null,
            severity: DiscrepancySeverity.HIGH,
            discrepancyType: DiscrepancyType.UNIT_PRICE_MISMATCH,
            blocking: true,
            message:
              `Unit price mismatch for '${pl.itemCode}': invoice ${invPrice.toFixed(4)} ` +
              `vs PO ${poPrice.toFixed(4)}.`,
            invoiceLineId: il.id ?? null,
            purchaseOrderLineId: pl.id,
          });
        }

        const qty = Number(il.quantity ?? 0);
        // Amount drawn is computed against the PO unit price (the matched price).
        const amount = qty * poPrice;
        const cur = agg.get(pl.id) ?? {
          qty: 0,
          amount: 0,
          line: pl,
          invLineIds: [],
        };
        cur.qty += qty;
        cur.amount += amount;
        cur.invLineIds.push(il.id ?? null);
        agg.set(pl.id, cur);
      }

      // Quantity vs remaining, per PO line.
      let sawQtyLine = false;
      let qtyOk = true;
      for (const [poLineId, a] of agg) {
        sawQtyLine = true;
        const remaining = availableQty(a.line);
        if (a.qty > remaining + QTY_EPS) {
          qtyOk = false;
          discrepancies.push({
            fieldName: 'quantity',
            invoiceValue: a.qty.toString(),
            poValue: remaining.toString(),
            differenceAmount: null,
            differencePct: null,
            severity: DiscrepancySeverity.HIGH,
            discrepancyType: DiscrepancyType.QUANTITY_MISMATCH,
            blocking: true,
            message:
              `Quantity for '${a.line.itemCode}' exceeds remaining: invoice ${a.qty} ` +
              `vs remaining ${remaining}.`,
            purchaseOrderLineId: poLineId,
          });
        } else {
          lineAllocations.push({
            purchaseOrderLineId: poLineId,
            invoiceLineId: a.invLineIds.length === 1 ? a.invLineIds[0] : null,
            quantity: a.qty,
            amount: a.amount,
          });
        }
      }

      priceMatch = sawPricedLine ? priceOk : null;
      quantityMatch = sawQtyLine ? qtyOk : null;
    }

    const blockingDiscrepancies = discrepancies.filter((d) => d.blocking);
    const matchStatus =
      blockingDiscrepancies.length > 0
        ? MatchStatus.EXCEPTION
        : MatchStatus.MATCHED;

    // Only reserve when the match actually passes.
    const finalAllocations =
      matchStatus === MatchStatus.MATCHED ? lineAllocations : [];

    const poAvailableAmount = po
      ? poLines.reduce(
          (sum, pl) => sum + availableQty(pl) * Number(pl.unitPrice ?? 0),
          0,
        )
      : null;
    const invoiceAmount = Number(invoice.totalAmount ?? 0);
    const poAmount = po ? Number(po.totalAmount ?? po.orderTotal ?? 0) : null;
    const amountMatch =
      po && poAvailableAmount !== null
        ? invoiceAmount <= poAvailableAmount + MONEY_EPS
        : null;

    return {
      matchStatus,
      discrepancies,
      blockingDiscrepancies,
      lineAllocations: finalAllocations,
      flags: {
        poNumberMatch,
        currencyMatch,
        supplierMatch,
        priceMatch,
        quantityMatch,
        amountMatch,
      },
      poAvailableAmount,
      invoiceAmount,
      poAmount,
    };
  }

  /** Upsert the MatchRecord and replace its discrepancy rows (idempotent). */
  private async persist(
    invoice: Invoice,
    poId: string | null,
    result: MatchResult,
    performedBy: string | null,
    tx?: Transaction,
  ): Promise<MatchRecord> {
    const exceptionReason =
      result.matchStatus === MatchStatus.MATCHED
        ? null
        : result.blockingDiscrepancies
            .map((d) => d.message)
            .join(' | ')
            .slice(0, 1000);

    const payload = {
      invoiceId: invoice.id,
      poId,
      grnId: null,
      matchedByUser: performedBy ?? null,
      matchType: MatchType.TWO_WAY,
      matchStatus: result.matchStatus,
      amountMatch: result.flags.amountMatch,
      quantityMatch: result.flags.quantityMatch,
      vendorMatch: result.flags.supplierMatch,
      poNumberMatch: result.flags.poNumberMatch,
      supplierMatch: result.flags.supplierMatch,
      currencyMatch: result.flags.currencyMatch,
      priceMatch: result.flags.priceMatch,
      invoiceAmount: result.invoiceAmount,
      poAmount: result.poAmount,
      poAvailableAmount: result.poAvailableAmount,
      grnAmount: null,
      // Stored as a percentage value to match DECIMAL(6,2), e.g. 2.00.
      tolerancePct: this.tolerancePct * 100,
      discrepancyCount: result.discrepancies.length,
      matchedBy: 'workbench',
      matchedAt: new Date(),
      exceptionReason,
    };

    const existing = await this.matchModel.findOne({
      where: { invoiceId: invoice.id },
      transaction: tx,
    });
    const record = existing
      ? await existing.update(payload, { transaction: tx })
      : await this.matchModel.create(payload as unknown as MatchRecord, {
          transaction: tx,
        });

    await this.discrepancyModel.destroy({
      where: { matchRecordId: record.id },
      transaction: tx,
    });
    if (result.discrepancies.length > 0) {
      await this.discrepancyModel.bulkCreate(
        result.discrepancies.map(
          (d) =>
            ({
              matchRecordId: record.id,
              invoiceLineId: d.invoiceLineId ?? null,
              purchaseOrderLineId: d.purchaseOrderLineId ?? null,
              fieldName: d.fieldName,
              invoiceValue: d.invoiceValue,
              poValue: d.poValue,
              grnValue: null,
              differenceAmount: d.differenceAmount,
              differencePct: d.differencePct,
              severity: d.severity,
              discrepancyType: d.discrepancyType,
              blocking: d.blocking,
              resolved: false,
            }) as unknown as MatchDiscrepancy,
        ),
        { transaction: tx },
      );
    }

    return record;
  }
}
