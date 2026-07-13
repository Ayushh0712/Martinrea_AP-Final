import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer');

describe('NotificationsService', () => {
  const mockSendMail = jest.fn().mockResolvedValue({ accepted: ['x'] });

  beforeEach(() => {
    mockSendMail.mockClear();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });
  });

  function build(overrides: Record<string, unknown> = {}): NotificationsService {
    const config = {
      get: (key: string) =>
        ({
          'mail.enabled': true,
          'mail.host': 'localhost',
          'mail.port': 1025,
          'mail.secure': false,
          'mail.user': '',
          'mail.password': '',
          'mail.from': 'AP <noreply@martinrea.local>',
          'app.baseUrl': 'http://localhost:3000',
          'workflow.slaPendingApprovalHours': 48,
          ...overrides,
        }[key]),
    } as unknown as ConfigService;
    const svc = new NotificationsService(config);
    svc.onModuleInit();
    return svc;
  }

  test('sends a Martinrea-branded HTML email with all required fields (PRD WF-04)', async () => {
    const svc = build();
    await svc.sendApprovalRequired({
      to: 'pm@martinrea.dev',
      approverName: 'Demo PM',
      invoiceNumber: 'INV-2026-100',
      supplierName: 'Acme Steel',
      totalAmount: 12_500.75,
      currency: 'USD',
      invoiceId: 'aaaa-bbbb',
      isEscalation: false,
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const args = mockSendMail.mock.calls[0][0];
    expect(args.to).toBe('pm@martinrea.dev');
    expect(args.subject).toMatch(/Approval required: Invoice INV-2026-100/);
    expect(args.html).toContain('INV-2026-100');
    expect(args.html).toContain('Acme Steel');
    expect(args.html).toContain('$12,500.75');
    expect(args.html).toContain('http://localhost:3000/invoices/aaaa-bbbb/review');
    expect(args.text).toContain('INV-2026-100');
  });

  test('escalation emails use the SLA-breach subject and banner', async () => {
    const svc = build();
    await svc.sendApprovalRequired({
      to: 'fd@martinrea.dev',
      approverName: 'Demo FD',
      invoiceNumber: 'INV-2026-101',
      supplierName: 'Acme',
      totalAmount: 1_000,
      currency: 'USD',
      invoiceId: 'x',
      isEscalation: true,
    });
    const args = mockSendMail.mock.calls[0][0];
    expect(args.subject).toMatch(/\[ESCALATION\]/);
    expect(args.subject).toMatch(/48h SLA breach/);
    expect(args.html).toContain('ACTION REQUIRED');
  });

  test('no-op when MAIL_ENABLED=false (does not call transporter)', async () => {
    const svc = build({ 'mail.enabled': false });
    await svc.sendApprovalRequired({
      to: 'x@y.z',
      approverName: 'X',
      invoiceNumber: 'INV-A',
      supplierName: 'S',
      totalAmount: 1,
      currency: 'USD',
      invoiceId: 'i',
      isEscalation: false,
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('HTML escapes hostile values to prevent injection', async () => {
    const svc = build();
    await svc.sendApprovalRequired({
      to: 'x@y.z',
      approverName: '<script>alert(1)</script>',
      invoiceNumber: 'INV-"; drop',
      supplierName: 'Evil & Co',
      totalAmount: 1,
      currency: 'USD',
      invoiceId: 'i',
      isEscalation: false,
    });
    const args = mockSendMail.mock.calls[0][0];
    expect(args.html).not.toContain('<script>alert(1)</script>');
    expect(args.html).toContain('&lt;script&gt;');
    expect(args.html).toContain('Evil &amp; Co');
  });
});
