/*
 * Generates docs/Martinrea-AP-Workflow.pptx
 *
 * A hybrid (business overview + technical) deck that explains the Martinrea AP
 * invoice workflow end-to-end and the invoice status at each stage. Content is
 * sourced from the live code:
 *   - statuses / transitions : backend/workflow/src/common/enums/invoice-status.enum.ts
 *                              backend/workflow/src/invoices/state-machine/transitions.ts
 *   - ingestion / validation : backend/ingestion/src/ingestion/pre-processing/pre-processing.service.ts
 *   - OCR + poller + bridge  : backend/workflow/src/ocr-app/... , backend/workflow/src/bridge/ocr-workflow-bridge.service.ts
 *   - match + approvals      : backend/workflow/src/match-records/match.service.ts
 *                              backend/workflow/src/rules-engine/rules-engine.service.ts
 *
 * Run:  npm run ppt
 */
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
pptx.author = 'Martinrea AP';
pptx.company = 'Martinrea';
pptx.title = 'Martinrea AP - Invoice Processing Workflow';

const S = pptx.ShapeType;

// ----------------------------------------------------------------------------
// Design tokens
// ----------------------------------------------------------------------------
const C = {
  navy: '1F2A44',
  navy2: '2C3A5A',
  red: 'C8102E',
  redSoft: 'F2A9B4',
  ink: '21303A',
  sub: '5B6B73',
  line: 'D6DCE1',
  panel: 'F5F7F9',
  panel2: 'EAEEF2',
  white: 'FFFFFF',
  green: '2E7D32',
  amber: 'E08A00',
  dangerRed: 'C62828',
  slate: '566B76',
};
const FONT = 'Segoe UI';
const MONO = 'Consolas';

const PAGE_W = 13.333;
const PAGE_H = 7.5;
const MX = 0.55;
const CONTENT_W = PAGE_W - MX * 2;

// Status badge palette: success / progress / danger / neutral
function statusStyle(kind) {
  switch (kind) {
    case 'success':
      return { fill: C.green, color: 'FFFFFF' };
    case 'progress':
      return { fill: C.amber, color: '2A1F00' };
    case 'danger':
      return { fill: C.dangerRed, color: 'FFFFFF' };
    case 'neutral':
    default:
      return { fill: C.slate, color: 'FFFFFF' };
  }
}

// ----------------------------------------------------------------------------
// Reusable helpers
// ----------------------------------------------------------------------------
let pageNo = 0;

/** Standard content slide: dark header band, red accent rule, title + footer. */
function baseSlide(title, kicker) {
  pageNo += 1;
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape(S.rect, { x: 0, y: 0, w: PAGE_W, h: 1.14, fill: { color: C.navy } });
  slide.addShape(S.rect, { x: 0, y: 1.14, w: PAGE_W, h: 0.07, fill: { color: C.red } });
  if (kicker) {
    slide.addText(kicker.toUpperCase(), {
      x: MX, y: 0.18, w: CONTENT_W, h: 0.28,
      fontSize: 11, bold: true, color: C.redSoft, charSpacing: 2, fontFace: FONT,
    });
  }
  slide.addText(title, {
    x: MX, y: kicker ? 0.44 : 0.28, w: CONTENT_W, h: 0.66,
    fontSize: 26, bold: true, color: 'FFFFFF', fontFace: FONT, valign: 'middle',
  });
  slide.addText('Martinrea AP  |  Invoice Processing Workflow', {
    x: MX, y: PAGE_H - 0.42, w: 9, h: 0.3, fontSize: 9, color: C.sub, fontFace: FONT, valign: 'middle',
  });
  slide.addText(String(pageNo), {
    x: PAGE_W - 1.05, y: PAGE_H - 0.42, w: 0.5, h: 0.3,
    fontSize: 9, color: C.sub, align: 'right', fontFace: FONT, valign: 'middle',
  });
  return slide;
}

/** Bulleted text block. Items: string | {text, sub, bold, color, fontSize}. */
function bullets(slide, x, y, w, h, items, opts = {}) {
  const fontSize = opts.fontSize || 13;
  const arr = items.map((it) => {
    const o = typeof it === 'string' ? { text: it } : it;
    return {
      text: o.text,
      options: {
        bullet: o.sub ? { code: '2013', indent: 18 } : { code: '2022', indent: 14 },
        indentLevel: o.sub ? 1 : 0,
        color: o.color || C.ink,
        fontSize: o.fontSize || (o.sub ? fontSize - 1.5 : fontSize),
        bold: !!o.bold,
        paraSpaceAfter: opts.spaceAfter != null ? opts.spaceAfter : 7,
        fontFace: FONT,
      },
    };
  });
  slide.addText(arr, { x, y, w, h, valign: 'top' });
}

/** Pill-shaped status badge. */
function badge(slide, text, x, y, w, kind, h) {
  const hh = h || 0.32;
  const st = statusStyle(kind);
  slide.addShape(S.roundRect, { x, y, w, h: hh, fill: { color: st.fill }, rectRadius: 0.06 });
  slide.addText(text, {
    x, y, w, h: hh, fontSize: 10, bold: true, color: st.color,
    align: 'center', valign: 'middle', fontFace: FONT,
  });
}

/** Process card with a title and an optional status badge along the bottom. */
function flowBox(slide, o) {
  const { x, y, w, h = 1.1, title, statusText, statusKind = 'neutral', fill = C.panel, accent } = o;
  slide.addShape(S.roundRect, {
    x, y, w, h, fill: { color: fill }, line: { color: C.line, width: 1 }, rectRadius: 0.06,
  });
  if (accent) {
    slide.addShape(S.rect, { x, y: y + 0.08, w: 0.09, h: h - 0.16, fill: { color: accent } });
  }
  const tH = statusText ? h - 0.46 : h;
  slide.addText(title, {
    x: x + 0.16, y: y + 0.04, w: w - 0.3, h: tH - 0.04,
    fontSize: o.fontSize || 12, bold: true, color: C.ink,
    align: 'center', valign: 'middle', fontFace: FONT,
  });
  if (statusText) {
    badge(slide, statusText, x + 0.18, y + h - 0.4, w - 0.36, statusKind, 0.3);
  }
}

/** Horizontal connector with an arrowhead and optional caption above it. */
function arrowRight(slide, x, y, len, label) {
  slide.addShape(S.line, {
    x, y, w: len, h: 0, line: { color: C.slate, width: 2, endArrowType: 'triangle' },
  });
  if (label) {
    slide.addText(label, {
      x: x - 0.15, y: y - 0.36, w: len + 0.3, h: 0.28,
      fontSize: 8.5, italic: true, color: C.sub, align: 'center', fontFace: FONT,
    });
  }
}

/** Vertical connector with an arrowhead and optional caption beside it. */
function arrowDown(slide, x, y, len, label) {
  slide.addShape(S.line, {
    x, y, w: 0, h: len, line: { color: C.slate, width: 2, endArrowType: 'triangle' },
  });
  if (label) {
    slide.addText(label, {
      x: x + 0.08, y: y + len / 2 - 0.16, w: 2.2, h: 0.3,
      fontSize: 8.5, italic: true, color: C.sub, fontFace: FONT, valign: 'middle',
    });
  }
}

/** Render a left-to-right chain of flow boxes joined by arrows. */
function horizontalFlow(slide, startX, y, boxW, boxH, gap, items) {
  let x = startX;
  items.forEach((it, i) => {
    flowBox(slide, {
      x, y, w: boxW, h: boxH, title: it.title,
      statusText: it.status, statusKind: it.kind, fill: it.fill, accent: it.accent,
      fontSize: it.fontSize,
    });
    if (i < items.length - 1) {
      arrowRight(slide, x + boxW + 0.03, y + boxH / 2, gap - 0.06, it.edge);
    }
    x += boxW + gap;
  });
}

/** Heading + body info card with a colored left accent. */
function infoCard(slide, x, y, w, h, heading, lines, accent) {
  slide.addShape(S.roundRect, {
    x, y, w, h, fill: { color: C.panel }, line: { color: C.line, width: 1 }, rectRadius: 0.06,
  });
  slide.addShape(S.rect, { x, y: y + 0.1, w: 0.1, h: h - 0.2, fill: { color: accent || C.red } });
  slide.addText(heading, {
    x: x + 0.22, y: y + 0.14, w: w - 0.36, h: 0.4, fontSize: 13, bold: true, color: C.ink, fontFace: FONT,
  });
  slide.addText(lines.join('\n'), {
    x: x + 0.22, y: y + 0.58, w: w - 0.4, h: h - 0.72,
    fontSize: 10.5, color: C.sub, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.04,
  });
}

/** Status color legend strip. */
function legend(slide, x, y) {
  const items = [
    ['Success / Approved', 'success'],
    ['In progress', 'progress'],
    ['Rejected / Dead-end', 'danger'],
    ['Pre-status / system', 'neutral'],
  ];
  let cx = x;
  items.forEach(([lab, kind]) => {
    const st = statusStyle(kind);
    slide.addShape(S.roundRect, { x: cx, y, w: 0.26, h: 0.18, fill: { color: st.fill }, rectRadius: 0.03 });
    slide.addText(lab, {
      x: cx + 0.32, y: y - 0.08, w: 2.1, h: 0.34, fontSize: 9.5, color: C.sub, fontFace: FONT, valign: 'middle',
    });
    cx += 0.32 + 2.05;
  });
}

// ----------------------------------------------------------------------------
// Slide 1 - Title
// ----------------------------------------------------------------------------
function slideTitle() {
  pageNo += 1;
  const s = pptx.addSlide();
  s.background = { color: C.navy };
  s.addShape(S.rect, { x: 0, y: 0, w: 0.35, h: PAGE_H, fill: { color: C.red } });
  s.addShape(S.rect, { x: 0.9, y: 2.0, w: 1.7, h: 0.09, fill: { color: C.red } });
  s.addText('MARTINREA AP', {
    x: 0.9, y: 1.35, w: 11, h: 0.5, fontSize: 16, bold: true, color: C.redSoft, charSpacing: 4, fontFace: FONT,
  });
  s.addText('Invoice Processing Workflow', {
    x: 0.86, y: 2.2, w: 11.6, h: 1.5, fontSize: 48, bold: true, color: 'FFFFFF', fontFace: FONT,
  });
  s.addText('End-to-end data flow and invoice status lifecycle', {
    x: 0.9, y: 3.7, w: 11.5, h: 0.5, fontSize: 18, color: 'C9D2DC', fontFace: FONT,
  });
  s.addText(
    'Ingestion  ->  OCR  ->  Review  ->  2-Way Match  ->  Approval',
    { x: 0.9, y: 4.5, w: 11.5, h: 0.4, fontSize: 13, italic: true, color: '8FA0AE', fontFace: FONT },
  );
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  s.addText(dateStr, {
    x: 0.9, y: PAGE_H - 0.85, w: 11.5, h: 0.35, fontSize: 11, color: '8FA0AE', fontFace: FONT,
  });
}

// ----------------------------------------------------------------------------
// Slide 2 - Executive summary
// ----------------------------------------------------------------------------
function slideExecSummary() {
  const s = baseSlide('Executive Summary', 'Overview');
  s.addText(
    'The Martinrea AP platform automates accounts-payable invoice processing from capture to approval. ' +
      'Invoices arrive through multiple channels, are validated and OCR-extracted, matched against purchase orders, ' +
      'and routed for approval - with every step driven by a strict invoice-status state machine and a full audit trail.',
    { x: MX, y: 1.42, w: CONTENT_W, h: 0.95, fontSize: 13.5, color: C.ink, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.05 },
  );

  const cardW = 2.85;
  const gap = 0.28;
  const y = 2.62;
  const h = 2.5;
  let x = MX;
  infoCard(s, x, y, cardW, h, 'Ingestion service', [
    'Captures invoices from Email, SFTP and Web upload.',
    'Validates files and stores accepted vs rejected in blob storage.',
  ], C.red); x += cardW + gap;
  infoCard(s, x, y, cardW, h, 'Workflow service', [
    'OCR + parsing, review, 2-way match, approval routing.',
    'Owns the invoice-status state machine and audit log.',
  ], C.amber); x += cardW + gap;
  infoCard(s, x, y, cardW, h, 'Integrations service', [
    'CFDI / SAT validation for Mexican invoices.',
    'Epicor PO and goods-receipt sync.',
  ], C.green); x += cardW + gap;
  infoCard(s, x, y, cardW, h, 'Web frontend', [
    'Next.js dashboard for AP clerks and approvers.',
    'Review workbench, match workbench, approvals queue.',
  ], C.slate);

  s.addText(
    'Data stores: PostgreSQL (workflow + OCR schemas) and blob storage (raw / quarantine document folders).',
    { x: MX, y: 5.4, w: CONTENT_W, h: 0.4, fontSize: 11.5, italic: true, color: C.sub, fontFace: FONT },
  );
}

// ----------------------------------------------------------------------------
// Slide 3 - Business invoice journey
// ----------------------------------------------------------------------------
function slideJourney() {
  const s = baseSlide('The Invoice Journey', 'Business view');
  s.addText('Each stage advances the invoice status. Color shows where the invoice stands.', {
    x: MX, y: 1.4, w: CONTENT_W, h: 0.4, fontSize: 13, color: C.sub, fontFace: FONT,
  });

  const items = [
    { title: 'Capture\nEmail / SFTP / Web', status: 'received', kind: 'neutral', accent: C.slate, edge: 'validate + store' },
    { title: 'OCR\nextract fields', status: 'OCR_PROCESSING', kind: 'progress', accent: C.amber, edge: 'auto-pull' },
    { title: 'Review\nclerk verifies', status: 'PENDING_REVIEW', kind: 'progress', accent: C.amber, edge: 'send to match' },
    { title: '2-Way Match\nInvoice vs PO', status: 'PENDING_MATCH', kind: 'progress', accent: C.amber, edge: 'on match' },
    { title: 'Approval\nrouted by rules', status: 'PENDING_APPROVAL', kind: 'progress', accent: C.amber, edge: 'all sign off' },
    { title: 'Done\nready to pay', status: 'APPROVED', kind: 'success', accent: C.green },
  ];
  horizontalFlow(s, MX, 2.5, 1.78, 1.5, 0.31, items);

  s.addText('Off-ramps at any stage:', { x: MX, y: 4.55, w: 3, h: 0.3, fontSize: 12, bold: true, color: C.ink, fontFace: FONT });
  bullets(s, MX, 4.9, CONTENT_W, 1.4, [
    { text: 'Validation fails -> file quarantined (never enters the workflow).' },
    { text: 'Duplicate or unreadable scan -> DUPLICATE_INVOICE / FAILED.' },
    { text: 'Match discrepancy -> EXCEPTION (fix and retry, or reject).' },
    { text: 'Approver rejects -> REJECTED, returned to review for rework.' },
  ], { fontSize: 12, spaceAfter: 4 });

  legend(s, MX, 6.95);
}

// ----------------------------------------------------------------------------
// Slide 4 - System architecture
// ----------------------------------------------------------------------------
function slideArchitecture() {
  const s = baseSlide('System Architecture', 'How it fits together');

  flowBox(s, { x: 4.66, y: 1.45, w: 4.0, h: 0.7, title: 'Web Frontend (Next.js dashboard)', fill: C.panel2, accent: C.slate });
  arrowDown(s, 6.66, 2.18, 0.5);

  const y = 2.8;
  const cw = 3.7;
  const gap = 0.55;
  let x = (PAGE_W - (cw * 3 + gap * 2)) / 2;
  infoCard(s, x, y, cw, 1.65, 'Ingestion service', [
    'Email / SFTP / Web channels',
    'Validate -> blob raw/ or quarantine/',
  ], C.red); const ingX = x; x += cw + gap;
  infoCard(s, x, y, cw, 1.65, 'Workflow service', [
    'OCR, review, match, approvals',
    'Status state machine + audit log',
  ], C.amber); const wfX = x; x += cw + gap;
  infoCard(s, x, y, cw, 1.65, 'Integrations service', [
    'CFDI / SAT validation',
    'Epicor PO + goods-receipt sync',
  ], C.green); const intX = x;

  const dy = 4.95;
  flowBox(s, { x: ingX, y: dy, w: cw, h: 0.95, title: 'Blob storage\nraw/ (accepted)  ·  quarantine/ (rejected)', fill: C.panel, accent: C.red, fontSize: 11 });
  flowBox(s, { x: wfX, y: dy, w: cw, h: 0.95, title: 'PostgreSQL\nworkflow (Sequelize)  +  OCR (Prisma) schemas', fill: C.panel, accent: C.amber, fontSize: 11 });
  flowBox(s, { x: intX, y: dy, w: cw, h: 0.95, title: 'External\nSAT (CFDI)  ·  Epicor ERP', fill: C.panel, accent: C.green, fontSize: 11 });

  arrowDown(s, ingX + cw / 2, y + 1.65, dy - (y + 1.65));
  arrowDown(s, wfX + cw / 2, y + 1.65, dy - (y + 1.65));
  arrowDown(s, intX + cw / 2, y + 1.65, dy - (y + 1.65));

  s.addText(
    'Two-schema design: the OCR pipeline writes to a Prisma "ocr" schema; the approval workflow runs on the Sequelize ' +
      'public.invoices table. A bridge promotes OCR records into the workflow using a shared invoice id.',
    { x: MX, y: 6.2, w: CONTENT_W, h: 0.7, fontSize: 11, italic: true, color: C.sub, fontFace: FONT, lineSpacingMultiple: 1.03 },
  );
}

// ----------------------------------------------------------------------------
// Slide 5 - Stage 1: Ingestion
// ----------------------------------------------------------------------------
function slideIngestion() {
  const s = baseSlide('Stage 1 - Ingestion & Validation', 'Ingestion service');

  flowBox(s, { x: MX, y: 2.0, w: 2.7, h: 1.1, title: 'Channels\nEmail · SFTP · Web upload', fill: C.panel, accent: C.slate, fontSize: 11.5 });
  arrowRight(s, MX + 2.73, 2.55, 0.45);
  flowBox(s, { x: 3.73, y: 2.0, w: 3.0, h: 1.1, title: 'Pre-Processing\nvalidateAndHandoff()', fill: C.panel, accent: C.red, fontSize: 11.5 });
  arrowRight(s, 6.76, 2.55, 0.5);
  flowBox(s, { x: 7.3, y: 2.0, w: 1.9, h: 1.1, title: 'Valid file?', statusText: 'DECISION', statusKind: 'progress', fill: 'FBEFD6', fontSize: 12.5 });

  // branch
  arrowRight(s, 9.22, 2.3, 0.6, 'accepted');
  flowBox(s, { x: 9.85, y: 1.55, w: 2.95, h: 0.95, title: 'Blob: raw/  (accepted)', statusText: 'queued for OCR', statusKind: 'success', fill: 'EAF4EC', fontSize: 11.5 });
  arrowRight(s, 9.22, 2.85, 0.6, 'rejected');
  flowBox(s, { x: 9.85, y: 2.62, w: 2.95, h: 0.95, title: 'Blob: quarantine/  (rejected)', statusText: 'DEAD-END', statusKind: 'danger', fill: 'F7E6E6', fontSize: 11.5 });

  s.addText('Validation gate (single funnel for every channel):', {
    x: MX, y: 3.95, w: CONTENT_W, h: 0.3, fontSize: 12.5, bold: true, color: C.ink, fontFace: FONT,
  });
  bullets(s, MX, 4.3, 6.2, 2.4, [
    'Reject empty buffers and files over MAX_FILE_BYTES (10 MB default).',
    'Detect MIME by magic bytes, not file extension.',
    { text: 'Allowlist: PDF, JPEG, PNG, TIFF, XML (CFDI).', sub: true },
    'SHA-256 content hash for downstream de-duplication.',
    'On any failure: push to quarantine (best-effort, never throws).',
  ], { fontSize: 12 });
  infoCard(s, 7.05, 4.3, 5.73, 2.35, 'Why it matters', [
    'A misconfigured channel can never silently drop an invoice -',
    'non-local adapters fail loudly at boot if credentials are missing.',
    '',
    'Accepted documents land under raw/ where the OCR poller picks',
    'them up; rejected payloads + reason are retained in quarantine/.',
  ], C.red);
}

// ----------------------------------------------------------------------------
// Slide 6 - Stage 2: OCR pipeline
// ----------------------------------------------------------------------------
function slideOcr() {
  const s = baseSlide('Stage 2 - OCR Pipeline', 'Workflow service (OCR app)');

  const items = [
    { title: 'Blob: raw/\nsource folder', kind: 'neutral', accent: C.slate, edge: 'poll ~2 min', fill: C.panel },
    { title: 'Auto-ingest poller\ncreate invoice', status: 'RECEIVED', kind: 'neutral', accent: C.slate, edge: 'run OCR' },
    { title: 'OCR + parse\nfields & detectors', status: 'OCR_PROCESSING', kind: 'progress', accent: C.amber, edge: 'evaluate' },
    { title: 'Result?', status: 'DECISION', kind: 'progress', accent: C.amber, fill: 'FBEFD6' },
  ];
  horizontalFlow(s, MX, 1.95, 2.78, 1.25, 0.36, items);

  // outcomes
  const ox = MX + (2.78 + 0.36) * 3; // x of decision box
  arrowRight(s, ox + 2.78 + 0.03, 2.0, 0.45);
  flowBox(s, { x: ox + 2.78 + 0.5, y: 1.62, w: 2.6, h: 0.66, title: 'Clean extract', statusText: 'PENDING_REVIEW', statusKind: 'success', fill: 'EAF4EC', fontSize: 10.5 });

  s.addText('Off-ramps from OCR:', { x: MX, y: 3.55, w: 4, h: 0.3, fontSize: 12.5, bold: true, color: C.ink, fontFace: FONT });
  // off-ramp mini-flow
  flowBox(s, { x: MX, y: 3.95, w: 3.2, h: 0.8, title: 'Same supplier + number', statusText: 'DUPLICATE_INVOICE', statusKind: 'danger', fill: 'F7E6E6', fontSize: 11 });
  flowBox(s, { x: MX + 3.5, y: 3.95, w: 3.2, h: 0.8, title: 'OCR fails (max retries)', statusText: 'FAILED', statusKind: 'danger', fill: 'F7E6E6', fontSize: 11 });

  infoCard(s, 7.05, 3.95, 5.73, 2.6, 'Notes', [
    'The bucket is the contract - no message bus. Dedup on the stored',
    'filename keeps the poller idempotent across restarts.',
    '',
    'Every successfully OCR-ed invoice lands in PENDING_REVIEW so an',
    'AP clerk verifies the extracted fields before matching - even',
    'high-confidence scans (a "verify" banner flags low-confidence ones).',
  ], C.amber);
}

// ----------------------------------------------------------------------------
// Slide 7 - The OCR -> workflow bridge
// ----------------------------------------------------------------------------
function slideBridge() {
  const s = baseSlide('The OCR -> Workflow Bridge', 'Connecting two schemas');
  s.addText(
    'OCR and approvals live in separate database schemas. The bridge promotes each OCR-extracted invoice into the ' +
      'approval workflow so it becomes visible to the dashboard and approvals queue.',
    { x: MX, y: 1.4, w: CONTENT_W, h: 0.7, fontSize: 13, color: C.ink, fontFace: FONT, lineSpacingMultiple: 1.04 },
  );

  flowBox(s, { x: MX, y: 2.55, w: 4.1, h: 1.4, title: 'OCR pipeline\nPrisma "ocr" schema', statusText: 'PENDING_REVIEW (OCR)', statusKind: 'progress', fill: C.panel, accent: C.amber, fontSize: 12.5 });
  arrowRight(s, MX + 4.13, 3.25, 1.05, 'promote (shared id)');
  flowBox(s, { x: MX + 5.2, y: 2.55, w: 4.1, h: 1.4, title: 'Approval workflow\nSequelize public.invoices', statusText: 'PENDING_REVIEW', statusKind: 'progress', fill: C.panel, accent: C.green, fontSize: 12.5 });

  flowBox(s, { x: MX + 5.2, y: 4.25, w: 4.1, h: 0.9, title: 'CFDI flagged? -> Integrations\nSAT validation sets cfdi_valid', fill: 'EAF4EC', accent: C.green, fontSize: 11 });
  arrowDown(s, MX + 5.2 + 2.05, 3.97, 0.26);

  bullets(s, MX + 9.6, 2.55, 3.1, 2.7, [
    { text: 'Runs on a schedule (cron).', },
    { text: 'Idempotent: each OCR record promoted once.', },
    { text: 'Dedupes on shared id and unique invoice number.', },
    { text: 'Mexican (CFDI) invoices are routed to SAT validation before they can match.', },
  ], { fontSize: 11.5, spaceAfter: 8 });

  s.addText(
    'One id works for both /api/invoices/:id (lifecycle) and /api/ocr/invoices/:id (extracted fields + document).',
    { x: MX, y: 5.55, w: CONTENT_W, h: 0.5, fontSize: 11, italic: true, color: C.sub, fontFace: FONT },
  );
}

// ----------------------------------------------------------------------------
// Slide 8 - Stage 3: Review & 2-way match
// ----------------------------------------------------------------------------
function slideMatch() {
  const s = baseSlide('Stage 3 - Review & 2-Way Match', 'Workflow service');

  const items = [
    { title: 'Clerk verifies\nextracted fields', status: 'PENDING_REVIEW', kind: 'progress', accent: C.amber, edge: 'send to match' },
    { title: 'Awaiting match\nInvoice vs PO', status: 'PENDING_MATCH', kind: 'progress', accent: C.amber, edge: '2-way match' },
    { title: 'Match passes?\n±2% + CFDI guard', status: 'DECISION', kind: 'progress', accent: C.amber, fill: 'FBEFD6' },
  ];
  horizontalFlow(s, MX, 1.95, 2.85, 1.3, 0.4, items);

  const decX = MX + (2.85 + 0.4) * 2;
  arrowRight(s, decX + 2.85 + 0.03, 2.25, 0.5, 'no blocking');
  flowBox(s, { x: decX + 2.85 + 0.55, y: 1.95, w: 2.6, h: 1.3, title: 'Matched', statusText: 'MATCHED', statusKind: 'success', fill: 'EAF4EC', fontSize: 12.5 });

  arrowDown(s, decX + 1.42, 3.27, 0.55, 'blocking');
  flowBox(s, { x: decX - 0.1, y: 3.85, w: 3.0, h: 0.9, title: 'Discrepancy flagged', statusText: 'EXCEPTION', statusKind: 'danger', fill: 'F7E6E6', fontSize: 11.5 });
  arrowRight(s, decX + 2.95, 4.3, 0.5, 'reject');
  flowBox(s, { x: decX + 3.45, y: 3.85, w: 2.6, h: 0.9, title: 'Unrecoverable', statusText: 'REJECTED', statusKind: 'danger', fill: 'F7E6E6', fontSize: 11.5 });

  bullets(s, MX, 4.0, 6.0, 2.4, [
    '2-way match compares the invoice against its Purchase Order.',
    { text: 'Blocking: missing/unknown PO, currency mismatch, total over the +/-2% tolerance.', sub: true },
    { text: 'Non-blocking: supplier-name differences (recorded, not gating).', sub: true },
    'CFDI guard: an invoice with cfdi_valid = false cannot reach MATCHED (SAT compliance).',
    'EXCEPTION resolves back to PENDING_MATCH (fixed) or to REJECTED.',
  ], { fontSize: 11.5 });

  s.addText(
    'Match and "route for approval" are two explicit steps - the invoice rests in MATCHED before entering the approval chain.',
    { x: MX, y: 6.55, w: CONTENT_W, h: 0.4, fontSize: 11, italic: true, color: C.sub, fontFace: FONT },
  );
}

// ----------------------------------------------------------------------------
// Slide 9 - Stage 4: Approval routing
// ----------------------------------------------------------------------------
function slideApproval() {
  const s = baseSlide('Stage 4 - Approval Routing', 'Workflow service + Rules Engine');
  s.addText('On submit-for-approval the Rules Engine builds an ordered approver chain from the invoice amount and plant.', {
    x: MX, y: 1.4, w: CONTENT_W, h: 0.4, fontSize: 13, color: C.sub, fontFace: FONT,
  });

  // Tier rows
  const tierY = 2.0;
  const rowH = 0.78;
  const rowGap = 0.16;
  const labelW = 2.5;
  const stepW = 2.0;
  const stepGap = 0.5;

  const tiers = [
    { label: '<= $10,000', chain: ['Finance Director'] },
    { label: '> $10,000', chain: ['Plant Manager', 'Finance Director'] },
    { label: '> $50,000', chain: ['Plant Manager', 'Finance Director', 'VP Finance'] },
  ];
  tiers.forEach((t, i) => {
    const y = tierY + i * (rowH + rowGap);
    badge(s, t.label, MX, y + 0.22, labelW, 'neutral', 0.34);
    let x = MX + labelW + 0.5;
    t.chain.forEach((role, j) => {
      flowBox(s, { x, y, w: stepW, h: rowH, title: role, fill: C.panel, accent: C.green, fontSize: 11 });
      if (j < t.chain.length - 1) arrowRight(s, x + stepW + 0.03, y + rowH / 2, stepGap - 0.06);
      x += stepW + stepGap;
    });
  });

  // outcome row
  const oy = 4.95;
  flowBox(s, { x: MX, y: oy, w: 3.2, h: 0.95, title: 'Each approver signs', statusText: 'PENDING_APPROVAL', statusKind: 'progress', fill: 'FBEFD6', fontSize: 11.5 });
  arrowRight(s, MX + 3.23, oy + 0.48, 0.55, 'chain complete');
  flowBox(s, { x: MX + 3.78, y: oy, w: 3.0, h: 0.95, title: 'Final sign-off', statusText: 'APPROVED', statusKind: 'success', fill: 'EAF4EC', fontSize: 11.5 });
  arrowRight(s, MX + 6.81, oy + 0.48, 0.55, 'any reject');
  flowBox(s, { x: MX + 7.36, y: oy, w: 3.0, h: 0.95, title: 'Returned for rework', statusText: 'REJECTED -> PENDING_REVIEW', statusKind: 'danger', fill: 'F7E6E6', fontSize: 9.5 });

  bullets(s, MX, 6.1, CONTENT_W, 1.1, [
    { text: 'Segregation of duties: only the current approver may act; AP clerks cannot approve. Plant Manager is capped at $50,000 as the final authoriser.' },
    { text: 'SLA escalation: overdue PENDING_APPROVAL invoices escalate up the org hierarchy (manager -> VP) automatically.' },
  ], { fontSize: 11 });
}

// ----------------------------------------------------------------------------
// Slide 10 - Invoice status lifecycle (state machine)
// ----------------------------------------------------------------------------
function slideLifecycle() {
  const s = baseSlide('Invoice Status Lifecycle', 'The state machine');
  s.addText('Happy path (a transition not in the permitted list is rejected with 409 Conflict):', {
    x: MX, y: 1.38, w: CONTENT_W, h: 0.3, fontSize: 12.5, bold: true, color: C.ink, fontFace: FONT,
  });

  const happy = [
    { title: 'RECEIVED', kind: 'neutral' },
    { title: 'OCR_PROCESSING', kind: 'progress' },
    { title: 'PENDING_REVIEW', kind: 'progress' },
    { title: 'PENDING_MATCH', kind: 'progress' },
    { title: 'MATCHED', kind: 'success' },
    { title: 'PENDING_APPROVAL', kind: 'progress' },
    { title: 'APPROVED', kind: 'success' },
  ];
  const bw = 1.6;
  const gap = 0.18;
  let x = MX;
  const y = 1.85;
  happy.forEach((n, i) => {
    const st = statusStyle(n.kind);
    s.addShape(S.roundRect, { x, y, w: bw, h: 0.62, fill: { color: st.fill }, rectRadius: 0.06 });
    s.addText(n.title, { x: x - 0.05, y, w: bw + 0.1, h: 0.62, fontSize: 8.6, bold: true, color: st.color, align: 'center', valign: 'middle', fontFace: FONT });
    if (i < happy.length - 1) {
      s.addShape(S.line, { x: x + bw + 0.01, y: y + 0.31, w: gap - 0.02, h: 0, line: { color: C.slate, width: 1.75, endArrowType: 'triangle' } });
    }
    x += bw + gap;
  });
  s.addText('terminal', { x: MX + (bw + gap) * 6 - 0.05, y: y + 0.66, w: bw + 0.1, h: 0.25, fontSize: 8, italic: true, color: C.green, align: 'center', fontFace: FONT });

  s.addShape(S.line, { x: MX, y: 3.0, w: CONTENT_W, h: 0, line: { color: C.line, width: 1 } });
  s.addText('Branches & loops:', { x: MX, y: 3.1, w: 4, h: 0.3, fontSize: 12.5, bold: true, color: C.ink, fontFace: FONT });

  // Branch mini-flows
  function miniNode(slide, x, yy, w, label, kind) {
    const st = statusStyle(kind);
    slide.addShape(S.roundRect, { x, y: yy, w, h: 0.5, fill: { color: st.fill }, rectRadius: 0.06 });
    slide.addText(label, { x: x - 0.05, y: yy, w: w + 0.1, h: 0.5, fontSize: 8.6, bold: true, color: st.color, align: 'center', valign: 'middle', fontFace: FONT });
  }
  const rows = [
    { y: 3.55, nodes: [['OCR_PROCESSING', 'progress'], ['DUPLICATE_INVOICE / FAILED', 'danger']], edge: 'duplicate / unreadable' },
    { y: 4.3, nodes: [['PENDING_MATCH', 'progress'], ['EXCEPTION', 'danger'], ['REJECTED', 'danger']], edge: 'blocking / unrecoverable' },
    { y: 5.05, nodes: [['EXCEPTION', 'danger'], ['PENDING_MATCH', 'progress']], edge: 'discrepancy fixed' },
    { y: 5.8, nodes: [['PENDING_APPROVAL', 'progress'], ['REJECTED', 'danger'], ['PENDING_REVIEW', 'progress']], edge: 'approver rejects -> rework' },
  ];
  rows.forEach((r) => {
    let rx = MX + 0.1;
    const w = 2.45;
    r.nodes.forEach((n, i) => {
      miniNode(s, rx, r.y, w, n[0], n[1]);
      if (i < r.nodes.length - 1) {
        s.addShape(S.line, { x: rx + w + 0.01, y: r.y + 0.25, w: 0.5, h: 0, line: { color: C.slate, width: 1.6, endArrowType: 'triangle' } });
      }
      rx += w + 0.51;
    });
    s.addText(r.edge, { x: rx + 0.1, y: r.y, w: 3.4, h: 0.5, fontSize: 9.5, italic: true, color: C.sub, valign: 'middle', fontFace: FONT });
  });
}

// ----------------------------------------------------------------------------
// Slide 11 - Status reference
// ----------------------------------------------------------------------------
function slideStatusReference() {
  const s = baseSlide('Invoice Status Reference', 'Quick lookup');

  const head = ['Status', 'Meaning', 'Owning track'].map((t) => ({
    text: t,
    options: { bold: true, color: 'FFFFFF', fill: { color: C.navy }, fontSize: 12, align: 'left', valign: 'middle', fontFace: FONT },
  }));
  const rowsData = [
    ['RECEIVED', 'Document captured and queued for OCR.', 'Ingestion'],
    ['OCR_PROCESSING', 'OCR + field extraction is running.', 'OCR'],
    ['PENDING_REVIEW', 'AP clerk verifies extracted fields.', 'Review (UI)'],
    ['PENDING_MATCH', 'Awaiting / failing the 2-way match.', 'Match (UI)'],
    ['MATCHED', 'Passed the 2-way match; ready to route.', 'Match (UI)'],
    ['PENDING_APPROVAL', 'In the approval chain (one or more approvers).', 'Workflow'],
    ['APPROVED', 'Fully approved - terminal; ready to pay.', 'Workflow'],
    ['REJECTED', 'Bounced back; returns to PENDING_REVIEW for rework.', 'Workflow'],
    ['EXCEPTION', 'Match discrepancy flagged for resolution.', 'Match / Workflow'],
    ['DUPLICATE_INVOICE / FAILED', 'OCR-stage dead-ends (duplicate or unreadable).', 'OCR'],
  ];
  const kindByStatus = {
    RECEIVED: 'neutral', OCR_PROCESSING: 'progress', PENDING_REVIEW: 'progress',
    PENDING_MATCH: 'progress', MATCHED: 'success', PENDING_APPROVAL: 'progress',
    APPROVED: 'success', REJECTED: 'danger', EXCEPTION: 'danger',
    'DUPLICATE_INVOICE / FAILED': 'danger',
  };
  const body = rowsData.map((r, i) => {
    const zebra = i % 2 === 0 ? 'FFFFFF' : C.panel;
    const st = statusStyle(kindByStatus[r[0]] || 'neutral');
    return [
      { text: r[0], options: { bold: true, color: st.fill, fill: { color: zebra }, fontSize: 10.5, valign: 'middle', fontFace: MONO } },
      { text: r[1], options: { color: C.ink, fill: { color: zebra }, fontSize: 10.5, valign: 'middle', fontFace: FONT } },
      { text: r[2], options: { color: C.sub, fill: { color: zebra }, fontSize: 10.5, valign: 'middle', fontFace: FONT } },
    ];
  });

  s.addTable([head, ...body], {
    x: MX, y: 1.55, w: CONTENT_W, colW: [3.0, 6.73, 2.5],
    border: { type: 'solid', color: C.line, pt: 1 },
    align: 'left', valign: 'middle', rowH: 0.45, autoPage: false,
  });
}

// ----------------------------------------------------------------------------
// Slide 12 - Tech stack
// ----------------------------------------------------------------------------
function slideTechStack() {
  const s = baseSlide('Technology Stack', 'Under the hood');
  const cw = 3.95;
  const gap = 0.24;
  const y1 = 1.6;
  const y2 = 3.7;
  const h = 1.9;
  let x = MX;
  infoCard(s, x, y1, cw, h, 'Backend', [
    'NestJS (TypeScript) microservices',
    'workflow · ingestion · integrations',
    'REST APIs + scheduled cron jobs',
  ], C.red); x += cw + gap;
  infoCard(s, x, y1, cw, h, 'Frontend', [
    'Next.js + React dashboard',
    'TanStack Query data layer',
    'Review / match / approvals UIs',
  ], C.amber); x += cw + gap;
  infoCard(s, x, y1, cw, h, 'Data', [
    'PostgreSQL (Flyway migrations)',
    'Sequelize (workflow) + Prisma (OCR)',
    'Append-only audit log',
  ], C.green);

  x = MX;
  infoCard(s, x, y2, cw, h, 'Processing & queues', [
    'Tesseract / pdf-parse OCR',
    'Redis + BullMQ background jobs',
    'Server-side rules + state machine',
  ], C.slate); x += cw + gap;
  infoCard(s, x, y2, cw, h, 'Integrations & storage', [
    'Blob: OCI Object Storage / SharePoint',
    'Email (IMAP / MS Graph), SFTP',
    'SAT CFDI validation, Epicor ERP',
  ], C.red); x += cw + gap;
  infoCard(s, x, y2, cw, h, 'Platform', [
    'Docker Compose + Kubernetes',
    'Keycloak (auth) + JWT',
    'CI via GitHub Actions',
  ], C.amber);

  s.addText('See docs/STACK_DECISIONS.md for the full rationale.', {
    x: MX, y: 5.9, w: CONTENT_W, h: 0.35, fontSize: 11, italic: true, color: C.sub, fontFace: FONT,
  });
}

// ----------------------------------------------------------------------------
// Slide 13 - Key takeaways
// ----------------------------------------------------------------------------
function slideTakeaways() {
  const s = baseSlide('Key Takeaways', 'Wrap-up');
  bullets(s, MX, 1.65, CONTENT_W, 4.6, [
    { text: 'One funnel in, one status out at every step.', bold: true, fontSize: 16 },
    { text: 'All three channels (email, SFTP, web) share a single validation gate before anything is stored.', sub: true, fontSize: 13 },
    { text: 'A strict state machine governs the lifecycle.', bold: true, fontSize: 16 },
    { text: 'RECEIVED -> OCR_PROCESSING -> PENDING_REVIEW -> PENDING_MATCH -> MATCHED -> PENDING_APPROVAL -> APPROVED, with EXCEPTION and REJECTED off-ramps.', sub: true, fontSize: 13 },
    { text: 'Humans verify; the system enforces.', bold: true, fontSize: 16 },
    { text: 'Every invoice is reviewed by a clerk; the 2-way match (+/-2%) and CFDI guard gate progress; segregation of duties governs approvals.', sub: true, fontSize: 13 },
    { text: 'Auditable end-to-end.', bold: true, fontSize: 16 },
    { text: 'Every transition and approval is written to an append-only audit log.', sub: true, fontSize: 13 },
  ], { spaceAfter: 9 });
}

// ----------------------------------------------------------------------------
// Build + write
// ----------------------------------------------------------------------------
function build() {
  slideTitle();
  slideExecSummary();
  slideJourney();
  slideArchitecture();
  slideIngestion();
  slideOcr();
  slideBridge();
  slideMatch();
  slideApproval();
  slideLifecycle();
  slideStatusReference();
  slideTechStack();
  slideTakeaways();
}

async function main() {
  build();
  const outFile = path.join(__dirname, '..', 'docs', 'Martinrea-AP-Workflow.pptx');
  await pptx.writeFile({ fileName: outFile });
  console.log(`Wrote ${pageNo} slides -> ${outFile}`);
}

main().catch((err) => {
  console.error('Failed to generate presentation:', err);
  process.exit(1);
});
