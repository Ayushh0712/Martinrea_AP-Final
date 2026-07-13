/**
 * A single word recognized by Tesseract, with its bounding box and structural
 * indices (from TSV output). These let the extractor do layout-aware field
 * lookup (e.g. "the value to the right of the Total label") instead of relying
 * purely on flat-text regex, which fails on multi-column invoice layouts.
 */
export interface OcrToken {
  /** The recognized word text. */
  text: string;
  /** Per-word confidence, 0..100. */
  conf: number;
  /** Bounding box, pixels, relative to the page image. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Tesseract structural indices grouping words into blocks/paragraphs/lines. */
  block: number;
  par: number;
  line: number;
  /** Zero-based source page (0 for images; per-page for multi-page PDFs). */
  page: number;
}
