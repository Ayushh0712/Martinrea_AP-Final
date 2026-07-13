import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExtractedInvoice } from './interfaces/extracted-invoice.interface';

/** Field keys used by the rule-based scoring engine (Feature 2). */
export type RequiredFieldKey =
  | 'supplierName'
  | 'invoiceNumber'
  | 'invoiceDate'
  | 'poNumber'
  | 'totalAmount'
  | 'currency';

/** Pretty labels used in `reviewReason` messages. */
const FIELD_LABELS: Record<RequiredFieldKey, string> = {
  supplierName: 'Supplier Name',
  invoiceNumber: 'Invoice Number',
  invoiceDate: 'Invoice Date',
  poNumber: 'PO Number',
  totalAmount: 'Total Amount',
  currency: 'Currency',
};

export interface ConfidenceInput {
  fields: ExtractedInvoice;
  /** OCR engine (Tesseract) confidence for the document, 0..100. */
  ocrConfidence: number;
}

export interface ConfidenceResult {
  /** 0..100 score, integer. */
  score: number;
  /** True iff `score < threshold`. */
  requiresReview: boolean;
  /** Human-readable reason when `requiresReview = true`, else `null`. */
  reviewReason: string | null;
  /** Required fields that were missing (null/empty). */
  missingFields: RequiredFieldKey[];
  /** Required fields that had a value but failed validation. */
  invalidFields: RequiredFieldKey[];
  /** Component deductions, useful for diagnostics & tests. */
  deductions: {
    missing: number;
    invalid: number;
    lowOcr: number;
  };
}

/**
 * Rule-based confidence scoring engine (Feature 2).
 *
 * The legacy `computeAggregate` + `requiresReview` methods are kept so the
 * existing `InvoiceProcessorService` continues to compile while the rest of
 * the new pipeline is built out. Phase 3 swaps the processor to call
 * `score(...)` directly.
 *
 * Algorithm:
 *   Start = 100
 *   For each missing required field            -> -15
 *   For each present-but-invalid required field -> -10
 *   For low OCR confidence (Tesseract < 80)    -> deduct linearly,
 *                                                  capped at -25
 *   Final score is clamped to [0, 100].
 *
 * Worked examples (matching the spec):
 *   - All fields present, OCR=95           -> 100
 *   - PO Number missing, OCR=95            -> 85
 *   - PO + Currency missing, OCR=95        -> 70
 *   - InvoiceNumber + Supplier + PO missing -> 55
 *   - All fields present, OCR=60           -> 100 - 20 = 80 (just at threshold)
 *
 * `requiresReview` is `true` iff `score < CONFIDENCE_THRESHOLD` (default 80).
 */
@Injectable()
export class ConfidenceService {
  private readonly logger = new Logger(ConfidenceService.name);

  private static readonly DEDUCT_MISSING = 15;
  private static readonly DEDUCT_INVALID = 10;
  private static readonly LOW_OCR_THRESHOLD = 80;
  private static readonly LOW_OCR_MAX_DEDUCT = 25;
  private static readonly DEFAULT_THRESHOLD = 80;

  constructor(private readonly config: ConfigService) {}

  /**
   * Compute a spec-compliant confidence score for the given extracted fields.
   * This is the canonical API and what every new caller should use.
   */
  score(input: ConfidenceInput): ConfidenceResult {
    const { fields, ocrConfidence } = input;
    const threshold = this.getThreshold();

    const missing: RequiredFieldKey[] = [];
    const invalid: RequiredFieldKey[] = [];

    if (this.isMissing(fields.supplier_name)) missing.push('supplierName');
    if (this.isMissing(fields.invoice_number)) missing.push('invoiceNumber');

    if (this.isMissing(fields.invoice_date)) {
      missing.push('invoiceDate');
    } else if (!this.isValidIsoDate(fields.invoice_date)) {
      invalid.push('invoiceDate');
    }

    if (this.isMissing(fields.po_number)) missing.push('poNumber');

    if (fields.total_amount === null || fields.total_amount === undefined) {
      missing.push('totalAmount');
    } else if (!this.isValidAmount(fields.total_amount)) {
      invalid.push('totalAmount');
    }

    if (this.isMissing(fields.currency)) {
      missing.push('currency');
    } else if (!this.isValidCurrency(fields.currency)) {
      invalid.push('currency');
    }

    // Coherence check: subtotal + tax should approximately equal total.
    // Only penalize when all three are present.
    if (
      typeof fields.subtotal === 'number' &&
      typeof fields.tax_amount === 'number' &&
      typeof fields.total_amount === 'number'
    ) {
      const expected = fields.subtotal + fields.tax_amount;
      const tolerance = Math.max(0.05, fields.total_amount * 0.01); // 1% or 5¢
      if (Math.abs(expected - fields.total_amount) > tolerance) {
        if (!invalid.includes('totalAmount')) invalid.push('totalAmount');
      }
    }

    const missingDeduction = missing.length * ConfidenceService.DEDUCT_MISSING;
    const invalidDeduction = invalid.length * ConfidenceService.DEDUCT_INVALID;
    const lowOcrDeduction = this.lowOcrDeduction(ocrConfidence);

    const raw = 100 - missingDeduction - invalidDeduction - lowOcrDeduction;
    const score = Math.max(0, Math.min(100, Math.round(raw)));

    const requiresReview = score < threshold;
    const reviewReason = requiresReview
      ? this.buildReviewReason(missing, invalid, lowOcrDeduction > 0)
      : null;

    this.logger.debug(
      `score=${score} (missing=${missing.length}*-15=-${missingDeduction}, ` +
        `invalid=${invalid.length}*-10=-${invalidDeduction}, lowOcr=-${lowOcrDeduction}) ` +
        `reason="${reviewReason ?? '-'}"`,
    );

    return {
      score,
      requiresReview,
      reviewReason,
      missingFields: missing,
      invalidFields: invalid,
      deductions: {
        missing: missingDeduction,
        invalid: invalidDeduction,
        lowOcr: lowOcrDeduction,
      },
    };
  }

  /**
   * Build a `reviewReason` string. Format (matches the spec examples):
   *   "Missing required fields: PO Number"
   *   "Missing required fields: Currency, PO Number"
   *   "Low OCR confidence detected"
   *   "Missing required fields: PO Number. Low OCR confidence detected."
   *   "Invalid fields: Total Amount"
   */
  buildReviewReason(
    missing: RequiredFieldKey[],
    invalid: RequiredFieldKey[],
    lowOcr: boolean,
  ): string {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`Missing required fields: ${missing.map((k) => FIELD_LABELS[k]).join(', ')}`);
    }
    if (invalid.length > 0) {
      parts.push(`Invalid fields: ${invalid.map((k) => FIELD_LABELS[k]).join(', ')}`);
    }
    if (lowOcr) {
      parts.push('Low OCR confidence detected');
    }
    return parts.length > 0 ? parts.join('. ') : 'Below confidence threshold';
  }

  // ----------------------------------------------------------------------
  // Legacy API — kept for backward compatibility with InvoiceProcessorService
  // until Phase 3 swaps it over to `score(...)`.
  // ----------------------------------------------------------------------

  /**
   * @deprecated Use `score({ fields, ocrConfidence }).score` instead.
   * This delegates to the new rule-based engine so callers receive the
   * spec-compliant value even before they migrate.
   */
  computeAggregate(extracted: ExtractedInvoice, ocrConfidence = 0): number {
    // Derive OCR confidence from the heuristic in `field_confidences` when
    // the caller doesn't pass it explicitly (the existing processor passes
    // it explicitly going forward; this is the historical fallback).
    const fallbackOcr =
      ocrConfidence > 0
        ? ocrConfidence
        : Object.values(extracted.field_confidences || {}).reduce(
            (max, v) => (v > max ? v : max),
            0,
          );
    return this.score({ fields: extracted, ocrConfidence: fallbackOcr }).score;
  }

  /**
   * @deprecated Use `score(input).requiresReview` instead.
   */
  requiresReview(confidence: number, threshold?: number): boolean {
    return confidence < (threshold ?? this.getThreshold());
  }

  // ----------------------------------------------------------------------
  // Validation helpers (exposed for unit tests)
  // ----------------------------------------------------------------------

  isMissing(value: string | number | null | undefined): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim().length === 0) return true;
    return false;
  }

  isValidIsoDate(value: string | null): boolean {
    if (!value) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    // Reject far-future dates (more than 1 year ahead).
    const oneYearOut = new Date();
    oneYearOut.setUTCFullYear(oneYearOut.getUTCFullYear() + 1);
    if (d.getTime() > oneYearOut.getTime()) return false;
    // Reject obviously bogus historical dates (before 2000-01-01).
    if (d.getUTCFullYear() < 2000) return false;
    return true;
  }

  isValidAmount(value: number | null): boolean {
    if (value === null || value === undefined) return false;
    if (!Number.isFinite(value)) return false;
    if (value < 0) return false;
    if (value > 1_000_000_000) return false; // sanity cap
    return true;
  }

  isValidCurrency(value: string | null): boolean {
    if (!value) return false;
    return /^[A-Z]{3}$/.test(value);
  }

  /** Tesseract confidence below 80 -> linear penalty up to 25 points. */
  lowOcrDeduction(ocrConfidence: number): number {
    if (!Number.isFinite(ocrConfidence)) return 0;
    if (ocrConfidence >= ConfidenceService.LOW_OCR_THRESHOLD) return 0;
    const gap = ConfidenceService.LOW_OCR_THRESHOLD - ocrConfidence;
    return Math.min(ConfidenceService.LOW_OCR_MAX_DEDUCT, Math.round(gap));
  }

  /** Read CONFIDENCE_THRESHOLD env (default 80). */
  getThreshold(): number {
    const v = this.config.get<number>('ocr.confidenceThreshold');
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100) return v;
    return ConfidenceService.DEFAULT_THRESHOLD;
  }
}
