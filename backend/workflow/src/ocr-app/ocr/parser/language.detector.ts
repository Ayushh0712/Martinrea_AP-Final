import { Injectable, Logger } from '@nestjs/common';
import type { ParsedLanguage } from './parsed-invoice.interface';

interface LanguageScore {
  english: number;
  spanish: number;
}

/**
 * Detects whether the OCR text is in English or Spanish using a lightweight
 * keyword + diacritic scoring heuristic. Designed for short invoice-like
 * documents (a few hundred to a few thousand characters) where a full
 * language-model library would be overkill.
 *
 * The detector never returns `null` — when the score is inconclusive it
 * falls back to `ENGLISH`. Feature 7 only requires these two languages.
 */
@Injectable()
export class LanguageDetector {
  private readonly logger = new Logger(LanguageDetector.name);

  /** Words that strongly indicate Spanish invoice content. */
  private static readonly SPANISH_KEYWORDS = new Set([
    'factura',
    'fecha',
    'folio',
    'cliente',
    'proveedor',
    'emisor',
    'receptor',
    'subtotal',
    'importe',
    'iva',
    'rfc',
    'cfdi',
    'cantidad',
    'precio',
    'unitario',
    'descripcion',
    'descripción',
    'pago',
    'moneda',
    'pesos',
    'mxn',
    'total',
    'orden',
    'compra',
  ]);

  /** Words that strongly indicate English invoice content. */
  private static readonly ENGLISH_KEYWORDS = new Set([
    'invoice',
    'date',
    'bill',
    'billing',
    'customer',
    'supplier',
    'vendor',
    'subtotal',
    'tax',
    'vat',
    'amount',
    'quantity',
    'price',
    'unit',
    'description',
    'payment',
    'due',
    'total',
    'order',
    'purchase',
    'usd',
    'cad',
  ]);

  /** Spanish-specific diacritics that almost never appear in English. */
  private static readonly SPANISH_DIACRITICS = /[áéíóúñü¿¡]/gi;

  /**
   * Spanish stopwords (small set, but together they're a strong signal).
   * Whole-word match only — we don't want `la` to match inside `latte`.
   */
  private static readonly SPANISH_STOPWORDS = /\b(el|la|los|las|de|del|y|para|con|por|que|un|una|en|al)\b/gi;

  /** English stopwords for symmetry. */
  private static readonly ENGLISH_STOPWORDS = /\b(the|and|of|to|for|with|by|at|on|in|from|is|are)\b/gi;

  /**
   * Detect the language of the given text.
   *
   * Empty or near-empty input returns `ENGLISH` (the safe default).
   */
  detect(text: string): ParsedLanguage {
    if (!text || text.trim().length < 8) return 'ENGLISH';

    const score = this.computeScore(text);
    const winner: ParsedLanguage = score.spanish > score.english ? 'SPANISH' : 'ENGLISH';

    this.logger.debug(
      `Language detection -> ${winner} (english=${score.english}, spanish=${score.spanish})`,
    );
    return winner;
  }

  /**
   * Exposed for unit testing. Returns the raw weighted score for each
   * language so tests can assert on the relative magnitudes.
   */
  computeScore(text: string): LanguageScore {
    const lower = text.toLowerCase();

    // Whole-word keyword counts.
    const tokens = lower.match(/[a-záéíóúñü]+/gi) ?? [];
    let englishKeywords = 0;
    let spanishKeywords = 0;
    for (const tok of tokens) {
      if (LanguageDetector.ENGLISH_KEYWORDS.has(tok)) englishKeywords += 1;
      if (LanguageDetector.SPANISH_KEYWORDS.has(tok)) spanishKeywords += 1;
    }

    // Stopword counts.
    const englishStops = (lower.match(LanguageDetector.ENGLISH_STOPWORDS) ?? []).length;
    const spanishStops = (lower.match(LanguageDetector.SPANISH_STOPWORDS) ?? []).length;

    // Diacritic weight — ñ, á, é etc. are very strong Spanish indicators.
    const diacritics = (text.match(LanguageDetector.SPANISH_DIACRITICS) ?? []).length;

    // Composite score. Keyword hits weight more than stopwords because they
    // are domain-specific (invoice vocabulary). Diacritics get a 3x boost
    // because seeing even one ñ in a Western text is a strong signal.
    return {
      english: englishKeywords * 3 + englishStops,
      spanish: spanishKeywords * 3 + spanishStops + diacritics * 3,
    };
  }
}
