import { ConfigService } from '@nestjs/config';
import { EscalationService } from './escalation.service';
import { InvoiceStatus } from '../common/enums/invoice-status.enum';

describe('EscalationService', () => {
  const fixedNow = new Date('2026-05-01T12:00:00.000Z');

  function makeService(opts: {
    invoices: Array<Partial<{
      id: string;
      invoiceNumber: string;
      supplierName: string;
      totalAmount: number;
      currency: string;
      status: InvoiceStatus;
      currentApproverId: string | null;
      pendingApprovalSince: Date | null;
      lastEscalatedAt: Date | null;
    }>>;
    user: { id: string; email: string; fullName: string; managerId: string | null };
    manager?: { id: string; email: string; fullName: string };
  }) {
    const savedInvoices: unknown[] = [];

    const invoiceModel = {
      findAll: jest.fn().mockImplementation(async () =>
        opts.invoices.map((inv) => ({
          ...inv,
          save: jest.fn().mockImplementation(function (this: unknown) {
            savedInvoices.push(this);
            return Promise.resolve(this);
          }),
        })),
      ),
    };

    const users = {
      findById: jest.fn().mockImplementation(async (id: string) => {
        if (opts.user.id === id) return opts.user;
        if (opts.manager?.id === id) return opts.manager;
        throw new Error(`unknown user ${id}`);
      }),
    };

    const sendMail = jest.fn().mockResolvedValue(undefined);
    const notifications = { sendApprovalRequired: sendMail };

    const audit = { record: jest.fn().mockResolvedValue(undefined) };

    const config = {
      get: (key: string) =>
        ({ 'workflow.slaPendingApprovalHours': 48 }[key]),
    } as unknown as ConfigService;

    const svc = new EscalationService(
      invoiceModel as never,
      users as never,
      notifications as never,
      audit as never,
      config,
    );

    return { svc, sendMail, audit, savedInvoices, users };
  }

  beforeAll(() => jest.useFakeTimers().setSystemTime(fixedNow));
  afterAll(() => jest.useRealTimers());

  test('escalates a breached invoice to approver + manager', async () => {
    const breached = {
      id: 'inv1',
      invoiceNumber: 'INV-2026-X',
      supplierName: 'Acme',
      totalAmount: 12_345,
      currency: 'USD',
      status: InvoiceStatus.PENDING_APPROVAL,
      currentApproverId: 'pm1',
      pendingApprovalSince: new Date(fixedNow.getTime() - 60 * 60 * 1000 * 50),
      lastEscalatedAt: null,
    };
    const { svc, sendMail, audit } = makeService({
      invoices: [breached],
      user: { id: 'pm1', email: 'pm@x', fullName: 'PM', managerId: 'fd1' },
      manager: { id: 'fd1', email: 'fd@x', fullName: 'FD' },
    });

    const result = await svc.runOnce();
    expect(result).toEqual({ checked: 1, escalated: 1 });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[0][0].isEscalation).toBe(true);
    expect(sendMail.mock.calls[0][0].to).toBe('pm@x');
    expect(sendMail.mock.calls[1][0].to).toBe('fd@x');

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].actionType).toBe('SLA_BREACH');
  });

  test('still escalates an approver who has no manager (just notifies approver)', async () => {
    const breached = {
      id: 'inv2',
      invoiceNumber: 'INV-2026-Y',
      supplierName: 'Acme',
      totalAmount: 100,
      currency: 'USD',
      status: InvoiceStatus.PENDING_APPROVAL,
      currentApproverId: 'vp1',
      pendingApprovalSince: new Date(fixedNow.getTime() - 60 * 60 * 1000 * 100),
      lastEscalatedAt: null,
    };
    const { svc, sendMail, audit } = makeService({
      invoices: [breached],
      user: { id: 'vp1', email: 'vp@x', fullName: 'VP', managerId: null },
    });

    const result = await svc.runOnce();
    expect(result.escalated).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].newValue.escalatedTo).toBeNull();
  });
});
