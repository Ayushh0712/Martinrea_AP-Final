import { DocumentType } from '../../../common/enums/document-type.enum';

/**
 * Language code stored on `Invoice.language`. The column is a plain nullable
 * TEXT so we restrict the values here with a union type. Add to the union when
 * a new locale is supported by `LanguageDetector`.
 */
export type ParsedLanguage = 'ENGLISH' | 'SPANISH';

/**
 * Document type returned by `DocumentTypeDetector`. Aliased to the shared
 * `DocumentType` enum so the parser output can be persisted directly to
 * `Invoice.documentType` without a string-to-enum cast.
 */
export type ParsedDocumentType = DocumentType;

export interface ParsedLineItem {
  itemCode: string | null;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
}

/**
 * Standardized OCR JSON mapping (Feature 1).
 *
 * Contract:
 *   - Every field is always present in the object (never `undefined`).
 *   - Missing values are `null` (or `[]` for `lineItems`).
 *   - Field names match the Prisma `Invoice` model so the processor can
 *     persist this object without renaming.
 *   - Raw OCR text is NEVER exposed here. Callers above the parser receive
 *     only this clean business shape.
 *
 * `confidenceScore` is computed by `ConfidenceService.score(...)`:
 *   - 100 starting score
 *   - -15 per missing required field
 *   - -10 per invalid required field
 *   - additional deduction when Tesseract reports low confidence
 *
 * `requiresReview` is `true` iff `confidenceScore < CONFIDENCE_THRESHOLD`
 * (env var, defaulting to 80). When `true`, `reviewReason` carries a
 * human-readable explanation, e.g. "Missing required fields: PO Number".
 */
export interface ParsedInvoice {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // ISO YYYY-MM-DD
  poNumber: string | null;

  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string | null;

  confidenceScore: number; // 0..100
  requiresReview: boolean;
  reviewReason: string | null;

  language: ParsedLanguage;
  documentType: ParsedDocumentType;

  lineItems: ParsedLineItem[];
}
