import {
  PurchaseOrderAllocationService,
  ReserveAllocation,
} from './purchase-order-allocation.service';
import { PurchaseOrderLineStatus } from './entities/purchase-order-line.entity';
import { PurchaseOrderStatus } from './entities/purchase-order.entity';
import { ReservationStatus } from '../invoices/entities/invoice-po-line-reservation.entity';

const FAKE_TX = { LOCK: { UPDATE: 'UPDATE' } } as unknown as never;

type StubLine = {
  id: string;
  purchaseOrderId: string;
  orderQuantity: number;
  reservedQuantity: number;
  consumedQuantity: number;
  unitPrice: number;
  status: PurchaseOrderLineStatus;
  save: jest.Mock;
};

type StubPo = {
  id: string;
  totalAmount: number;
  orderTotal: number;
  reservedAmount: number;
  consumedAmount: number;
  status: PurchaseOrderStatus;
  save: jest.Mock;
};

type StubReservation = {
  id: string;
  invoiceId: string;
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  reservedQuantity: number;
  reservedAmount: number;
  status: ReservationStatus;
  consumedAt: Date | null;
  releasedAt: Date | null;
  save: jest.Mock;
};

function makeLine(overrides: Partial<StubLine> = {}): StubLine {
  return {
    id: 'pol-bolt',
    purchaseOrderId: 'po-1',
    orderQuantity: 100,
    reservedQuantity: 0,
    consumedQuantity: 0,
    unitPrice: 10,
    status: PurchaseOrderLineStatus.OPEN,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePo(overrides: Partial<StubPo> = {}): StubPo {
  return {
    id: 'po-1',
    totalAmount: 1_000,
    orderTotal: 1_000,
    reservedAmount: 0,
    consumedAmount: 0,
    status: PurchaseOrderStatus.OPEN,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeReservation(overrides: Partial<StubReservation> = {}): StubReservation {
  return {
    id: 'r-1',
    invoiceId: 'inv-1',
    purchaseOrderId: 'po-1',
    purchaseOrderLineId: 'pol-bolt',
    reservedQuantity: 30,
    reservedAmount: 300,
    status: ReservationStatus.RESERVED,
    consumedAt: null,
    releasedAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function newService(opts: {
  line?: StubLine;
  po?: StubPo;
  reservations?: StubReservation[];
}) {
  const createdReservations: Record<string, unknown>[] = [];

  const poModel = {
    findByPk: jest.fn().mockResolvedValue(opts.po ?? null),
  };
  const poLineModel = {
    findByPk: jest.fn().mockResolvedValue(opts.line ?? null),
  };
  const reservationModel = {
    create: jest.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      createdReservations.push(payload);
      return payload;
    }),
    findAll: jest.fn().mockResolvedValue(opts.reservations ?? []),
  };
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const svc = new PurchaseOrderAllocationService(
    poModel as unknown as never,
    poLineModel as unknown as never,
    reservationModel as unknown as never,
    audit as unknown as never,
  );

  return { svc, poModel, poLineModel, reservationModel, audit, createdReservations };
}

describe('PurchaseOrderAllocationService', () => {
  describe('reserve', () => {
    test('increments PO line reserved qty, PO header reserved amount, and writes a RESERVED ledger row', async () => {
      const line = makeLine();
      const po = makePo();
      const ctx = newService({ line, po });
      const allocations: ReserveAllocation[] = [
        { purchaseOrderLineId: 'pol-bolt', invoiceLineId: 'il-bolt', quantity: 30, amount: 300 },
      ];

      await ctx.svc.reserve('inv-1', allocations, FAKE_TX);

      expect(line.reservedQuantity).toBe(30);
      expect(line.status).toBe(PurchaseOrderLineStatus.PARTIALLY_RECEIVED);
      expect(line.save).toHaveBeenCalled();
      expect(po.reservedAmount).toBe(300);
      expect(ctx.createdReservations[0]).toMatchObject({
        invoiceId: 'inv-1',
        purchaseOrderLineId: 'pol-bolt',
        reservedQuantity: 30,
        reservedAmount: 300,
        status: ReservationStatus.RESERVED,
      });
    });

    test('drawing a line to its full order quantity marks it FULLY_RECEIVED', async () => {
      const line = makeLine({ orderQuantity: 30 });
      const po = makePo();
      const ctx = newService({ line, po });

      await ctx.svc.reserve(
        'inv-1',
        [{ purchaseOrderLineId: 'pol-bolt', invoiceLineId: null, quantity: 30, amount: 300 }],
        FAKE_TX,
      );

      expect(line.reservedQuantity).toBe(30);
      expect(line.status).toBe(PurchaseOrderLineStatus.FULLY_RECEIVED);
    });

    test('no allocations is a no-op', async () => {
      const ctx = newService({});
      await ctx.svc.reserve('inv-1', [], FAKE_TX);
      expect(ctx.poLineModel.findByPk).not.toHaveBeenCalled();
      expect(ctx.reservationModel.create).not.toHaveBeenCalled();
    });
  });

  describe('consume', () => {
    test('moves reserved -> consumed on the line and header, marks reservation CONSUMED', async () => {
      const line = makeLine({ reservedQuantity: 30, consumedQuantity: 0 });
      const po = makePo({ reservedAmount: 300, consumedAmount: 0 });
      const reservation = makeReservation();
      const ctx = newService({ line, po, reservations: [reservation] });

      await ctx.svc.consume('inv-1', FAKE_TX);

      expect(line.reservedQuantity).toBe(0);
      expect(line.consumedQuantity).toBe(30);
      expect(po.reservedAmount).toBe(0);
      expect(po.consumedAmount).toBe(300);
      expect(reservation.status).toBe(ReservationStatus.CONSUMED);
      expect(reservation.consumedAt).toBeInstanceOf(Date);
    });

    test('no RESERVED rows is a no-op', async () => {
      const ctx = newService({ reservations: [] });
      await ctx.svc.consume('inv-1', FAKE_TX);
      expect(ctx.poLineModel.findByPk).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    test('reverts reserved qty/amount and marks reservation RELEASED', async () => {
      const line = makeLine({ reservedQuantity: 30, consumedQuantity: 0, status: PurchaseOrderLineStatus.PARTIALLY_RECEIVED });
      const po = makePo({ reservedAmount: 300, status: PurchaseOrderStatus.PARTIALLY_RECEIVED });
      const reservation = makeReservation();
      const ctx = newService({ line, po, reservations: [reservation] });

      await ctx.svc.release('inv-1', FAKE_TX);

      expect(line.reservedQuantity).toBe(0);
      expect(line.consumedQuantity).toBe(0);
      expect(line.status).toBe(PurchaseOrderLineStatus.OPEN);
      expect(po.reservedAmount).toBe(0);
      expect(po.status).toBe(PurchaseOrderStatus.OPEN);
      expect(reservation.status).toBe(ReservationStatus.RELEASED);
      expect(reservation.releasedAt).toBeInstanceOf(Date);
    });
  });
});
