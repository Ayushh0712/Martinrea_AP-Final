import { sanitizePoHeaderUpdate, sanitizePoLineUpdate } from './po-upsert';
import { rollupLineStatus, rollupPoStatus } from './drawdown-rollup';
import { PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PurchaseOrderLineStatus } from './entities/purchase-order-line.entity';

describe('sanitizePoHeaderUpdate', () => {
  const header = {
    poNumber: 'PO-3008',
    supplierName: 'Blackwood Metal Works',
    currency: 'USD',
    totalAmount: 28_170.3,
    orderTotal: 28_170.3,
    reservedAmount: 0,
    consumedAmount: 0,
    status: 'OPEN',
  };

  test('strips the allocation-owned draw-down rollups', () => {
    const out = sanitizePoHeaderUpdate(header);
    expect(out).not.toHaveProperty('reservedAmount');
    expect(out).not.toHaveProperty('consumedAmount');
  });

  test('strips a non-terminal status (rollup-derived)', () => {
    expect(sanitizePoHeaderUpdate(header)).not.toHaveProperty('status');
    expect(
      sanitizePoHeaderUpdate({ ...header, status: 'PARTIALLY_RECEIVED' }),
    ).not.toHaveProperty('status');
  });

  test.each([PurchaseOrderStatus.CLOSED, PurchaseOrderStatus.CANCELLED])(
    'passes the terminal status %s through (explicit ERP signal)',
    (status) => {
      expect(sanitizePoHeaderUpdate({ ...header, status })).toHaveProperty(
        'status',
        status,
      );
    },
  );

  test('keeps every descriptive field so PO amendments still apply', () => {
    expect(sanitizePoHeaderUpdate(header)).toMatchObject({
      poNumber: 'PO-3008',
      supplierName: 'Blackwood Metal Works',
      currency: 'USD',
      totalAmount: 28_170.3,
      orderTotal: 28_170.3,
    });
  });
});

describe('sanitizePoLineUpdate', () => {
  const line = {
    lineNumber: 1,
    itemCode: 'STL-CR-0.18x36',
    description: 'Cold-rolled steel sheet',
    orderQuantity: 40,
    reservedQuantity: 0,
    consumedQuantity: 0,
    unitPrice: 338.02,
    lineTotal: 13_520.8,
    status: 'OPEN',
  };

  test('strips draw-down counters and the rollup-derived status', () => {
    const out = sanitizePoLineUpdate(line);
    expect(out).not.toHaveProperty('reservedQuantity');
    expect(out).not.toHaveProperty('consumedQuantity');
    expect(out).not.toHaveProperty('status');
  });

  test('keeps every descriptive field so line amendments still apply', () => {
    expect(sanitizePoLineUpdate(line)).toEqual({
      lineNumber: 1,
      itemCode: 'STL-CR-0.18x36',
      description: 'Cold-rolled steel sheet',
      orderQuantity: 40,
      unitPrice: 338.02,
      lineTotal: 13_520.8,
    });
  });
});

describe('drawdown rollup rules', () => {
  test('line: no draw -> OPEN, partial -> PARTIALLY_RECEIVED, full -> FULLY_RECEIVED', () => {
    expect(
      rollupLineStatus({ orderQuantity: 40, reservedQuantity: 0, consumedQuantity: 0 }),
    ).toBe(PurchaseOrderLineStatus.OPEN);
    expect(
      rollupLineStatus({ orderQuantity: 40, reservedQuantity: 18, consumedQuantity: 0 }),
    ).toBe(PurchaseOrderLineStatus.PARTIALLY_RECEIVED);
    expect(
      rollupLineStatus({ orderQuantity: 40, reservedQuantity: 10, consumedQuantity: 30 }),
    ).toBe(PurchaseOrderLineStatus.FULLY_RECEIVED);
  });

  test('header: rolls up from committed amount and preserves terminal states', () => {
    const base = { totalAmount: 1_000, orderTotal: 1_000 };
    expect(
      rollupPoStatus({ ...base, status: PurchaseOrderStatus.OPEN, reservedAmount: 0, consumedAmount: 0 }),
    ).toBe(PurchaseOrderStatus.OPEN);
    expect(
      rollupPoStatus({ ...base, status: PurchaseOrderStatus.OPEN, reservedAmount: 300, consumedAmount: 0 }),
    ).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    expect(
      rollupPoStatus({ ...base, status: PurchaseOrderStatus.OPEN, reservedAmount: 0, consumedAmount: 1_000 }),
    ).toBe(PurchaseOrderStatus.FULLY_RECEIVED);
    expect(
      rollupPoStatus({ ...base, status: PurchaseOrderStatus.CLOSED, reservedAmount: 300, consumedAmount: 0 }),
    ).toBe(PurchaseOrderStatus.CLOSED);
    expect(
      rollupPoStatus({ ...base, status: PurchaseOrderStatus.CANCELLED, reservedAmount: 300, consumedAmount: 0 }),
    ).toBe(PurchaseOrderStatus.CANCELLED);
  });
});
