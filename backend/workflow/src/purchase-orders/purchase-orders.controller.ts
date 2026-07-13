import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Seeded PO read for the 2-way match workbench (UI-B). Serves the workflow
 * service's own `purchase_orders` / `purchase_order_lines` tables so the PO
 * panel matches the seed-only match gate. Each response line exposes the
 * remaining (undrawn) quantity and amount so the workbench can show how much of
 * the PO is still available across multiple invoices.
 */
@ApiTags('Purchase Orders')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly poService: PurchaseOrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'List every purchase order header + line items (side-by-side view)',
  })
  async listPurchaseOrders() {
    const [pos, allLines] = await Promise.all([
      this.poService.findAll(),
      this.poService.findAllLines(),
    ]);
    const linesByPo = new Map<string, PurchaseOrderLine[]>();
    for (const line of allLines) {
      const bucket = linesByPo.get(line.purchaseOrderId) ?? [];
      bucket.push(line);
      linesByPo.set(line.purchaseOrderId, bucket);
    }
    return {
      success: true,
      count: pos.length,
      data: pos.map((po) => this.toResponse(po, linesByPo.get(po.id) ?? [])),
    };
  }

  @Get(':poNumber')
  @ApiOperation({
    summary: 'Fetch a seeded purchase order header + its line items by PO number',
  })
  async getPurchaseOrder(@Param('poNumber') poNumber: string) {
    const po = await this.poService.findByPoNumber(poNumber);
    if (!po) {
      throw new NotFoundException(`Purchase order ${poNumber} not found`);
    }
    const lines = await this.poService.findLines(po.id);
    return { success: true, data: this.toResponse(po, lines) };
  }

  /** Map the seeded PO entity + its lines onto the shape the workbench expects. */
  private toResponse(po: PurchaseOrder, lines: PurchaseOrderLine[]) {
    const totalAmount = Number(po.totalAmount ?? po.orderTotal ?? 0);
    const committed = Number(po.reservedAmount) + Number(po.consumedAmount);
    const remainingAmount = Math.max(0, totalAmount - committed);

    const lineItems = lines.length
      ? lines.map((l) => this.toLine(l))
      : this.legacyLine(po, totalAmount);

    return {
      poNumber: po.poNumber,
      supplierName: po.supplierName,
      supplierCode: po.supplierCode,
      vendorCode: po.supplierCode,
      plantId: po.plantId,
      currency: po.currency,
      totalAmount,
      remainingAmount,
      status: po.status,
      issuedDate: po.issuedDate,
      expectedDeliveryDate: po.expectedDeliveryDate,
      lineItems,
    };
  }

  /** A real purchase_order_lines row, with remaining (undrawn) qty + amount. */
  private toLine(l: PurchaseOrderLine) {
    const ordered = l.orderQuantity != null ? Number(l.orderQuantity) : 0;
    const drawn = Number(l.reservedQuantity) + Number(l.consumedQuantity);
    const remainingQty = Math.max(0, ordered - drawn);
    const unitPrice = l.unitPrice != null ? Number(l.unitPrice) : 0;
    return {
      lineNum: l.lineNumber,
      itemCode: l.itemCode,
      description: l.description,
      orderedQty: ordered,
      remainingQty,
      unitPrice,
      lineTotal: l.lineTotal != null ? Number(l.lineTotal) : remainingQty * unitPrice,
      remainingAmount: Math.round(remainingQty * unitPrice * 100) / 100,
      unitOfMeasure: l.unitOfMeasure ?? '',
    };
  }

  /**
   * Fallback for header-only POs (no line rows): synthesise a single line from
   * the denormalised header columns, as the original seed model did.
   */
  private legacyLine(po: PurchaseOrder, totalAmount: number) {
    if (!po.partNumberDescription) return [];
    const orderedQty = po.quantity != null ? Number(po.quantity) : 0;
    const unitPrice = po.unitPrice != null ? Number(po.unitPrice) : 0;
    const lineTotal = po.lineTotal != null ? Number(po.lineTotal) : totalAmount;
    return [
      {
        lineNum: 1,
        itemCode: null,
        description: po.partNumberDescription,
        orderedQty,
        remainingQty: orderedQty,
        unitPrice,
        lineTotal,
        remainingAmount: lineTotal,
        unitOfMeasure: '',
      },
    ];
  }
}
