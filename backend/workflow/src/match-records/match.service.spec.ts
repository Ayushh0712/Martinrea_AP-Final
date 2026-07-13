import {
  MatchableInvoiceLine,
  MatchablePoLine,
  MatchService,
} from './match.service';
import { MatchStatus } from './entities/match-record.entity';
import { DiscrepancyType } from './entities/match-discrepancy.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';

type InvoiceLike = Partial<Invoice> & {
  id: string;
  poNumber: string | null;
  currency: string;
  totalAmount: number;
  supplierName: string;
};

function makeInvoice(overrides: Partial<InvoiceLike> = {}): Invoice {
  return {
    id: 'inv-1',
    poNumber: 'PO-2001',
    currency: 'USD',
    totalAmount: 1_000,
    supplierName: 'Acme Steel Co.',
    ...overrides,
  } as unknown as Invoice;
}

function makePo(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    poNumber: 'PO-2001',
    currency: 'USD',
    totalAmount: 1_000,
    orderTotal: 1_000,
    supplierName: 'Acme Steel Co.',
    ...overrides,
  } as unknown as PurchaseOrder;
}

function makePoLine(overrides: Partial<MatchablePoLine> = {}): MatchablePoLine {
  return {
    id: 'pol-bolt',
    lineNumber: 1,
    itemCode: 'BOLT',
    unitPrice: 10,
    orderQuantity: 100,
    reservedQuantity: 0,
    consumedQuantity: 0,
    ...overrides,
  };
}

function makeInvLine(
  overrides: Partial<MatchableInvoiceLine> = {},
): MatchableInvoiceLine {
  return {
    id: 'il-bolt',
    lineNumber: 1,
    itemCode: 'BOLT',
    unitPrice: 10,
    quantity: 30,
    ...overrides,
  };
}

/** The .md worked example: PO-2001 with Bolt/Nut/Washer, all fully available. */
function boltNutWasherPoLines(): MatchablePoLine[] {
  return [
    makePoLine({ id: 'pol-bolt', itemCode: 'BOLT', unitPrice: 10, orderQuantity: 100 }),
    makePoLine({ id: 'pol-nut', itemCode: 'NUT', unitPrice: 5, orderQuantity: 50 }),
    makePoLine({ id: 'pol-washer', itemCode: 'WASHER', unitPrice: 2, orderQuantity: 80 }),
  ];
}

function invoiceA(): MatchableInvoiceLine[] {
  return [
    makeInvLine({ id: 'ila-bolt', itemCode: 'BOLT', unitPrice: 10, quantity: 30 }),
    makeInvLine({ id: 'ila-nut', itemCode: 'NUT', unitPrice: 5, quantity: 20 }),
    makeInvLine({ id: 'ila-washer', itemCode: 'WASHER', unitPrice: 2, quantity: 10 }),
  ];
}

/** Builds a service with stub models that capture what was persisted. */
function newService(opts: {
  po?: PurchaseOrder | null;
  poLines?: MatchablePoLine[];
  invoiceLines?: MatchableInvoiceLine[];
} = {}) {
  const po = opts.po === undefined ? makePo() : opts.po;
  const poLines = opts.poLines ?? [];
  const invoiceLines = opts.invoiceLines ?? [];

  const created: Record<string, unknown>[] = [];
  const bulk: Record<string, unknown>[][] = [];
  const destroyed: unknown[] = [];
  const audited: Record<string, unknown>[] = [];

  const matchModel = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      created.push(payload);
      return { id: 'mr-1', ...payload };
    }),
  };
  const discrepancyModel = {
    destroy: jest.fn().mockImplementation(async (arg: unknown) => {
      destroyed.push(arg);
      return 0;
    }),
    bulkCreate: jest.fn().mockImplementation(async (rows: Record<string, unknown>[]) => {
      bulk.push(rows);
      return rows;
    }),
  };
  const poModel = {
    findOne: jest.fn().mockResolvedValue(po),
  };
  const poLineModel = {
    findAll: jest.fn().mockResolvedValue(poLines),
  };
  const invoiceLineModel = {
    findAll: jest.fn().mockResolvedValue(invoiceLines),
  };
  const audit = {
    record: jest.fn().mockImplementation(async (entry: Record<string, unknown>) => {
      audited.push(entry);
      return entry;
    }),
  };

  const svc = new MatchService(
    matchModel as unknown as never,
    discrepancyModel as unknown as never,
    poModel as unknown as never,
    poLineModel as unknown as never,
    invoiceLineModel as unknown as never,
    audit as unknown as never,
  );

  return {
    svc,
    matchModel,
    discrepancyModel,
    poModel,
    poLineModel,
    invoiceLineModel,
    audit,
    created,
    bulk,
    destroyed,
    audited,
  };
}

describe('MatchService (line-level 2-way)', () => {
  describe('evaluate - header rules', () => {
    test('missing PO number -> EXCEPTION (blocking)', () => {
      const { svc } = newService();
      const r = svc.evaluate(makeInvoice({ poNumber: null }), null, [], []);
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.fieldName)).toContain('poNumber');
    });

    test('PO not found -> EXCEPTION (blocking)', () => {
      const { svc } = newService();
      const r = svc.evaluate(makeInvoice({ poNumber: 'PO-9999' }), null, [], []);
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies[0].message).toMatch(/not found/i);
    });

    test('currency mismatch -> EXCEPTION (blocking)', () => {
      const { svc } = newService();
      const r = svc.evaluate(
        makeInvoice({ currency: 'USD' }),
        makePo({ currency: 'MXN' }),
        boltNutWasherPoLines(),
        invoiceA(),
      );
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.fieldName)).toContain('currency');
    });

    test('supplier-name mismatch -> EXCEPTION (now blocking)', () => {
      const { svc } = newService();
      const r = svc.evaluate(
        makeInvoice({ supplierName: 'Totally Different LLC' }),
        makePo({ supplierName: 'Acme Steel Co.' }),
        boltNutWasherPoLines(),
        invoiceA(),
      );
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.fieldName)).toContain('supplierName');
    });
  });

  describe('evaluate - line-item rules', () => {
    test('clean line match -> MATCHED with per-line allocations', () => {
      const { svc } = newService();
      // invoiceA() lines sum to 420 (30x10 + 20x5 + 10x2); the declared total
      // must agree or the internal-consistency gate blocks the match.
      const r = svc.evaluate(
        makeInvoice({ totalAmount: 420 }),
        makePo(),
        boltNutWasherPoLines(),
        invoiceA(),
      );
      expect(r.matchStatus).toBe(MatchStatus.MATCHED);
      expect(r.blockingDiscrepancies).toHaveLength(0);
      expect(r.lineAllocations).toHaveLength(3);
      const bolt = r.lineAllocations.find((a) => a.purchaseOrderLineId === 'pol-bolt');
      expect(bolt).toMatchObject({ quantity: 30, amount: 300 });
      expect(r.flags).toMatchObject({
        priceMatch: true,
        quantityMatch: true,
        supplierMatch: true,
        currencyMatch: true,
        poNumberMatch: true,
      });
    });

    test('quantity exceeds remaining -> EXCEPTION (QUANTITY_MISMATCH, blocking)', () => {
      const { svc } = newService();
      // Bolt has 20 remaining (order 100, reserved 30, consumed 50); invoice wants 25.
      const poLines = [
        makePoLine({ id: 'pol-bolt', itemCode: 'BOLT', orderQuantity: 100, reservedQuantity: 30, consumedQuantity: 50, unitPrice: 10 }),
      ];
      const r = svc.evaluate(
        makeInvoice(),
        makePo(),
        poLines,
        [makeInvLine({ itemCode: 'BOLT', quantity: 25, unitPrice: 10 })],
      );
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.discrepancyType)).toContain(
        DiscrepancyType.QUANTITY_MISMATCH,
      );
      expect(r.lineAllocations).toHaveLength(0);
    });

    test('unit price mismatch -> EXCEPTION (UNIT_PRICE_MISMATCH, blocking)', () => {
      const { svc } = newService();
      const r = svc.evaluate(
        makeInvoice(),
        makePo(),
        [makePoLine({ itemCode: 'BOLT', unitPrice: 10, orderQuantity: 100 })],
        [makeInvLine({ itemCode: 'BOLT', unitPrice: 12, quantity: 30 })],
      );
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.discrepancyType)).toContain(
        DiscrepancyType.UNIT_PRICE_MISMATCH,
      );
    });

    test('invoice line with no corresponding PO line -> EXCEPTION (blocking)', () => {
      const { svc } = newService();
      const r = svc.evaluate(
        makeInvoice(),
        makePo(),
        [makePoLine({ itemCode: 'BOLT', unitPrice: 10, orderQuantity: 100 })],
        [makeInvLine({ id: 'il-x', itemCode: 'FREIGHT', unitPrice: 50, quantity: 1 })],
      );
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.fieldName)).toContain('itemCode');
    });

    test('empty invoice lines -> EXCEPTION (blocking)', () => {
      const { svc } = newService();
      const r = svc.evaluate(makeInvoice(), makePo(), boltNutWasherPoLines(), []);
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.fieldName)).toContain('invoiceLines');
    });

    test('empty PO lines -> EXCEPTION (blocking)', () => {
      const { svc } = newService();
      const r = svc.evaluate(makeInvoice(), makePo(), [], invoiceA());
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.fieldName)).toContain('poLines');
    });

    test('quantity exactly equal to remaining -> MATCHED (zero boundary)', () => {
      const { svc } = newService();
      // Bolt remaining is exactly 20; invoice draws exactly 20 -> remaining hits 0.
      const poLines = [
        makePoLine({ id: 'pol-bolt', itemCode: 'BOLT', orderQuantity: 100, reservedQuantity: 30, consumedQuantity: 50, unitPrice: 10 }),
      ];
      const r = svc.evaluate(
        makeInvoice({ totalAmount: 200 }),
        makePo(),
        poLines,
        [makeInvLine({ itemCode: 'BOLT', quantity: 20, unitPrice: 10 })],
      );
      expect(r.matchStatus).toBe(MatchStatus.MATCHED);
      expect(r.lineAllocations).toHaveLength(1);
      expect(r.lineAllocations[0]).toMatchObject({ quantity: 20, amount: 200 });
    });

    test('repeated invoice lines for one PO line aggregate against remaining', () => {
      const { svc } = newService();
      const poLines = [
        makePoLine({ id: 'pol-bolt', itemCode: 'BOLT', orderQuantity: 100, unitPrice: 10 }),
      ];
      // 60 + 50 = 110 > 100 remaining -> quantity mismatch.
      const r = svc.evaluate(
        makeInvoice(),
        makePo(),
        poLines,
        [
          makeInvLine({ id: 'il-1', itemCode: 'BOLT', quantity: 60, unitPrice: 10 }),
          makeInvLine({ id: 'il-2', itemCode: 'BOLT', quantity: 50, unitPrice: 10 }),
        ],
      );
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies.map((d) => d.discrepancyType)).toContain(
        DiscrepancyType.QUANTITY_MISMATCH,
      );
    });
  });

  describe('verifyAndRecord (persistence + audit)', () => {
    const realFetch = global.fetch;
    beforeEach(() => {
      global.fetch = jest.fn() as unknown as typeof fetch;
    });
    afterEach(() => {
      global.fetch = realFetch;
    });

    test('persists a MATCHED MatchRecord + audit on a clean line match', async () => {
      const ctx = newService({
        po: makePo(),
        poLines: boltNutWasherPoLines(),
        invoiceLines: invoiceA(),
      });
      const r = await ctx.svc.verifyAndRecord(
        makeInvoice({ totalAmount: 420 }),
        'user-1',
      );
      expect(r.matchStatus).toBe(MatchStatus.MATCHED);
      expect(ctx.matchModel.create).toHaveBeenCalledTimes(1);
      expect(ctx.created[0]).toMatchObject({
        invoiceId: 'inv-1',
        matchStatus: MatchStatus.MATCHED,
        poNumberMatch: true,
        priceMatch: true,
        quantityMatch: true,
      });
      expect(ctx.audited[0]).toMatchObject({ actionType: 'INVOICE_MATCH_VERIFIED' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('persists blocking discrepancy rows when the line match fails', async () => {
      const ctx = newService({
        po: makePo(),
        poLines: [makePoLine({ itemCode: 'BOLT', unitPrice: 10, orderQuantity: 100 })],
        invoiceLines: [makeInvLine({ itemCode: 'BOLT', unitPrice: 12, quantity: 30 })],
      });
      const r = await ctx.svc.verifyAndRecord(makeInvoice(), 'user-1');
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(ctx.discrepancyModel.bulkCreate).toHaveBeenCalledTimes(1);
      expect(ctx.bulk[0].length).toBeGreaterThan(0);
      expect(ctx.bulk[0][0]).toMatchObject({ blocking: true });
      expect(ctx.created[0]).toMatchObject({ matchStatus: MatchStatus.EXCEPTION });
    });

    test('missing seed row -> EXCEPTION (not found), no CMS lookup', async () => {
      const ctx = newService({ po: null });
      const r = await ctx.svc.verifyAndRecord(makeInvoice({ poNumber: 'PO-9999' }), 'user-1');
      expect(r.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(r.blockingDiscrepancies[0].message).toMatch(/not found/i);
      expect(ctx.created[0]).toMatchObject({ poNumberMatch: false });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
