export interface ApprovalEmailParams {
  approverName: string;
  invoiceNumber: string;
  supplierName: string;
  totalAmount: number;
  currency: string;
  approvalUrl: string;
  isEscalation: boolean;
  slaHours: number;
}

/**
 * HTML approval-required email template.
 *
 * PRD WF-04 acceptance criteria:
 *   - Email contains: Invoice Number, Supplier, Amount, deep-link, deadline.
 *   - Templates are HTML, mobile-responsive, Martinrea-branded.
 *
 * The CSS is inlined and uses max-width:600px so it renders correctly
 * on Outlook / Gmail / Apple Mail desktop and mobile.
 */
export function renderApprovalRequiredHtml(p: ApprovalEmailParams): string {
  const amount = p.totalAmount.toLocaleString('en-US', {
    style: 'currency',
    currency: p.currency,
  });
  const banner = p.isEscalation
    ? `<tr><td style="background:#b91c1c;color:#fff;padding:14px 24px;font-weight:600;font-size:14px;">ACTION REQUIRED - SLA BREACH (${p.slaHours}h)</td></tr>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Martinrea AP - Approval Required</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
        <tr><td style="background:#0f172a;color:#fff;padding:20px 24px;font-size:18px;font-weight:600;">Martinrea Accounts Payable</td></tr>
        ${banner}
        <tr><td style="padding:24px;font-size:15px;line-height:1.55;">
          <p style="margin:0 0 12px;">Hello ${escapeHtml(p.approverName)},</p>
          <p style="margin:0 0 18px;">An invoice is awaiting your approval${p.isEscalation ? ' and has exceeded the SLA window' : ''}.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;">
            <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Invoice #</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(p.invoiceNumber)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Supplier</td><td style="padding:8px 0;">${escapeHtml(p.supplierName)}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Amount</td><td style="padding:8px 0;font-weight:600;">${amount}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Deadline</td><td style="padding:8px 0;">Within ${p.slaHours} hours</td></tr>
          </table>
          <p style="margin:0 0 22px;">
            <a href="${escapeHtml(p.approvalUrl)}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;">Review &amp; Approve</a>
          </p>
          <p style="margin:0;color:#6b7280;font-size:13px;">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;color:#374151;">${escapeHtml(p.approvalUrl)}</span></p>
        </td></tr>
        <tr><td style="background:#f9fafb;color:#6b7280;padding:14px 24px;font-size:12px;">Martinrea International - Automated message. Do not reply.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function renderApprovalRequiredText(p: ApprovalEmailParams): string {
  const amount = p.totalAmount.toLocaleString('en-US', {
    style: 'currency',
    currency: p.currency,
  });
  return [
    p.isEscalation ? `ACTION REQUIRED - SLA BREACH (${p.slaHours}h)` : '',
    `Hello ${p.approverName},`,
    '',
    `An invoice is awaiting your approval${p.isEscalation ? ' and has exceeded the SLA window' : ''}.`,
    '',
    `Invoice #: ${p.invoiceNumber}`,
    `Supplier:  ${p.supplierName}`,
    `Amount:    ${amount}`,
    `Deadline:  Within ${p.slaHours} hours`,
    '',
    `Review and approve: ${p.approvalUrl}`,
    '',
    'Martinrea International - Automated message. Do not reply.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
