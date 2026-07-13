import { Injectable, Logger } from '@nestjs/common';
import {
  ExtractedField,
  ExtractedInvoice,
  ExtractedLineItem,
} from './interfaces/extracted-invoice.interface';
import { OcrToken } from './interfaces/ocr-token.interface';

/** A group of OCR tokens sharing the same TSV line, plus its geometry. */
interface TokenLine {
  tokens: OcrToken[];
  text: string;
  top: number;
  left: number;
  right: number;
}

/**
 * Heuristic invoice field extractor.
 *
 * Given raw OCR text and an overall OCR confidence, this service uses
 * a set of regex patterns to pull header fields and line items out of
 * the text. Each field gets its own confidence score derived from:
 *   - the underlying OCR confidence
 *   - whether a match was actually found
 *   - whether parsing produced a sensible value
 */
@Injectable()
export class ExtractorService {
  private readonly logger = new Logger(ExtractorService.name);

  extract(rawText: string, ocrConfidence: number, tokens?: OcrToken[]): ExtractedInvoice {
    const text = this.normalize(rawText);
    // When bounding boxes are available we try positional ("layout-aware")
    // lookup first and fall back to flat-text regex; otherwise it's regex only.
    const lines = tokens && tokens.length ? this.buildLines(tokens) : null;

    const supplier = this.withLayout(
      lines && this.lookupSupplierLayout(lines),
      () => this.extractSupplier(text, ocrConfidence),
      ocrConfidence,
    );
    const supplierTaxId = this.extractSupplierTaxId(text, ocrConfidence);
    const invoiceNumber = this.withLayout(
      lines &&
        this.lookupLabeledValue(lines, ExtractorService.INVOICE_NUM_LABEL, (s) =>
          this.codeValue(s),
        ),
      () => this.extractInvoiceNumber(text, ocrConfidence),
      ocrConfidence,
    );
    const invoiceNumberValue = this.reconcileInvoiceRef(text, invoiceNumber.value);
    const invoiceDate = this.withLayout(
      lines &&
        this.lookupLabeledValue(
          lines,
          ExtractorService.INVOICE_DATE_LABEL,
          (s) => this.parseDateToken(s),
          ExtractorService.DUE_DATE_LABEL,
        ),
      () => this.extractInvoiceDate(text, ocrConfidence),
      ocrConfidence,
    );
    const poNumber = this.withLayout(
      lines &&
        this.lookupLabeledValue(lines, ExtractorService.PO_LABEL, (s) =>
          this.codeValue(s),
        ),
      () => this.extractPoNumber(text, ocrConfidence),
      ocrConfidence,
    );
    const currency = this.withLayout(
      lines &&
        this.lookupLabeledValue(lines, ExtractorService.CURRENCY_LABEL, (s) =>
          this.parseCurrencyCode(s),
        ),
      () => this.extractCurrency(text, ocrConfidence),
      ocrConfidence,
    );
    const subtotal = this.withLayout(
      lines &&
        this.lookupLabeledMoney(
          lines,
          ExtractorService.SUBTOTAL_LABEL,
          /importe\s*total|gran\s*total|total\s*neto|total\s*a\s*pagar/i,
        ),
      () =>
        this.extractAmount(
          text,
          ['sub[\\s-]*total', 'net\\s*amount', 'importe\\s*bruto', 'base\\s*imponible', 'suma', 'importe(?![\\s:]+total)'],
          ocrConfidence,
        ),
      ocrConfidence,
    );
    const tax = this.withLayout(
      this.resolveTax(lines),
      () =>
        this.extractAmount(
          text,
          ['tax', 'vat', 'gst', 'hst', 'iva', 'igv', 'i\\.?\\s*v\\.?\\s*a', 'sales\\s*tax', 'impuesto', 'consumption\\s*tax'],
          ocrConfidence,
        ),
      ocrConfidence,
    );
    const total = this.withLayout(
      lines &&
        this.lookupLabeledMoney(
          lines,
          ExtractorService.TOTAL_LABEL,
          ExtractorService.SUBTOTAL_LABEL,
        ),
      () =>
        this.extractAmount(
          text,
          [
            'total\\s*due',
            'amount\\s*due',
            'amount\\s*payable',
            'balance\\s*due',
            'grand\\s*total',
            'total\\s*payable',
            'importe\\s*total',
            'total\\s*a\\s*pagar',
            'total\\s*neto',
            'gran\\s*total',
            // Bare "total" excludes non-monetary "Total Items/Weight/Qty" rows.
            'total(?!\\s*(?:items?|qty|quantity|units?|pcs|pieces?|pages?|lines?|hrs|hours?|weight|wt|cartons?|boxes|pallets?))',
          ],
          ocrConfidence,
        ),
      ocrConfidence,
    );
    // Prefer column-aware (layout) line-item extraction; fall back to flat-text
    // regex when there are no tokens or the table couldn't be located.
    const layoutItems =
      tokens && tokens.length ? this.extractLineItemsLayout(tokens) : [];
    const lineItems = layoutItems.length
      ? layoutItems
      : this.extractLineItems(text);

    // Cross-check the total against subtotal + tax to catch mis-captures.
    const reconciledTotal = this.reconcileTotal(
      subtotal.value,
      tax.value,
      total.value,
    );

    const fieldConfidences: Record<string, number> = {
      supplier_name: supplier.confidence,
      supplier_tax_id: supplierTaxId.confidence,
      invoice_number: invoiceNumber.confidence,
      invoice_date: invoiceDate.confidence,
      po_number: poNumber.confidence,
      currency: currency.confidence,
      subtotal: subtotal.confidence,
      tax_amount: tax.confidence,
      total_amount: total.confidence,
    };

    const lineItemsConfidence =
      lineItems.length > 0
        ? Math.min(100, ocrConfidence + 5) // bonus when we managed to parse some lines
        : Math.max(0, ocrConfidence - 20);
    fieldConfidences.line_items = lineItemsConfidence;

    return {
      supplier_name: supplier.value,
      supplier_tax_id: supplierTaxId.value,
      invoice_number: invoiceNumberValue,
      invoice_date: invoiceDate.value,
      po_number: poNumber.value,
      currency: currency.value,
      subtotal: subtotal.value,
      tax_amount: tax.value,
      total_amount: reconciledTotal,
      confidence_score: 0,
      requires_review: false,
      status: '',
      line_items: lineItems,
      field_confidences: fieldConfidences,
    };
  }

  private normalize(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ---------- Layout-aware extraction (uses OCR bounding boxes) ----------

  // Word-boundary anchored labels. \b before "total" stops it matching inside
  // "subtotal"; these mirror the regex-fallback label sets.
  // Covers "Invoice No/Number/#", "Document No.", "Bill No.", "Tax Invoice No",
  // "Factura", "Folio". No trailing \b so "Invoice #:" (a "#" before ":") still
  // matches. A leading \b keeps it from firing inside value codes like INV-123.
  // "Reference PO" / "Reference Order" is a PO reference, not the invoice
  // number — the lookahead keeps it from hijacking the invoice number field.
  private static readonly INVOICE_NUM_LABEL =
    /\b(?:invoice|inv|document|doc|bill)\s*(?:no\.?|number|nbr|#)|\b(?:factura|folio(?:\s*fiscal)?|comprobante)\b|\breference\b(?!\s*(?:p\.?o\b|order))/i;
  // Guards on the bare "PO"/"P.O." form:
  //   (?<![A-Za-z0-9-]) — don't fire inside a value code ("PO" in "MR-PO-545661")
  //   (?![.\s]*box)     — don't match a "P.O. Box <n>" mailing address
  //   (?![A-Za-z])      — don't match the "Po" inside a word ("Powder", "Port")
  // The explicit label phrases ("purchase order", "order no") are unaffected.
  private static readonly PO_LABEL =
    /(?<![A-Za-z0-9-])p\.?\s*o\.?(?![.\s]*box)(?:\s*(?:no\.?|number|#))?(?![A-Za-z])|\bpurchase\s*order\b|\border\s*(?:no\.?|number|#|ref(?:erence)?)|\bcustomer\s*po\b|\borden\b(?:\s*(?:de\s*compra|no\.?|n[uú]mero|#))?|\bpedido\b(?:\s*(?:de\s*compra|cliente|no\.?|n[uú]mero|#))?|\breferencia\s*de\s*compra\b|[o0]\.?\s*c\.?\s*(?:no\.?|n[uú]mero|#)/i;
  private static readonly INVOICE_DATE_LABEL =
    /\b(?:invoice\s*date|date\s*of\s*invoice|fecha\s*de\s*emisi[oó]n|fecha\s*emisi[oó]n)\b|\bfecha\s*:(?!\s*(?:de\s*(?:pago|vencimiento)|limite))|(?<!due\s)(?<!payment\s)\bdate\b\s*:/i;
  private static readonly DUE_DATE_LABEL =
    /\b(?:due\s*date|payment\s*due|vence|fecha\s*limite|fecha\s*de\s*vencimiento|pago\s*hasta|fecha\s*de\s*pago)\b/i;
  private static readonly CURRENCY_LABEL = /\bmoneda\b/i;
  private static readonly SUBTOTAL_LABEL =
    /\b(?:sub[\s-]*total|net\s*amount|importe\s*bruto|base\s*imponible|suma)\b|\bimponible\s*:|\bimporte\s*:(?!\s*total)/i;
  private static readonly TAX_LABEL =
    /\b(?:tax|vat|gst|hst|iva|i\.?\s*v\.?\s*a|iv\.a|igv|sales\s*tax|impuesto|consumption\s*tax)\b/i;
  // CGST/SGST (Indian split tax) are summed separately in extract().
  private static readonly CGST_LABEL = /\bcgst\b/i;
  private static readonly SGST_LABEL = /\bsgst\b/i;
  // The trailing bare "total" carries a negative lookahead so non-monetary
  // footers ("Total Items: 12", "Total Weight: 450 kg", "Total Qty 30") can't
  // be mistaken for the grand total. Explicit money labels above are unaffected.
  private static readonly TOTAL_LABEL =
    /\b(?:total\s*due|amount\s*due|amount\s*payable|balance\s*due|grand\s*total|total\s*payable|importe\s*total|total\s*a\s*pagar|total\s*neto|gran\s*total|total(?!\s*(?:items?|qty|quantity|units?|pcs|pieces?|pages?|lines?|hrs|hours?|weight|wt|cartons?|boxes|pallets?)))\b/i;

  /** Groups raw tokens into reading-ordered lines with aggregate geometry. */
  private buildLines(tokens: OcrToken[]): TokenLine[] {
    const map = new Map<string, OcrToken[]>();
    const order: string[] = [];
    for (const t of tokens) {
      const key = `${t.page}.${t.block}.${t.par}.${t.line}`;
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(t);
    }
    return order.map((key) => {
      const ts = map.get(key)!.slice().sort((a, b) => a.left - b.left);
      return {
        tokens: ts,
        text: ts.map((t) => t.text).join(' '),
        top: Math.min(...ts.map((t) => t.top)),
        left: ts[0].left,
        right: Math.max(...ts.map((t) => t.left + t.width)),
      };
    });
  }

  /**
   * Finds a labeled field's value by position. Complex invoices place the value
   * in a DIFFERENT OCR line/block than its label (a right-hand meta column or a
   * summary column), and Tesseract emits multi-column pages in column order — so
   * the value is rarely on the same TSV line as the label. For each line whose
   * text matches `labelRe` we therefore look, in order:
   *
   *   1. on the SAME line, the first value token after the label
   *      (single-column invoices: "PO Number: 4500012345");
   *   2. the nearest value token to the RIGHT on the same vertical band, across
   *      all lines/blocks (two-column meta: "Invoice #:" | "NS-75854");
   *   3. the first value token on the line directly BELOW (stacked label/value).
   *
   * The LAST matching line in reading order wins (on invoices that is the
   * summary/grand-total row). Lines matching `excludeRe` are skipped (e.g. skip
   * "Subtotal" when hunting the total).
   */
  private lookupLabeledValue<T extends string | number>(
    lines: TokenLine[],
    labelRe: RegExp,
    transform: (tokenText: string) => T | null,
    excludeRe?: RegExp,
  ): T | null {
    // "strong" = value found on the same line or to the right (reliable);
    // "weak" = value guessed from the line directly below (used only when no
    // strong match exists anywhere). This stops a column HEADER like "Line
    // Total" — whose value sits below it — from beating the real "Total Due:"
    // whose value sits to its right. Last match in reading order wins per tier.
    let strong: T | null = null;
    let weak: T | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (excludeRe && excludeRe.test(line.text)) continue;
      const labelMatch = labelRe.exec(line.text);
      if (!labelMatch) continue;

      // 1) Same-line value AFTER this label. We take the value that follows THIS
      // label (not the rightmost token): two-column single-line rows like
      // "Invoice Number: X   PO Number: Y" put another field's value far right.
      const labelEnd = labelMatch.index + labelMatch[0].length;
      let pos = 0;
      let found: T | null = null;
      const after: OcrToken[] = [];
      for (const t of line.tokens) {
        const start = pos;
        pos += t.text.length + 1;
        if (start < labelEnd) continue; // token is before/inside the label
        after.push(t);
      }
      for (let k = 0; k < after.length && found === null; k++) {
        // Try the maximal CONTIGUOUS run first: OCR/PDF extraction sometimes
        // splits one code into fragments ("INV-2026-" + "0001-A7XK"). Tokens
        // whose x-gap is under ~half a char width belong to the same word, so
        // joining them rebuilds the full value; a real inter-word space is
        // wider and stops the run. Fall back to the single token.
        let joined = after[k].text;
        let prev = after[k];
        for (let n = k + 1; n < after.length; n++) {
          const t = after[n];
          const charW = prev.text.length ? prev.width / prev.text.length : 0;
          const gap = t.left - (prev.left + prev.width);
          if (charW <= 0 || gap > charW * 0.5) break;
          joined += t.text;
          prev = t;
        }
        if (joined !== after[k].text) {
          found = transform(joined);
          if (found !== null) break;
        }
        found = transform(after[k].text);
      }

      // 2) Value to the right on the same vertical band (separate column/block).
      if (found === null) {
        found = this.valueToRight(lines, i, transform);
      }

      if (found !== null) {
        strong = found; // last strong match wins
        continue;
      }

      // 3) Stacked label/value: value sits on the line directly below.
      if (i + 1 < lines.length) {
        for (const t of lines[i + 1].tokens) {
          const v = transform(t.text);
          if (v !== null) {
            weak = v; // last weak match wins, but only used if no strong match
            break;
          }
        }
      }
    }
    return strong !== null ? strong : weak;
  }

  /**
   * Scans every token (across all lines/blocks) for the value nearest to the
   * right of the label line that sits on the same horizontal band and is
   * accepted by `transform`. This bridges the multi-column gap where Tesseract
   * places a meta/summary label and its value in different OCR lines.
   */
  private valueToRight<T extends string | number>(
    lines: TokenLine[],
    labelLineIdx: number,
    transform: (tokenText: string) => T | null,
  ): T | null {
    const label = lines[labelLineIdx];
    const labelHeight = Math.max(1, ...label.tokens.map((t) => t.height || 0));
    const labelCenter = label.top + labelHeight / 2;
    const labelRight = label.right;

    let best: T | null = null;
    let bestLeft = Infinity;
    for (let j = 0; j < lines.length; j++) {
      if (j === labelLineIdx) continue;
      for (const t of label.tokens.length ? lines[j].tokens : []) {
        if (t.left < labelRight - 10) continue; // must be to the right of label
        const tHeight = t.height || labelHeight;
        const tCenter = t.top + tHeight / 2;
        // Vertically aligned with the label (same row, different column).
        if (Math.abs(tCenter - labelCenter) > Math.max(labelHeight, tHeight) * 0.7) {
          continue;
        }
        const v = transform(t.text);
        if (v !== null && t.left < bestLeft) {
          best = v;
          bestLeft = t.left;
        }
      }
    }
    return best;
  }

  /**
   * Supplier name via layout. Handles two shapes the flat-text scan cannot:
   *   1. "Supplier: Northbridge Castings" — an explicit label with the value on
   *      the same visual line (the flat candidate scan skips label:value lines);
   *   2. a "FROM (SUPPLIER)" / "VENDOR" column header with the company name on
   *      the line(s) below. Two-column invoices merge that header with the
   *      buyer's "BILL TO" header on one visual line, so only an x-windowed
   *      token selection can split the supplier column from the buyer column.
   */
  private lookupSupplierLayout(lines: TokenLine[]): string | null {
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');
    const isHdrWord = (w: string): boolean =>
      ['supplier', 'vendor', 'seller', 'emisor', 'proveedor'].includes(w);
    // "Supplier Code:" / "Supplier Tax ID:" are meta fields, not the name.
    const compound = /^(?:code|id|no|number|tax|ref|reference|gstin|rfc)$/i;
    // Words that begin the buyer column's header on a merged two-column line.
    const otherHdr = /^(?:bill|ship|sold|customer|to|cliente|receptor)$/i;
    // True when toks[k] starts the BUYER column header. "BILL FROM" is the
    // supplier's side ("bill" followed by "from"), so it must NOT count —
    // otherwise a "SUPPLIER (BILL FROM)" qualifier caps the supplier column
    // right after the word "SUPPLIER" and truncates the name below it.
    const isBuyerHdrAt = (toks: OcrToken[], k: number): boolean => {
      const w = norm(toks[k].text);
      if (!otherHdr.test(w)) return false;
      return !(
        w === 'bill' &&
        k + 1 < toks.length &&
        norm(toks[k + 1].text) === 'from'
      );
    };

    for (let i = 0; i < lines.length; i++) {
      const toks = lines[i].tokens;
      // Header: a supplier word, or the two-token pair "BILL FROM" used alone.
      let hdrIdx = toks.findIndex((t) => isHdrWord(norm(t.text)));
      let hdrEnd = hdrIdx;
      if (hdrIdx === -1) {
        hdrIdx = toks.findIndex(
          (t, k) =>
            norm(t.text) === 'bill' &&
            k + 1 < toks.length &&
            norm(toks[k + 1].text) === 'from',
        );
        if (hdrIdx === -1) continue;
        hdrEnd = hdrIdx + 1; // header spans "BILL" + "FROM"
      }
      const hdr = toks[hdrIdx];
      // Swallow a parenthetical qualifier straight after the header — e.g.
      // "SUPPLIER (BILL FROM)" — so it is neither returned as the value nor
      // mistaken for the buyer column.
      if (toks[hdrEnd + 1]?.text.startsWith('(')) {
        let k = hdrEnd + 1;
        while (k < toks.length && !toks[k].text.endsWith(')')) k++;
        if (k < toks.length) hdrEnd = k;
      }
      const next = toks[hdrEnd + 1];
      if (next && compound.test(next.text.replace(/[:#]/g, ''))) continue;

      // 1) Same-line value: join tokens after the label, stopping at the buyer
      //    column's header if the two columns merged into one visual line.
      const sameLine: string[] = [];
      for (let k = hdrEnd + 1; k < toks.length; k++) {
        if (isBuyerHdrAt(toks, k)) break;
        sameLine.push(toks[k].text);
      }
      const inline = sameLine.join(' ').replace(/^[:\-]\s*/, '').trim();
      if (inline.length >= 3 && !/^\d/.test(inline)) return inline;

      // 2) Column below: tokens on the next lines within the supplier header's
      //    x-window (bounded on the right by the buyer header's column).
      let buyerTok: OcrToken | undefined;
      for (let k = hdrEnd + 1; k < toks.length; k++) {
        if (isBuyerHdrAt(toks, k)) {
          buyerTok = toks[k];
          break;
        }
      }
      const leftBound = Math.min(lines[i].left, hdr.left) - 10;
      const rightBound = buyerTok ? buyerTok.left - 10 : Number.POSITIVE_INFINITY;
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const cell = lines[j].tokens
          .filter((t) => t.left >= leftBound && t.left < rightBound)
          .sort((a, b) => a.left - b.left)
          .map((t) => t.text)
          .join(' ')
          .trim();
        if (
          cell.length >= 3 &&
          !/^\d/.test(cell) &&
          !otherHdr.test(norm(cell.split(' ')[0]))
        ) {
          return cell;
        }
      }
    }
    return null;
  }

  /**
   * Money-specific variant of {@link lookupLabeledValue}. Amounts are read by
   * JOINING the tokens (same-line after the label, or the aligned column to the
   * right) before parsing, because Tesseract often splits a figure like
   * "£243,069.64" into "£243" + ",069.64" or "$47" + "882.03". A column header
   * ("Line Total") only yields a weak below-the-label guess, so the real
   * "Total Due:" (value to its right) always wins.
   */
  private lookupLabeledMoney(
    lines: TokenLine[],
    labelRe: RegExp,
    excludeRe?: RegExp,
  ): number | null {
    let strong: number | null = null;
    let weak: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (excludeRe && excludeRe.test(line.text)) continue;
      const labelMatch = labelRe.exec(line.text);
      if (!labelMatch) continue;
      const labelEnd = labelMatch.index + labelMatch[0].length;

      // Same-line: join all tokens after the label, then parse one amount.
      // Join with a SPACE so a decimal point Tesseract dropped to a gap between
      // tokens ("€15,497" + "83") is still seen as the decimal by cleanMoney.
      let pos = 0;
      let after = '';
      for (const t of line.tokens) {
        const start = pos;
        pos += t.text.length + 1;
        if (start < labelEnd) continue;
        after += t.text + ' ';
      }
      let found = after.trim() ? this.cleanMoney(after) : null;

      // Value column to the right, on the same vertical band.
      if (found === null) found = this.moneyToRight(lines, i);

      if (found !== null) {
        strong = found;
        continue;
      }

      // Weak: the figure stacked on the line directly below the label.
      if (i + 1 < lines.length) {
        const below = lines[i + 1].tokens.map((t) => t.text).join(' ');
        const v = this.cleanMoney(below);
        if (v !== null) weak = v;
      }
    }
    return strong !== null ? strong : weak;
  }

  /**
   * Resolves the tax amount from layout lines. Indian invoices split tax into
   * two lines ("CGST 9%" + "SGST 9%"); when both are present we SUM them.
   * Otherwise we fall through to the single TAX_LABEL lookup (returns null so
   * the caller's regex fallback runs when there are no token lines).
   */
  private resolveTax(lines: TokenLine[] | null): number | null {
    if (!lines) return null;
    // Exclude total lines: "Total (incl. GST):" contains "GST" and would
    // otherwise hijack the tax amount with the grand total.
    const ex = ExtractorService.TOTAL_LABEL;
    const cgst = this.lookupLabeledMoney(lines, ExtractorService.CGST_LABEL, ex);
    const sgst = this.lookupLabeledMoney(lines, ExtractorService.SGST_LABEL, ex);
    if (cgst !== null && sgst !== null) return Math.round((cgst + sgst) * 100) / 100;
    if (cgst !== null) return cgst;
    return this.lookupLabeledMoney(lines, ExtractorService.TAX_LABEL, ex);
  }

  /** Joins the amount column aligned to the right of the label line, then parses. */
  private moneyToRight(lines: TokenLine[], labelLineIdx: number): number | null {
    const label = lines[labelLineIdx];
    const labelHeight = Math.max(1, ...label.tokens.map((t) => t.height || 0));
    const labelCenter = label.top + labelHeight / 2;
    const right: OcrToken[] = [];
    for (let j = 0; j < lines.length; j++) {
      if (j === labelLineIdx) continue;
      for (const t of lines[j].tokens) {
        if (t.left < label.right - 10) continue;
        const tHeight = t.height || labelHeight;
        const tCenter = t.top + tHeight / 2;
        if (Math.abs(tCenter - labelCenter) > Math.max(labelHeight, tHeight) * 0.7) {
          continue;
        }
        right.push(t);
      }
    }
    if (!right.length) return null;
    right.sort((a, b) => a.left - b.left);
    return this.cleanMoney(right.map((t) => t.text).join(' '));
  }

  /**
   * Parses a monetary figure from possibly-noisy joined token text. Drops a
   * parenthetical rate ("(13.00%)"), strips currency symbols and thousands
   * separators (comma / OCR-introduced spaces), and keeps "." as the decimal.
   */
  private cleanMoney(text: string): number | null {
    const cleaned = text
      .replace(/\([^)]*\)/g, ' ') // drop "(13.00%)" qualifiers
      .replace(/[\d.,]+\s*%/g, ' '); // drop a bare "10%" rate before the amount
    const m = cleaned.match(/\d[\d.,\s]*\d|\d/);
    if (!m) return null;
    let num = m[0];
    // A row can carry more than one figure to the right of a label (e.g. a tax
    // summary "1,000.00  130.00"); the greedy match above swallows the space
    // between them. Once we see a complete "<sep><2 digits>" figure followed by
    // whitespace, drop everything after it so we keep only the FIRST amount.
    // OCR-split figures ("47 882.03", "15,497 83", "243 ,069.64") are untouched
    // because their leading fragment has no "<sep><2 digits>" before the gap.
    num = num.replace(/([.,]\d{2})\s.*$/, '$1');
    // The decimal separator is the LAST "." / "," / SPACE that is followed by
    // exactly two trailing digits. Everything else is a thousands separator.
    // This is robust to Tesseract misreading "." as "," (e.g. "67,554.72" ->
    // "67,554,72") or dropping the decimal point to a space ("15,497 83").
    const dec = num.match(/[.,\s](\d{2})$/);
    if (dec) {
      num = num.slice(0, num.length - 3).replace(/[.,\s]/g, '') + '.' + dec[1];
    } else if (/^\d+[.,]\d$/.test(num)) {
      // A single fractional digit ("1234.5"): keep it as the decimal instead of
      // stripping the separator and inflating the value tenfold.
      num = num.replace(',', '.');
    } else {
      num = num.replace(/[.,\s]/g, '');
    }
    const n = Number(num);
    return Number.isFinite(n) ? n : null;
  }

  /** Wraps a layout-derived value, falling back to the regex extractor. */
  private withLayout<T extends string | number>(
    layoutValue: T | null | undefined | false,
    fallback: () => ExtractedField<T | null>,
    ocrConfidence: number,
  ): ExtractedField<T | null> {
    if (layoutValue !== null && layoutValue !== undefined && layoutValue !== false) {
      return { value: layoutValue, confidence: this.scoreFound(ocrConfidence, true) };
    }
    return fallback();
  }

  /** Accepts a date-shaped token (ISO or d/m/y) and normalises it to ISO. */
  private parseDateToken(s: string): string | null {
    const t = s.replace(/[,]/g, '').trim();
    if (
      /^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}$/.test(t) ||
      /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(t)
    ) {
      return this.toISODate(t);
    }
    return null;
  }

  /**
   * Accepts an alphanumeric code token (invoice/PO number), rejecting dates.
   * Length cap is deliberately generous (40 chars): real invoice numbers run
   * anywhere from 4 to 30+ characters and must never be rejected or truncated.
   */
  private codeValue(s: string): string | null {
    const t = s.replace(/[:#]/g, '').trim();
    if (!/\d/.test(t)) return null; // must contain a digit
    if (/^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}$/.test(t)) return null; // ISO date
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(t)) return null; // d/m/y date
    if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]{2,39}$/.test(t)) return null;
    return t;
  }

  // ---------- Field extractors ----------

  // A trailing legal-entity suffix is the strongest signal that a line is the
  // vendor's company name (e.g. "ACME SUPPLIES LTD", "RHEINMETALL ... GMBH",
  // "TOKYO PRECISION KK", "NORTHERN STEEL CO.").
  private static readonly COMPANY_SUFFIX =
    /\b(?:ltd|ltda|limited|inc|incorporated|llc|llp|plc|gmbh|ag|kg|kk|co|corp|corporation|company|pty|sa|s\.a\.|srl|s\.r\.l|bv|n\.?v|oy|ab|spa|s\.p\.a|sas|sac)\b\.?\s*$/i;

  private extractSupplier(text: string, ocrConfidence: number): ExtractedField<string | null> {
    const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const skip =
      /^(invoice|bill\s*to|billed\s*to|bill|billing|ship\s*to|sold\s*to|receipt|tax\s*invoice|statement|purchase\s*order|order|due\s*date|date|invoice\s*number|number|no\.?|p\.?o\.?|qty|quantity|units?|description|item|sub\s*total|subtotal|total|tax|vat|gst|hst|amount|balance|customer|factura|recibo|cfdi|fecha|cliente|remit|emisor|receptor|senor|adquirente|facturar)\b/i;
    const labelValue = /^[\w .,&'/-]{1,30}:\s*\S/;
    const labelOnly =
      /^(?:emisor|receptor|cliente|senor(?:\(es\))?|adquirente|facturar\s*a)\s*:?\s*$/i;
    const cfdiTitle = /^comprobante\s+(?:fiscal|de\s+pago)\b/i;
    const customerHdr =
      /^(?:cliente|receptor|senor(?:\(es\))?|adquirente|facturar\s*a|bill\s*to|ship\s*to|sold\s*to)\b/i;

    const cleanTitle = (line: string): string => {
      const c = line
        .replace(/\s+(?:tax\s+)?(?:invoice|receipt|statement|factura|recibo|cfdi)\b.*$/i, '')
        .trim();
      return c.length >= 3 ? c : line;
    };

    // An explicit label wins over any letterhead guessing: "Supplier: X",
    // "Vendor - Y", "Sold By: Z". ("Supplier Code:" etc. don't match — the
    // label must be followed directly by ":" or "-".)
    const labeled = text.match(
      /\b(?:supplier|vendor|seller|proveedor|sold\s*by|remit\s*to)(?:\s*name)?\s*[:\-]\s*([^\n]{3,80})/i,
    );
    if (labeled) {
      const val = cleanTitle(labeled[1].trim());
      if (val.length >= 3 && !/^\d/.test(val)) {
        return { value: val, confidence: this.scoreFound(ocrConfidence, true) };
      }
    }

    // Mark customer / buyer blocks so the buyer is never returned as supplier.
    const inCustomerBlock = new Array(rawLines.length).fill(false);
    for (let i = 0; i < rawLines.length; i++) {
      if (customerHdr.test(rawLines[i])) {
        for (let k = i; k < Math.min(rawLines.length, i + 5); k++) inCustomerBlock[k] = true;
      }
    }

    // CFDI / Latin layouts: vendor sits on the line(s) after "Emisor:".
    for (let i = 0; i < Math.min(rawLines.length, 15); i++) {
      if (!/^emisor\s*:?\s*$/i.test(rawLines[i])) continue;
      for (let j = i + 1; j < Math.min(rawLines.length, i + 6); j++) {
        const line = rawLines[j];
        if (cfdiTitle.test(line) || labelOnly.test(line) || customerHdr.test(line)) {
          continue;
        }
        if (inCustomerBlock[j] || /^\d/.test(line) || line.length < 3 || line.length > 80) {
          continue;
        }
        const cleaned = cleanTitle(line);
        if (
          ExtractorService.COMPANY_SUFFIX.test(cleaned) ||
          /^[A-Z][A-Z0-9 .,&'-]{6,}$/i.test(cleaned)
        ) {
          return { value: cleaned, confidence: this.scoreFound(ocrConfidence, true) };
        }
      }
    }

    const candidates: string[] = [];
    for (let i = 0; i < Math.min(rawLines.length, 25); i++) {
      const line = rawLines[i];
      if (inCustomerBlock[i]) continue;
      if (skip.test(line)) continue;
      if (labelOnly.test(line)) continue;
      if (/^\d/.test(line)) continue;
      if (/^(date|fecha|page|p\.?o\.?\b)/i.test(line)) continue;
      if (labelValue.test(line)) continue;
      if (line.length < 3 || line.length > 80) continue;
      candidates.push(cleanTitle(line));
    }

    const value =
      candidates.find((c) => ExtractorService.COMPANY_SUFFIX.test(c)) ?? candidates[0] ?? null;
    if (value) return { value, confidence: this.scoreFound(ocrConfidence, true) };
    return { value: null, confidence: this.scoreFound(ocrConfidence, false) };
  }

  /**
   * Supplier tax/registration number — the closest thing invoices carry to a
   * "supplier id". Handles US/CA "Tax ID"/"BN", German "USt-IdNr", Mexican
   * "RFC", and UK/EU "VAT Reg". The value can contain internal spaces and
   * hyphens, so we read the rest of the header line and cut it off at the next
   * field keyword (these IDs always sit in the top vendor block).
   */
  private extractSupplierTaxId(
    text: string,
    ocrConfidence: number,
  ): ExtractedField<string | null> {
    const labels = [
      /\btax\s*(?:id|i\.?d\.?|reg(?:\.|istration)?)\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*/i,
      /\bbn\.?\s*[:#]?\s*/i,
      /\bust[-\s]?[il1]\.?d[-\s]?nr\.?\s*[:#]?\s*/i,
      /\brfc\.?\s*[:#]?\s*/i,
      /\bgst\s*in\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*/i,
      /\bvat(?:\s*(?:reg(?:\.|istration)?|no\.?|number|id))?\.?\s*[:#]?\s*/i,
      /\b(?:ein|gst\s*\/?\s*hst|abn)\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*/i,
      // Latin America / Spain
      /\bcif\s*[:#.]?\s*/i,
      /\bcuit\s*[:#.]?\s*/i,
      /\bnit\s*[:#.]?\s*/i,
      /\brut\s*[:.]?\s*/i,
      /\bnif\s*[:#.]?\s*/i,
      /\bruc\s*[:#.]?\s*/i,
    ];
    // Search every line: the vendor block is usually at the top, but some
    // layouts place it in the footer. A summary "VAT (16%):" line can't be
    // mistaken for an id because its value starts with "(" (rejected below).
    const header = text.split('\n');
    // Cut the value off where the next field begins (these lines often merge in
    // OCR, e.g. "RFC: GIM850101AB1 Tax Invoice No: ...").
    const stop =
      /\s+(?:phone|tel|fax|e-?mail|invoice|document|doc|bill|order|purchase|p\.?o\.?|date|due|payment|currency|ship|sold|remit|account|tax|reference|factura|orden|attn|attention|contact)\b.*$/i;
    for (const raw of header) {
      for (const lab of labels) {
        const m = lab.exec(raw);
        if (!m) continue;
        const rest = raw.slice(m.index + m[0].length).replace(stop, '').trim();
        // Allow internal dots (e.g. Swiss "CHE-123.456.789"); the value must
        // still begin and end with an alphanumeric so a trailing period drops.
        const vm = rest.match(/^[A-Z0-9](?:[A-Z0-9.\- ]{2,28}[A-Z0-9])?/i);
        if (!vm) continue;
        const val = this.fixTaxIdOcr(vm[0].replace(/\s{2,}/g, ' ').trim());
        if (/\d/.test(val) && val.length >= 4) {
          return { value: val, confidence: this.scoreFound(ocrConfidence, true) };
        }
      }
    }
    return { value: null, confidence: this.scoreFound(ocrConfidence, false) };
  }

  /**
   * Fixes the common OCR letter/digit confusion inside a tax id: a letter "O"
   * sitting next to a digit is almost always a "0" (e.g. the Canadian BN
   * suffix "RT0001" is frequently read as "RTO001").
   */
  private fixTaxIdOcr(value: string): string {
    return value.replace(/O(?=\d)|(?<=\d)O/g, '0');
  }

  /** Prefer the bank "Ref." value when it shares the same digit core (OCR typo fix). */
  private reconcileInvoiceRef(text: string, invoiceNo: string | null): string | null {
    if (!invoiceNo) return null;
    const refM = text.match(/\bref\.\s*([A-Z0-9\-_/]{3,40})/i);
    if (!refM?.[1]) return invoiceNo;
    const digits = (s: string) => s.replace(/\D/g, '');
    if (digits(invoiceNo) === digits(refM[1]) && digits(invoiceNo).length >= 4) {
      return refM[1].trim();
    }
    return invoiceNo;
  }

  private extractInvoiceNumber(text: string, ocrConfidence: number): ExtractedField<string | null> {
    // Value length is capped at 40: invoice numbers can legitimately run 25+
    // characters and must be captured in full, never truncated.
    const patterns = [
      // English
      /invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9\-_/]{3,40})/i,
      /inv\s*(?:no\.?|#)\s*[:\-]?\s*([A-Z0-9\-_/]{3,40})/i,
      // Bare unlabeled code, e.g. "INV-2026-0001234" — capture INCLUDING the
      // prefix so the stored number matches what is printed on the document.
      /\b(inv[-_#]?\d[A-Z0-9\-_/]{2,36})\b/i,
      /\binv\s+(\d[A-Z0-9\-_/]{2,36})\b/i,
      // Spanish
      /factura\s*(?:no\.?|n[uú]mero|#)?\s*[:\-]?\s*([A-Z0-9\-_/]{3,40})/i,
      /folio\s*(?:fiscal|interno)?\s*[:\-]?\s*([A-Z0-9\-_/]{3,40})/i,
      /comprobante\s*(?:no\.?|n[uú]mero|#)?\s*[:\-]?\s*([A-Z0-9\-_/]{3,40})/i,
      /reference\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\-_/]{3,40})/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1] && /\d/.test(m[1])) {
        return { value: m[1].trim(), confidence: this.scoreFound(ocrConfidence, true) };
      }
    }
    return { value: null, confidence: this.scoreFound(ocrConfidence, false) };
  }

  private extractInvoiceDate(text: string, ocrConfidence: number): ExtractedField<string | null> {
    const dateLabel =
      '(?:invoice\\s*date|date\\s*of\\s*invoice|fecha\\s*de\\s*emisi[oó]n|fecha\\s*emisi[oó]n|fecha(?![\\s:]+(?:de\\s*(?:pago|vencimiento)|limite))|(?<!due\\s)(?<!payment\\s)\\bdate\\b(?!\\s*of))';
    const patterns = [
      // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (2- or 4-digit year). The year
      // alternation tries 4 digits FIRST so "2026" is captured whole rather
      // than truncated to "20" by an eager 2-digit match.
      new RegExp(
        `${dateLabel}\\s*[:\\-]?\\s*([0-3]?\\d[\\/\\-\\.][0-1]?\\d[\\/\\-\\.](?:\\d{4}|\\d{2}))`,
        'i',
      ),
      // yyyy/mm/dd, yyyy-mm-dd, yyyy.mm.dd
      new RegExp(
        `${dateLabel}\\s*[:\\-]?\\s*((?:\\d{4})[\\/\\-\\.][0-1]?\\d[\\/\\-\\.][0-3]?\\d)`,
        'i',
      ),
      // dd Mon yyyy and Mon dd, yyyy (English month names)
      new RegExp(
        `${dateLabel}\\s*[:\\-]?\\s*([0-3]?\\d\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{2,4})`,
        'i',
      ),
      new RegExp(
        `${dateLabel}\\s*[:\\-]?\\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+[0-3]?\\d,?\\s+\\d{2,4})`,
        'i',
      ),
      // Spanish: "DD de Mes de YYYY" e.g. "5 de mayo de 2026"
      new RegExp(
        `${dateLabel}\\s*[:\\-]?\\s*([0-3]?\\d\\s+de\\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\\s+de\\s+\\d{4})`,
        'i',
      ),
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1]) {
        const iso = this.toISODate(m[1]);
        if (iso) return { value: iso, confidence: this.scoreFound(ocrConfidence, true) };
      }
    }
    return { value: null, confidence: this.scoreFound(ocrConfidence, false) };
  }

  private extractPoNumber(text: string, ocrConfidence: number): ExtractedField<string | null> {
    // 40-char cap mirrors extractInvoiceNumber: PO numbers must never truncate.
    const patterns = [
      /(?:p\.?o\.?(?!\s*box)\s*(?:no\.?|number|#)?|customer\s*po|purchase\s*order|order\s*(?:no\.?|number|#|ref(?:erence)?))\s*[:\-]?\s*([A-Z0-9\-_/]{3,40})/i,
      /(?:orden(?:\s*de\s*compra)?|pedido(?:\s*de\s*compra|\s*cliente)?|referencia\s*de\s*compra|[o0]\.?\s*c\.?)\s*(?:no\.?|n[uú]mero|#)?\s*[:\-]?\s*([A-Z0-9\-_/]{3,40})/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1] && /\d/.test(m[1]) && !/^box$/i.test(m[1])) {
        return { value: m[1].trim(), confidence: this.scoreFound(ocrConfidence, true) };
      }
    }
    return { value: null, confidence: this.scoreFound(ocrConfidence, false) };
  }

  private parseCurrencyCode(s: string): string | null {
    const raw = s.replace(/[:#]/g, '').trim().toUpperCase();
    const known = [
      'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'CHF', 'CNY',
      'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL',
    ];
    if (known.includes(raw)) return raw;
    if (raw === 'US$' || raw === 'U$S') return 'USD';
    if (raw === 'MX$') return 'MXN';
    return null;
  }

  private extractCurrency(text: string, ocrConfidence: number): ExtractedField<string | null> {
    const moneda = text.match(/\bmoneda\s*[:\-]?\s*([A-Z]{3})\b/i);
    if (moneda) {
      return { value: moneda[1].toUpperCase(), confidence: this.scoreFound(ocrConfidence, true) };
    }

    const m = text.match(
      /\b(USD|EUR|GBP|CAD|AUD|INR|JPY|CHF|CNY|MXN|ARS|COP|CLP|PEN|BRL|MX\$|US\$)\b/i,
    );
    if (m) {
      const raw = m[1].toUpperCase();
      const code = raw === 'MX$' ? 'MXN' : raw === 'US$' ? 'USD' : raw;
      return { value: code, confidence: this.scoreFound(ocrConfidence, true) };
    }

    if (/\bpesos\b/i.test(text) || /MX\$/.test(text)) {
      return { value: 'MXN', confidence: Math.max(50, ocrConfidence - 10) };
    }
    if (/€/.test(text)) return { value: 'EUR', confidence: Math.max(50, ocrConfidence - 10) };
    if (/£/.test(text)) return { value: 'GBP', confidence: Math.max(50, ocrConfidence - 10) };
    if (/¥/.test(text)) return { value: 'JPY', confidence: Math.max(50, ocrConfidence - 10) };
    if (/\bS\/\b/.test(text)) return { value: 'PEN', confidence: Math.max(50, ocrConfidence - 10) };

    // Only guess USD from "$" when no Latin American currency code is on the doc.
    if (/\$/.test(text) && !/\b(ARS|COP|CLP|PEN|MXN)\b/i.test(text)) {
      return { value: 'USD', confidence: Math.max(50, ocrConfidence - 10) };
    }

    return { value: null, confidence: this.scoreFound(ocrConfidence, false) };
  }

  private extractAmount(
    text: string,
    labels: string[],
    ocrConfidence: number,
  ): ExtractedField<number | null> {
    const labelGroup = labels.join('|');
    // - `\b...\b` around the label so "total" does NOT match inside "subtotal".
    // - optional "(12%)" / "12%" qualifier between label and value handles
    //   "Tax (12%): $516.00" / "HST (13%): $780.00".
    // - global flag: we scan ALL matches and keep the LAST one, which on a real
    //   invoice is the summary/grand-total line rather than an earlier mention.
    // The value may carry a symbol OR an ISO code ("Total Amount Due: USD
    // 12,750.00") between the label and the number.
    const re = new RegExp(
      `\\b(?:${labelGroup})\\b` +
        `(?:\\s*\\([^)\\n]*\\))?(?:\\s*\\d{1,2}\\s*%)?` +
        `\\s*[:\\-]?\\s*(?:[\\$€£¥]|USD|US\\$|EUR|GBP|CAD|AUD|MXN|INR|JPY|CHF|CNY|MX\\$)?\\s*` +
        `([0-9]{1,3}(?:[,\\s][0-9]{3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)`,
      'gi',
    );
    let lastMatch: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      lastMatch = m;
      if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width loops
    }
    if (lastMatch && lastMatch[1]) {
      const num = this.toNumber(lastMatch[1]);
      if (num !== null) return { value: num, confidence: this.scoreFound(ocrConfidence, true) };
    }
    return { value: null, confidence: this.scoreFound(ocrConfidence, false) };
  }

  /**
   * Column-aware line-item extraction. Tesseract reads well-spaced tables
   * column-by-column (all descriptions, then all quantities, …), which defeats
   * the flat-text row regex. Here we instead:
   *   1. locate the header row via its "Qty" / "Unit Price" / "Line Total" cells
   *      to learn each column's x-position,
   *   2. take every token between the header and the summary block,
   *   3. cluster them into rows by vertical position,
   *   4. bucket each row's tokens into columns by x and parse the cells
   *      (joining split tokens, e.g. "$20," + "125.44").
   */
  private extractLineItemsLayout(tokens: OcrToken[]): ExtractedLineItem[] {
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');
    const center = (t: OcrToken): number => t.left + t.width / 2;

    // Header synonyms per column. Qty is OPTIONAL; unit-price + line-total are
    // the reliable anchors. Covers Rate/Unit Cost/Price (unit), Units/Cant.
    // (qty), Amount/Total/Line Total/Importe (line total).
    const isQty = (w: string): boolean =>
      [
        'qty', 'quantity', 'units', 'cant', 'cantidad', 'qte', 'pcs', 'ctd', 'cdad',
        // Spanish: "Unidades", "Unidad"
        'unidades', 'unidad',
      ].includes(w);
    const isUnit = (w: string): boolean =>
      [
        'unitprice', 'unit', 'price', 'rate', 'unitcost', 'cost', 'punit',
        // Spanish: "Precio Unit.", "Precio Unitario", "Costo Unit.", "Valor Unitario"
        'precio', 'unitario', 'preciounitario', 'valorunitario', 'costo', 'costounitario',
      ].includes(w);
    const isTot = (w: string): boolean =>
      [
        'amount', 'total', 'line', 'linetotal', 'importe', 'extended', 'lineamount',
        // Spanish: "Monto", "Importe Total", "Valor", and "Subtotal" used as the
        // per-line amount column (summary "Subtotal:" carries a ":" and is skipped).
        'monto', 'importetotal', 'montototal', 'valor', 'subtotal',
      ].includes(w);

    // Header cells carry no ":"; summary labels ("Total:", "Importe:") do.
    type Cand = { t: OcrToken; cls: 'q' | 'u' | 't'; c: number };
    const cands: Cand[] = [];
    for (const t of tokens) {
      if (t.text.includes(':')) continue;
      const w = norm(t.text);
      if (!w) continue;
      if (isQty(w)) cands.push({ t, cls: 'q', c: center(t) });
      else if (isUnit(w)) cands.push({ t, cls: 'u', c: center(t) });
      else if (isTot(w)) cands.push({ t, cls: 't', c: center(t) });
    }
    if (!cands.length) return [];

    // The header is the topmost row of candidates that has BOTH a unit-price
    // and a line-total column (Tesseract emits column-by-column, but the header
    // cells still share a vertical position).
    cands.sort((a, b) => a.t.top - b.t.top);
    let header: Cand[] | null = null;
    let i = 0;
    while (i < cands.length) {
      const top0 = cands[i].t.top;
      const tol = Math.max(12, (cands[i].t.height || 20) * 0.8);
      const row: Cand[] = [];
      let j = i;
      while (j < cands.length && Math.abs(cands[j].t.top - top0) <= tol) {
        row.push(cands[j]);
        j++;
      }
      if (row.some((r) => r.cls === 'u') && row.some((r) => r.cls === 't')) {
        header = row;
        break;
      }
      i = j;
    }
    if (!header) return [];

    // Column centres. Merge adjacent unit cells ("Unit" + "Price"); take the
    // rightmost line-total cell. Qty is optional.
    const unitCells = header.filter((r) => r.cls === 'u').sort((a, b) => a.c - b.c);
    const totCells = header.filter((r) => r.cls === 't').sort((a, b) => a.c - b.c);
    const qtyCell = header.filter((r) => r.cls === 'q').sort((a, b) => a.c - b.c)[0];
    const unitC = this.mean(unitCells.map((r) => r.c));
    const totC = totCells[totCells.length - 1].c;
    const qtyC = qtyCell ? qtyCell.c : null;
    const headerTop = Math.min(...header.map((r) => r.t.top));
    const headerH = Math.max(...header.map((r) => r.t.height || 20));
    const headerBottom = headerTop + headerH;

    // Value columns sorted by x — semantic order varies (e.g. "Rate" before
    // "Qty"), so we classify body cells by NEAREST column centre, not position.
    const cols: { key: 'q' | 'u' | 't'; c: number }[] = [
      { key: 'u', c: unitC },
      { key: 't', c: totC },
    ];
    if (qtyC !== null) cols.push({ key: 'q', c: qtyC });
    cols.sort((a, b) => a.c - b.c);
    const gap = cols.length > 1 ? cols[1].c - cols[0].c : totC - unitC;
    const descBoundary = cols[0].c - gap / 2;

    // The table ends at the first summary label: a ":"-bearing token sitting to
    // the LEFT of the value columns ("Subtotal:", "Net Amount:", "Importe:").
    const summaryTops = tokens
      .filter((t) => t.top > headerBottom && t.text.includes(':') && center(t) < unitC)
      .map((t) => t.top);
    const tableBottom = summaryTops.length
      ? Math.min(...summaryTops)
      : Number.POSITIVE_INFINITY;

    const rowToks = tokens.filter(
      (t) => t.top > headerBottom - 2 && t.top < tableBottom - 2,
    );
    if (!rowToks.length) return [];
    const med = this.median(rowToks.map((t) => t.height || 20));
    const yOf = (t: OcrToken): number => t.top + (t.height || med) / 2;

    // Anchor rows on money cells in the value columns (present on every row even
    // when Tesseract drops the small qty cell).
    const anchorToks = rowToks
      .filter((t) => center(t) >= descBoundary && this.cleanMoney(t.text) !== null)
      .sort((a, b) => yOf(a) - yOf(b));
    if (!anchorToks.length) return [];

    let pitch = med * 1.5;
    const ys = anchorToks.map(yOf);
    const diffs: number[] = [];
    for (let k = 1; k < ys.length; k++) {
      const d = ys[k] - ys[k - 1];
      if (d > med * 0.4) diffs.push(d); // ignore same-row (qty+unit+total) cells
    }
    if (diffs.length) pitch = this.median(diffs) || pitch;

    const rowYs: number[] = [];
    let bucket: number[] = [];
    let rowStart: number | null = null;
    for (const y of ys) {
      if (rowStart === null || y - rowStart > pitch * 0.55) {
        if (bucket.length) rowYs.push(this.mean(bucket));
        bucket = [];
        rowStart = y;
      }
      bucket.push(y);
    }
    if (bucket.length) rowYs.push(this.mean(bucket));

    const nearestKey = (cx: number): 'q' | 'u' | 't' => {
      let best = cols[0];
      let bestD = Infinity;
      for (const col of cols) {
        const d = Math.abs(cx - col.c);
        if (d < bestD) {
          bestD = d;
          best = col;
        }
      }
      return best.key;
    };

    const items: ExtractedLineItem[] = [];
    for (const rowY of rowYs) {
      const rowTokens = rowToks.filter((t) => Math.abs(yOf(t) - rowY) <= pitch * 0.5);
      const desc: string[] = [];
      const q: string[] = [];
      const u: string[] = [];
      const tt: string[] = [];
      for (const t of rowTokens.slice().sort((a, b) => a.left - b.left)) {
        const cx = center(t);
        if (cx < descBoundary) {
          desc.push(t.text);
          continue;
        }
        const key = nearestKey(cx);
        if (key === 'q') q.push(t.text);
        else if (key === 'u') u.push(t.text);
        else tt.push(t.text);
      }
      let quantity = q.length ? this.cleanMoney(q.join('')) : null;
      const unitPrice = this.cleanMoney(u.join(''));
      const lineTotal = this.cleanMoney(tt.join(''));
      // Recover a qty the OCR dropped from total / unit price.
      if (quantity === null && unitPrice && lineTotal && unitPrice > 0) {
        const derived = lineTotal / unitPrice;
        quantity =
          Math.abs(derived - Math.round(derived)) < 0.02
            ? Math.round(derived)
            : Math.round(derived * 100) / 100;
      }
      const cleaned = this.cleanLineDescription(desc.join(' '));
      const { itemCode, description } = this.splitItemCode(cleaned);
      if (
        (description.length >= 2 || itemCode !== null) &&
        unitPrice !== null &&
        lineTotal !== null
      ) {
        items.push({ itemCode, description, quantity, unitPrice, lineTotal });
      }
    }
    return items;
  }

  private mean(nums: number[]): number {
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  private median(nums: number[]): number {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /**
   * Lifts a leading item-code / SKU / part-number token off the front of a line
   * description into its own field. Item codes are read as the first column of
   * an invoice line but Tesseract folds them into the description text; the
   * 2-way match keys on itemCode, so we recover it here.
   *
   * A leading token is treated as a code when it is a single code-shaped token
   * (letters/digits plus `-._/`), contains a hyphen, and is clearly not a plain
   * word: it either carries a digit (e.g. `STL-CR-0.18x36`, `WIRE-CU-12AWG`) or
   * is all-uppercase letters (e.g. `POL-ABS-NAT`). This rejects hyphenated words
   * like "Cold-rolled" that legitimately begin a description.
   */
  private splitItemCode(description: string): {
    itemCode: string | null;
    description: string;
  } {
    const trimmed = description.trim();
    if (!trimmed) return { itemCode: null, description: '' };
    const spaceIdx = trimmed.search(/\s/);
    const first = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
    if (this.looksLikeItemCode(first)) {
      return { itemCode: first, description: rest };
    }
    return { itemCode: null, description: trimmed };
  }

  /** True when a token looks like an item code / SKU (see splitItemCode). */
  private looksLikeItemCode(token: string): boolean {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,}$/.test(token)) return false;
    if (!token.includes('-')) return false;
    const letters = token.replace(/[^A-Za-z]/g, '');
    const allUpper = letters.length > 0 && letters === letters.toUpperCase();
    const hasDigit = /\d/.test(token);
    return hasDigit || allUpper;
  }

  /** Strips leading row numbers ("17", "17.", "17)") and normalises whitespace. */
  private cleanLineDescription(raw: string): string {
    return raw
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\d{1,2}[.)]?\s+/, '');
  }

  private extractLineItems(text: string): ExtractedLineItem[] {
    const items: ExtractedLineItem[] = [];
    const lines = text.split('\n');

    // Pattern: <description> <qty> <unit_price> <line_total>
    // Tolerate a few separators and currency symbols.
    const re =
      /^(.+?)\s+(\d{1,4}(?:\.\d{1,2})?)\s+[\$€£¥]?(\d{1,7}(?:[,\d]{0,8})?(?:\.\d{1,2})?)\s+[\$€£¥]?(\d{1,8}(?:[,\d]{0,9})?(?:\.\d{1,2})?)$/;

    // Skip totals rows in either language.
    const skip =
      /^(sub\s*total|total|tax|vat|gst|hst|iva|importe|amount\s*due|balance|total\s*a\s*pagar|impuesto)/i;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (skip.test(line)) continue;

      const m = line.match(re);
      if (!m) continue;

      const { itemCode, description } = this.splitItemCode(m[1].trim());
      const quantity = this.toNumber(m[2]);
      const unitPrice = this.toNumber(m[3]);
      const lineTotal = this.toNumber(m[4]);

      if (description.length < 2 && itemCode === null) continue;
      if (quantity === null || unitPrice === null || lineTotal === null) continue;

      items.push({ itemCode, description, quantity, unitPrice, lineTotal });
    }
    return items;
  }

  // ---------- Helpers ----------

  /**
   * Cross-checks the captured total against subtotal + tax. Conservative on
   * purpose: only derives the total when it is missing, or corrects it when it
   * clearly grabbed the subtotal by mistake (equals subtotal while subtotal+tax
   * differs). A plausible total is never overridden, since discounts/shipping
   * legitimately make total != subtotal + tax.
   */
  private reconcileTotal(
    subtotal: number | null,
    tax: number | null,
    total: number | null,
  ): number | null {
    if (subtotal === null || tax === null) return total;
    const sum = Math.round((subtotal + tax) * 100) / 100;
    const eq = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;
    if (total === null) return sum;
    if (eq(total, subtotal) && !eq(sum, subtotal)) return sum;
    return total;
  }

  private toNumber(raw: string): number | null {
    if (!raw) return null;
    const cleaned = raw.replace(/[,\s]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  private static readonly SPANISH_MONTHS: Record<string, string> = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
    noviembre: '11', diciembre: '12',
  };

  private toISODate(raw: string): string | null {
    const trimmed = raw.trim();

    // Spanish: "DD de Mes de YYYY"
    const spanish = trimmed
      .toLowerCase()
      .match(/^([0-3]?\d)\s+de\s+([a-zñ]+)\s+de\s+(\d{4})$/);
    if (spanish) {
      const [, d, monthName, y] = spanish;
      const m = ExtractorService.SPANISH_MONTHS[monthName];
      if (m) {
        const iso = this.buildISO(Number(y), Number(m), Number(d));
        if (iso) return iso;
      }
    }

    // ISO-first numeric: yyyy/mm/dd, yyyy-mm-dd, yyyy.mm.dd. Handled explicitly
    // (not via `new Date`) so it never depends on the host's TZ.
    const ymd = trimmed.match(/^(\d{4})[\/\-.]([0-1]?\d)[\/\-.]([0-3]?\d)$/);
    if (ymd) {
      const [, y, m, d] = ymd;
      const iso = this.buildISO(Number(y), Number(m), Number(d));
      if (iso) return iso;
    }

    // dd/mm/yyyy or dd-mm-yyyy (also dd.mm.yyyy). Parsed BEFORE the generic
    // `new Date` fallback, because V8 reads "04/05/2026" as US-style April 5;
    // the OCR date patterns feeding this are day-first, so honour that here.
    const dmy = trimmed.match(/^([0-3]?\d)[\/\-\.]([0-1]?\d)[\/\-\.](\d{2}|\d{4})$/);
    if (dmy) {
      const [, d, m, y] = dmy;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const iso = this.buildISO(year, Number(m), Number(d));
      if (iso) return iso;
    }

    // Month-name forms ("May 5, 2026", "5 May 2026"): let the engine parse it,
    // but read back LOCAL components. `toISOString()` would convert local
    // midnight to UTC and shift the date back a day on servers east of UTC.
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return this.buildISO(date.getFullYear(), date.getMonth() + 1, date.getDate());
    }
    return null;
  }

  /** Builds a `yyyy-mm-dd` string from numeric parts, validating the ranges. */
  private buildISO(year: number, month: number, day: number): string | null {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  private scoreFound(ocrConfidence: number, found: boolean): number {
    if (!found) return Math.max(0, Math.round(ocrConfidence * 0.4));
    return Math.max(0, Math.min(100, Math.round(ocrConfidence)));
  }
}
