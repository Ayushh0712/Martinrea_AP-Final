import { ExtractorService } from './extractor.service';
import { OcrToken } from './interfaces/ocr-token.interface';

/**
 * Focused coverage for line-item item-code extraction (the 2-way match keys on
 * itemCode). Exercised through the public flat-text `extract()` path.
 */
describe('ExtractorService - line item codes', () => {
  const svc = new ExtractorService();

  it('lifts a leading alphanumeric SKU with dashes and a decimal dimension', () => {
    const text = 'STL-CR-0.18x36 Cold-rolled steel sheet 50 281.86 14092.88';
    const [line] = svc.extract(text, 90).line_items;
    expect(line).toBeDefined();
    expect(line.itemCode).toBe('STL-CR-0.18x36');
    expect(line.description).toBe('Cold-rolled steel sheet');
    expect(line.quantity).toBe(50);
    expect(line.unitPrice).toBe(281.86);
    expect(line.lineTotal).toBe(14092.88);
  });

  it('lifts an all-uppercase dashed code with no digits (POL-ABS-NAT)', () => {
    const text = 'POL-ABS-NAT ABS resin pellets natural 18 2.58 46.38';
    const [line] = svc.extract(text, 90).line_items;
    expect(line.itemCode).toBe('POL-ABS-NAT');
    expect(line.description).toBe('ABS resin pellets natural');
  });

  it('lifts a code even when the description also contains digits', () => {
    const text = 'WIRE-CU-12AWG Copper wire 12AWG THHN 50 0.44 22.23';
    const [line] = svc.extract(text, 90).line_items;
    expect(line.itemCode).toBe('WIRE-CU-12AWG');
    expect(line.description).toBe('Copper wire 12AWG THHN');
    expect(line.quantity).toBe(50);
  });

  it('does NOT treat a hyphenated plain word as an item code', () => {
    const text = 'Cold-rolled steel sheet wide 50 281.86 14092.88';
    const [line] = svc.extract(text, 90).line_items;
    expect(line.itemCode).toBeNull();
    expect(line.description).toBe('Cold-rolled steel sheet wide');
  });
});

/**
 * Date normalisation: day-first numeric dates must not be silently read as
 * US month-first, and month-name dates must not shift a day due to a UTC
 * conversion on servers east of UTC.
 */
describe('ExtractorService - date normalisation', () => {
  const svc = new ExtractorService();

  it('reads dd/mm/yyyy day-first (04/05/2026 -> 2026-05-04)', () => {
    expect(svc.extract('Invoice Date: 04/05/2026', 90).invoice_date).toBe(
      '2026-05-04',
    );
  });

  it('reads a month-name date with no timezone shift (May 5, 2026 -> 2026-05-05)', () => {
    expect(svc.extract('Invoice Date: May 5, 2026', 90).invoice_date).toBe(
      '2026-05-05',
    );
  });

  it('keeps an ISO yyyy-mm-dd date intact', () => {
    expect(svc.extract('Invoice Date: 2026-05-04', 90).invoice_date).toBe(
      '2026-05-04',
    );
  });
});

/**
 * cleanMoney parses noisy joined token text. It must re-merge OCR-split figures
 * but not swallow a second, separate figure sitting on the same row, and it
 * must keep a single fractional digit rather than inflating the value tenfold.
 */
describe('ExtractorService - cleanMoney', () => {
  const svc = new ExtractorService();
  const clean = (s: string): number | null =>
    (svc as unknown as { cleanMoney(t: string): number | null }).cleanMoney(s);

  it('keeps only the first figure when two are joined ("1,000.00 130.00")', () => {
    expect(clean('1,000.00 130.00')).toBe(1000);
  });

  it('re-merges an OCR-split thousands figure ("47 882.03")', () => {
    expect(clean('47 882.03')).toBe(47882.03);
  });

  it('re-merges an OCR-split decimal ("15,497 83")', () => {
    expect(clean('15,497 83')).toBe(15497.83);
  });

  it('keeps a single fractional digit ("1234.5")', () => {
    expect(clean('1234.5')).toBe(1234.5);
  });
});

/**
 * The grand-total lookup must ignore non-monetary "Total X" footer rows
 * (Total Items / Weight / Qty) that would otherwise overwrite the real total
 * on the layout path.
 */
describe('ExtractorService - total label', () => {
  const svc = new ExtractorService();

  const tok = (text: string, left: number, line: number): OcrToken => ({
    text,
    conf: 95,
    left,
    top: line * 100,
    width: text.length * 10,
    height: 20,
    block: 0,
    par: 0,
    line,
    page: 0,
  });

  it('does not let "Total Items" overwrite the real total on the layout path', () => {
    const tokens: OcrToken[] = [
      tok('Total', 0, 0),
      tok('Due:', 60, 0),
      tok('47,882.03', 140, 0),
      tok('Total', 0, 1),
      tok('Items:', 60, 1),
      tok('12', 180, 1),
    ];
    const rawText = 'Total Due: 47,882.03\nTotal Items: 12';
    expect(svc.extract(rawText, 90, tokens).total_amount).toBe(47882.03);
  });
});

/**
 * Layout-aware supplier lookup on two-column headers. A "(BILL FROM)"
 * qualifier belongs to the SUPPLIER column and must not be mistaken for the
 * buyer's "BILL TO" header — that mistake capped the supplier column right
 * after the word "SUPPLIER" and truncated "Precision Tooling LLC" to
 * "Precision".
 */
describe('ExtractorService - supplier layout lookup', () => {
  const svc = new ExtractorService();

  const tok = (text: string, left: number, line: number): OcrToken => ({
    text,
    conf: 95,
    left,
    top: line * 100,
    width: text.length * 10,
    height: 20,
    block: 0,
    par: 0,
    line,
    page: 0,
  });

  it('reads the full name under "SUPPLIER (BILL FROM)" next to a "BILL TO" column', () => {
    const tokens: OcrToken[] = [
      // Header row: supplier column with qualifier | buyer column at x=400.
      tok('SUPPLIER', 0, 0),
      tok('(BILL', 90, 0),
      tok('FROM)', 150, 0),
      tok('BILL', 400, 0),
      tok('TO', 450, 0),
      // Value row: both columns merged into one visual line.
      tok('Precision', 0, 1),
      tok('Tooling', 100, 1),
      tok('LLC', 180, 1),
      tok('Martinrea', 400, 1),
      tok('Plant', 500, 1),
    ];
    const rawText =
      'SUPPLIER (BILL FROM) BILL TO\nPrecision Tooling LLC Martinrea Plant';
    expect(svc.extract(rawText, 90, tokens).supplier_name).toBe(
      'Precision Tooling LLC',
    );
  });

  it('supports a standalone "BILL FROM:" supplier header', () => {
    const tokens: OcrToken[] = [
      tok('BILL', 0, 0),
      tok('FROM:', 50, 0),
      tok('Precision', 110, 0),
      tok('Tooling', 210, 0),
      tok('LLC', 290, 0),
    ];
    const rawText = 'BILL FROM: Precision Tooling LLC';
    expect(svc.extract(rawText, 90, tokens).supplier_name).toBe(
      'Precision Tooling LLC',
    );
  });
});
