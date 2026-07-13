import { Injectable, Logger } from '@nestjs/common';
import { ConfidenceService } from '../confidence.service';
import { ExtractorService } from '../extractor.service';
import { DocumentTypeDetector } from './document-type.detector';
import { LanguageDetector } from './language.detector';
import type { OcrToken } from '../interfaces/ocr-token.interface';
import type { ParsedInvoice, ParsedLineItem } from './parsed-invoice.interface';

export interface OcrParserInput {
  /** Raw text returned by Tesseract / pdf-parse. NOT exposed past this layer. */
  rawText: string;
  /** Overall OCR engine confidence for this document (0..100). */
  ocrConfidence: number;
  /**
   * Optional per-word bounding boxes (from the OCR pass) for layout-aware field
   * extraction. Absent for digital-PDF text-layer extraction -> regex fallback.
   */
  tokens?: OcrToken[];
}

/**
 * Standardized OCR JSON Parser (Feature 1).
 *
 * The OCR parser is the *only* component that should see the raw OCR text.
 * It orchestrates:
 *   - `ExtractorService`       — regex/heuristic field extraction
 *   - `LanguageDetector`       — English / Spanish
 *   - `DocumentTypeDetector`   — INVOICE / RECEIPT / PURCHASE_ORDER
 *   - `ConfidenceService`      — rule-based scoring + reviewReason
 *
 * and returns a `ParsedInvoice` whose shape matches the Prisma `Invoice`
 * model field names exactly, so the processor can persist it without any
 * field renaming.
 *
 * Contract:
 *   - Every field on the returned object is always present.
 *   - Missing values are `null` (or `[]` for `lineItems`).
 *   - The raw OCR string is NEVER returned to the caller.
 */
@Injectable()
export class OcrParserService {
  private readonly logger = new Logger(OcrParserService.name);

  constructor(
    private readonly extractor: ExtractorService,
    private readonly confidence: ConfidenceService,
    private readonly languageDetector: LanguageDetector,
    private readonly documentTypeDetector: DocumentTypeDetector,
  ) {}

  parse(input: OcrParserInput): ParsedInvoice {
    const { rawText, ocrConfidence, tokens } = input;
    const safeText = typeof rawText === 'string' ? rawText : '';

    // 1. Field extraction (layout-aware when tokens present, else regex/heuristic).
    const extracted = this.extractor.extract(safeText, ocrConfidence, tokens);

    // 2. Detectors.
    const language = this.languageDetector.detect(safeText);
    const { documentType } = this.documentTypeDetector.detect(safeText);

    // 3. Confidence scoring (rule-based, spec-compliant).
    const scoring = this.confidence.score({
      fields: extracted,
      ocrConfidence,
    });

    const lineItems: ParsedLineItem[] = extracted.line_items.map((l) => ({
      itemCode: l.itemCode ?? null,
      description: l.description ?? null,
      quantity: typeof l.quantity === 'number' ? l.quantity : null,
      unitPrice: typeof l.unitPrice === 'number' ? l.unitPrice : null,
      lineTotal: typeof l.lineTotal === 'number' ? l.lineTotal : null,
    }));

    const parsed: ParsedInvoice = {
      supplierName: extracted.supplier_name,
      supplierTaxId: extracted.supplier_tax_id,
      invoiceNumber: extracted.invoice_number,
      invoiceDate: extracted.invoice_date,
      poNumber: extracted.po_number,
      subtotal: extracted.subtotal,
      taxAmount: extracted.tax_amount,
      totalAmount: extracted.total_amount,
      currency: extracted.currency,
      confidenceScore: scoring.score,
      requiresReview: scoring.requiresReview,
      reviewReason: scoring.reviewReason,
      language,
      documentType,
      lineItems,
    };

    this.logger.debug(
      `Parsed: lang=${language} type=${documentType} ` +
        `score=${scoring.score} review=${scoring.requiresReview} ` +
        `missing=[${scoring.missingFields.join(',')}] invalid=[${scoring.invalidFields.join(',')}]`,
    );

    return parsed;
  }
}
