import { Injectable, Logger } from '@nestjs/common';
import { DocumentType } from '../../../common/enums/document-type.enum';

export interface DocumentTypeResult {
  documentType: DocumentType;
  /** Score recorded for the winning type (for diagnostics). */
  score: number;
  /** All non-zero scores keyed by document type. */
  scores: Record<DocumentType, number>;
}

interface KeywordWeight {
  pattern: RegExp;
  weight: number;
}

/**
 * Classifies the document into one of the `DocumentType` enum values.
 *
 * Algorithm (Feature 5):
 *   1. Accumulate weighted keyword hits for each of:
 *        INVOICE / RECEIPT / PURCHASE_ORDER
 *      The highest-scoring type wins.
 *   2. If no signal at all is found, default to `INVOICE` (the most likely
 *      class for documents arriving at this system).
 *
 * Weights were chosen so that a single strong keyword (e.g. "Purchase Order")
 * outweighs two weak keywords (e.g. "order", "total") from a different type.
 */
@Injectable()
export class DocumentTypeDetector {
  private readonly logger = new Logger(DocumentTypeDetector.name);

  private static readonly INVOICE_KEYWORDS: KeywordWeight[] = [
    { pattern: /\binvoice\b/i, weight: 4 },
    { pattern: /\bfactura\b/i, weight: 4 },
    { pattern: /\binvoice\s*(no\.?|number|#)/i, weight: 5 },
    { pattern: /\btax\s*invoice\b/i, weight: 5 },
    { pattern: /\bbill\s*to\b/i, weight: 3 },
    { pattern: /\bamount\s*due\b/i, weight: 2 },
    { pattern: /\bdate\s*of\s*invoice\b/i, weight: 4 },
  ];

  private static readonly RECEIPT_KEYWORDS: KeywordWeight[] = [
    { pattern: /\breceipt\b/i, weight: 6 },
    { pattern: /\brecibo\b/i, weight: 6 },
    { pattern: /\bcash\s*receipt\b/i, weight: 7 },
    { pattern: /\bsales\s*receipt\b/i, weight: 7 },
    { pattern: /\bthank\s*you\s*(for\s*your)?\s*(purchase|business)?/i, weight: 3 },
    { pattern: /\bchange\s*due\b/i, weight: 3 },
    { pattern: /\bcash\s*tendered\b/i, weight: 4 },
  ];

  private static readonly PURCHASE_ORDER_KEYWORDS: KeywordWeight[] = [
    { pattern: /\bpurchase\s*order\b/i, weight: 8 },
    { pattern: /\borden\s*de\s*compra\b/i, weight: 8 },
    { pattern: /\bp\.?o\.?\s*(no\.?|number|#)/i, weight: 6 },
    { pattern: /\border\s*confirmation\b/i, weight: 5 },
    { pattern: /\bship\s*to\b/i, weight: 2 },
    { pattern: /\bdelivery\s*date\b/i, weight: 2 },
    { pattern: /\bvendor\b/i, weight: 1 },
  ];

  detect(text: string): DocumentTypeResult {
    const empty: DocumentTypeResult = {
      documentType: DocumentType.INVOICE,
      score: 0,
      scores: {
        [DocumentType.INVOICE]: 0,
        [DocumentType.RECEIPT]: 0,
        [DocumentType.PURCHASE_ORDER]: 0,
      },
    };
    if (!text || text.trim().length === 0) return empty;

    const scores: Record<DocumentType, number> = {
      [DocumentType.INVOICE]: this.scoreKeywords(text, DocumentTypeDetector.INVOICE_KEYWORDS),
      [DocumentType.RECEIPT]: this.scoreKeywords(text, DocumentTypeDetector.RECEIPT_KEYWORDS),
      [DocumentType.PURCHASE_ORDER]: this.scoreKeywords(
        text,
        DocumentTypeDetector.PURCHASE_ORDER_KEYWORDS,
      ),
    };

    // Pick the highest-scoring type. Tie-break order: INVOICE > PO > RECEIPT
    // because in our domain ambiguous documents are most often invoices.
    const order: DocumentType[] = [
      DocumentType.INVOICE,
      DocumentType.PURCHASE_ORDER,
      DocumentType.RECEIPT,
    ];
    let winner: DocumentType = DocumentType.INVOICE;
    let max = 0;
    for (const dt of order) {
      if (scores[dt] > max) {
        winner = dt;
        max = scores[dt];
      }
    }

    this.logger.debug(
      `DocumentType -> ${winner} (invoice=${scores.INVOICE}, po=${scores.PURCHASE_ORDER}, receipt=${scores.RECEIPT})`,
    );

    return { documentType: winner, score: max, scores };
  }

  private scoreKeywords(text: string, keywords: KeywordWeight[]): number {
    let total = 0;
    for (const { pattern, weight } of keywords) {
      if (pattern.test(text)) total += weight;
    }
    return total;
  }
}
