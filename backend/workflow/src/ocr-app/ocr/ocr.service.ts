import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { recognize as tesseractRecognize } from 'node-tesseract-ocr';
import sharp from 'sharp';
import { OcrToken } from './interfaces/ocr-token.interface';

export interface OcrResult {
  text: string;
  confidence: number; // 0..100
  /**
   * Per-word bounding boxes from the OCR pass, enabling layout-aware field
   * extraction. Absent for the digital-PDF text-layer fast path (no raster
   * positions exist there), in which case the parser falls back to regex.
   */
  tokens?: OcrToken[];
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly language: string;
  private readonly tessdataDir?: string;
  private readonly binaryPath: string;
  private readonly maxConcurrency: number;

  /** In-flight tesseract process count, gated by `maxConcurrency`. */
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  /**
   * Serializes pdf-parse calls. The bundled pdf.js inside pdf-parse keeps
   * module-level mutable state that gets corrupted ("bad XRef entry") when
   * two OCR jobs invoke it concurrently. We run them one at a time.
   */
  private static pdfParseLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {
    this.language = this.config.get<string>('ocr.language') ?? 'eng';
    this.tessdataDir = this.config.get<string>('ocr.tessdataDir') || undefined;
    this.binaryPath = this.config.get<string>('ocr.binaryPath') ?? '';
    const configured = this.config.get<number>('ocr.maxConcurrency');
    this.maxConcurrency =
      typeof configured === 'number' && configured > 0 ? configured : 2;
  }

  // --------------------------------------------------------------------------
  // Concurrency guard — each recognize() spawns OS processes, so we cap how
  // many run at once to avoid exhausting the host on bursty queue/scan drains.
  // --------------------------------------------------------------------------
  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  /**
   * Runs the native Tesseract binary (via the node-tesseract-ocr CLI wrapper)
   * on a single raster image and returns both the recognized text and an
   * averaged 0..100 confidence.
   *
   * We request TSV output (`presets: ['tsv']`) so a single OCR pass yields the
   * per-word `conf` column needed to compute a real document confidence — the
   * CLI's default text mode returns no confidence at all. Errors surface as a
   * rejected promise from the spawned process (no in-process worker to crash),
   * so callers can mark the invoice FAILED without taking down the service.
   */
  private async runNativeTesseract(imagePath: string, page = 0): Promise<OcrResult> {
    await this.acquire();
    const processed = await this.preprocess(imagePath);
    try {
      const config: Record<string, unknown> = {
        lang: this.language,
        oem: 1,
        psm: 3,
        presets: ['tsv'],
      };
      // Point the engine at the high-accuracy tessdata_best models when configured;
      // otherwise Tesseract falls back to its compiled-in default location.
      if (this.tessdataDir) config['tessdata-dir'] = this.tessdataDir;
      if (this.binaryPath) config.binary = this.binaryPath;

      const tsv = await tesseractRecognize(processed, config);
      return this.parseTsv(tsv, page);
    } finally {
      this.release();
      if (processed !== imagePath) {
        await fs.rm(processed, { force: true }).catch(() => undefined);
      }
    }
  }

  /**
   * Image clean-up before OCR. This is the single biggest accuracy lever for
   * scanned/photographed documents: greyscale + contrast-normalise removes
   * colour/lighting noise, upscaling gives Tesseract more pixels per glyph, and
   * thresholding flattens the background to pure white. Returns a temp file path
   * (caller deletes it); on any failure we fall back to the original image so a
   * preprocessing hiccup never blocks OCR.
   */
  private async preprocess(imagePath: string): Promise<string> {
    const outPath = `${imagePath}.pre.png`;
    try {
      const meta = await sharp(imagePath).metadata();
      let pipeline = sharp(imagePath).grayscale().normalize();

      // Upscale narrow images toward a ~300 DPI-equivalent width so small text
      // is legible; never downscale (that would destroy detail).
      const targetWidth = 2000;
      if (meta.width && meta.width < targetWidth) {
        pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: false });
      }

      // Binarise: after contrast-normalisation a global threshold cleanly
      // separates ink from background without eating thin strokes.
      pipeline = pipeline.threshold(150);

      await pipeline.png().toFile(outPath);
      return outPath;
    } catch (err) {
      this.logger.warn(
        `Preprocess failed for ${path.basename(imagePath)}, using original: ${(err as Error).message}`,
      );
      return imagePath;
    }
  }

  /**
   * Parses Tesseract TSV output into reconstructed text + averaged confidence.
   * TSV columns: level, page, block, par, line, word, left, top, width,
   * height, conf, text. Only word-level rows (level 5) carry a real `conf`
   * (non-text rows report -1); words are regrouped into lines by their
   * block/paragraph/line indices so the downstream regex parser still sees a
   * line-structured document.
   */
  private parseTsv(tsv: string, page = 0): OcrResult {
    const rows = (tsv ?? '').split(/\r?\n/);
    const confidences: number[] = [];
    const lineWords = new Map<string, string[]>();
    const lineOrder: string[] = [];
    const tokens: OcrToken[] = [];

    // Skip the header row (index 0).
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i].split('\t');
      if (cols.length < 12) continue;
      if (cols[0] !== '5') continue; // word-level rows only

      const conf = Number.parseFloat(cols[10]);
      if (Number.isFinite(conf) && conf >= 0) confidences.push(conf);

      const word = cols[11];
      if (word && word.trim().length > 0) {
        const block = Number.parseInt(cols[2], 10);
        const par = Number.parseInt(cols[3], 10);
        const line = Number.parseInt(cols[4], 10);
        const key = `${block}.${par}.${line}`;
        if (!lineWords.has(key)) {
          lineWords.set(key, []);
          lineOrder.push(key);
        }
        lineWords.get(key)!.push(word);

        tokens.push({
          text: word,
          conf: Number.isFinite(conf) ? conf : 0,
          left: Number.parseInt(cols[6], 10) || 0,
          top: Number.parseInt(cols[7], 10) || 0,
          width: Number.parseInt(cols[8], 10) || 0,
          height: Number.parseInt(cols[9], 10) || 0,
          block,
          par,
          line,
          page,
        });
      }
    }

    const text = lineOrder
      .map((key) => lineWords.get(key)!.join(' '))
      .join('\n')
      .trim();
    const confidence = confidences.length
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 0;

    return { text, confidence, tokens };
  }

  /**
   * Cheap first-line defence against garbage uploads: reject files that are
   * too small or lack a valid image magic-number before they ever reach
   * Tesseract. Anything that passes this check but still fails to decode is
   * caught as a rejected promise from the spawned tesseract process.
   */
  private async assertReadableImage(filePath: string): Promise<void> {
    const buf = await fs.readFile(filePath);
    if (buf.length < 100) {
      throw new Error(
        `Image too small to be a valid document (${buf.length} bytes): ${path.basename(filePath)}`,
      );
    }
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng =
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isTiffLE =
      buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00;
    const isTiffBE =
      buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a;
    if (!(isJpg || isPng || isTiffLE || isTiffBE)) {
      throw new Error(
        `Unrecognized or corrupt image header: ${path.basename(filePath)}`,
      );
    }
  }

  /**
   * Performs OCR on a file located at `filePath`.
   * - PDFs: try position-aware text-layer extraction first (yields OcrTokens so
   *   the layout-aware field extractor works); if the PDF has no usable text
   *   layer, OCR every page after rasterizing.
   * - Images: direct Tesseract recognize.
   */
  async recognize(filePath: string): Promise<OcrResult> {
    if (!(await this.fileExists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
      const positioned = await this.extractPdfTokens(filePath);
      if (positioned && positioned.text.trim().length > 50) {
        // PDF had a real text layer -> very high confidence, with positions.
        return positioned;
      }

      // pdf.js path failed or produced nothing useful: try the legacy blob
      // extractor before falling back to raster OCR (belt and braces — some
      // quirky PDFs parse under pdf-parse's bundled build but not pdfjs-dist).
      const pdfText = await this.extractPdfText(filePath);
      if (pdfText && pdfText.trim().length > 50) {
        return { text: pdfText, confidence: 99 };
      }

      // Otherwise rasterize and OCR.
      return this.recognizePdfWithOcr(filePath);
    }

    return this.recognizeImage(filePath);
  }

  /**
   * Position-aware text-layer extraction for digital PDFs.
   *
   * Reads every page's text items via pdf.js `getTextContent()`, keeping each
   * item's x/y/width/height, and converts them into the same `OcrToken` shape
   * the Tesseract TSV path produces. This is what makes the layout-aware field
   * extractor (line-item columns, labeled totals, etc.) work on digital PDFs —
   * the old pdf-parse blob put every table cell on its own line and carried no
   * positions, so line items and most labeled fields never extracted.
   *
   * Geometry notes:
   *   - pdf.js y-coordinates grow UP the page; OcrTokens expect top-down, so
   *     `top = pageHeight - baselineY - itemHeight`.
   *   - Each page's tops are offset by the cumulative height of the pages
   *     before it, so multi-page documents keep a single monotonic y axis
   *     (the extractor compares tops across the whole document).
   *   - Items are clustered into visual lines by y, then multi-word items are
   *     split into word tokens with x-offsets estimated proportionally from
   *     the item's width (exact per-word metrics aren't needed — the extractor
   *     only relies on ordering and rough column centres).
   *
   * Returns null when pdf.js cannot parse the file or the text layer is empty
   * (scanned PDF) so the caller can fall through to raster OCR.
   */
  private async extractPdfTokens(filePath: string): Promise<OcrResult | null> {
    interface PdfJsTextItem {
      str: string;
      transform: number[];
      width: number;
      height: number;
    }
    interface PdfJsDocument {
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { height: number };
        getTextContent: () => Promise<{ items: PdfJsTextItem[] }>;
      }>;
      destroy: () => Promise<void>;
    }

    let doc: PdfJsDocument | null = null;

    try {
      // Legacy CJS build — the modern one is ESM-only and breaks Nest's CJS output.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as {
        getDocument: (o: unknown) => { promise: Promise<PdfJsDocument> };
      };
      const data = new Uint8Array(await fs.readFile(filePath));
      // standardFontDataUrl silences "failed to fetch standard font" warnings
      // (fonts only matter for rendering; text extraction works either way).
      const standardFontDataUrl = path.join(
        path.dirname(require.resolve('pdfjs-dist/package.json')),
        'standard_fonts/',
      );
      doc = await pdfjs.getDocument({ data, useSystemFonts: true, standardFontDataUrl })
        .promise;

      const tokens: OcrToken[] = [];
      let pageTopOffset = 0;

      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const pageHeight = page.getViewport({ scale: 1 }).height;
        const content = await page.getTextContent();

        // Positioned items for this page, in y-down coordinates.
        const items = content.items
          .filter((it) => it.str && it.str.trim().length > 0)
          .map((it) => {
            const height = it.height || Math.abs(it.transform[3]) || 10;
            return {
              str: it.str,
              left: it.transform[4],
              top: pageHeight - it.transform[5] - height,
              width: it.width || 0,
              height,
            };
          })
          .sort((a, b) => a.top - b.top || a.left - b.left);

        // Cluster items into visual lines by vertical overlap of their centres.
        type PositionedItem = (typeof items)[number];
        const visualLines: PositionedItem[][] = [];
        let lineY = Number.NEGATIVE_INFINITY;
        for (const item of items) {
          const centerY = item.top + item.height / 2;
          if (
            !visualLines.length ||
            Math.abs(centerY - lineY) > Math.max(item.height * 0.6, 2)
          ) {
            visualLines.push([]);
            lineY = centerY;
          } else {
            // Running average keeps the cluster stable across slight jitter.
            lineY = (lineY + centerY) / 2;
          }
          visualLines[visualLines.length - 1].push(item);
        }

        for (let lineIdx = 0; lineIdx < visualLines.length; lineIdx++) {
          // Merge fragmented text runs: PDF generators often split ONE visual
          // word into several items mid-run ("INV-2026-" + "0001-A7XK"), which
          // would otherwise surface as separate tokens and truncate extracted
          // codes. Glue items whose x-gap is well below a word space (~0.35
          // of the previous item's average char width). A real inter-word
          // space is >= ~0.5 char widths, so genuine words never merge.
          const sorted = visualLines[lineIdx].slice().sort((a, b) => a.left - b.left);
          const merged: PositionedItem[] = [];
          for (const item of sorted) {
            const prev = merged[merged.length - 1];
            if (prev && !/\s$/.test(prev.str) && !/^\s/.test(item.str)) {
              const prevCharW = prev.str.length ? prev.width / prev.str.length : 0;
              const gap = item.left - (prev.left + prev.width);
              const glue = prevCharW > 0 ? prevCharW * 0.35 : 1;
              if (gap <= glue) {
                prev.str += item.str;
                prev.width = item.left + item.width - prev.left;
                prev.height = Math.max(prev.height, item.height);
                continue;
              }
            }
            merged.push({ ...item });
          }

          // Split multi-word items into word tokens, spreading x proportionally.
          for (const item of merged) {
            const charW = item.str.length > 0 ? item.width / item.str.length : 0;
            const wordRe = /\S+/g;
            let m: RegExpExecArray | null;
            while ((m = wordRe.exec(item.str)) !== null) {
              tokens.push({
                text: m[0],
                conf: 99,
                left: Math.round(item.left + m.index * charW),
                top: Math.round(pageTopOffset + item.top),
                width: Math.max(1, Math.round(m[0].length * charW)),
                height: Math.round(item.height),
                block: pageNum,
                par: 0,
                line: lineIdx,
                page: pageNum - 1,
              });
            }
          }
        }

        pageTopOffset += pageHeight;
      }

      if (!tokens.length) return null;

      // Reconstruct line-grouped text (same shape as the Tesseract TSV path)
      // so the flat-regex fallback also sees whole visual lines.
      const lineMap = new Map<string, OcrToken[]>();
      const order: string[] = [];
      for (const t of tokens) {
        const key = `${t.page}.${t.block}.${t.par}.${t.line}`;
        if (!lineMap.has(key)) {
          lineMap.set(key, []);
          order.push(key);
        }
        lineMap.get(key)!.push(t);
      }
      const text = order
        .map((key) =>
          lineMap
            .get(key)!
            .slice()
            .sort((a, b) => a.left - b.left)
            .map((t) => t.text)
            .join(' '),
        )
        .join('\n')
        .trim();

      if (!text) return null;
      return { text, confidence: 99, tokens };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'MODULE_NOT_FOUND') {
        // Loud on purpose: without pdfjs-dist the pipeline silently degrades
        // to the blob-text fallback and field extraction quality collapses.
        this.logger.error(
          'pdfjs-dist is NOT installed — PDF extraction is running in DEGRADED ' +
            'fallback mode (no layout tokens, fields will truncate/miss). ' +
            `Run "npm install" in backend/workflow and restart. (${e.message})`,
        );
      } else {
        this.logger.warn(
          `pdf.js text-layer extraction failed for ${path.basename(filePath)}: ${e.message}`,
        );
      }
      return null;
    } finally {
      if (doc) await doc.destroy().catch(() => undefined);
    }
  }

  private async recognizeImage(filePath: string): Promise<OcrResult> {
    await this.assertReadableImage(filePath);
    const { text, confidence, tokens } = await this.runNativeTesseract(filePath);
    if (!text) throw new Error('OCR returned an empty result');
    return { text, confidence, tokens };
  }

  private async extractPdfText(filePath: string): Promise<string> {
    const run = async (): Promise<string> => {
      let buf: Buffer;
      try {
        buf = await fs.readFile(filePath);
      } catch (err) {
        this.logger.warn(`Could not read PDF ${filePath}: ${(err as Error).message}`);
        return '';
      }

      // pdf.js often fails the first 1-2 parses of a PDF with a quirky xref
      // (errors vary: "bad XRef entry", "Invalid number", "Illegal character")
      // before a fresh buffer copy parses cleanly. A few attempts gives headroom.
      const maxAttempts = 5;
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // Lazy import — pdf-parse pulls heavy deps.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
          // pdf.js detaches the underlying ArrayBuffer on parse, so each attempt
          // must get an independent copy — otherwise retries see neutered data
          // and fail deterministically with "bad XRef entry".
          const parsed = await pdfParse(Buffer.from(buf));
          return parsed.text ?? '';
        } catch (err) {
          lastError = err as Error;
          this.logger.warn(
            `pdf-parse attempt ${attempt}/${maxAttempts} failed for ${filePath}: ${lastError.message}`,
          );
          // Brief backoff lets any transient pdf.js state settle before retrying.
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        }
      }
      this.logger.warn(
        `pdf-parse exhausted ${maxAttempts} attempts for ${filePath}: ${lastError?.message}`,
      );
      return '';
    };

    // Chain onto the lock so only one pdf-parse executes at a time, regardless
    // of how many OCR jobs run concurrently. Keep the lock always-resolved so a
    // single failure never wedges the chain.
    const result = OcrService.pdfParseLock.then(run, run);
    OcrService.pdfParseLock = result.catch(() => undefined);
    return result;
  }

  private async recognizePdfWithOcr(filePath: string): Promise<OcrResult> {
    let pdf2pic: typeof import('pdf2pic') | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pdf2pic = require('pdf2pic');
    } catch {
      pdf2pic = null;
    }

    if (!pdf2pic) {
      this.logger.warn(
        'pdf2pic not available — cannot OCR scanned PDFs without a text layer. ' +
          'Install Poppler/GraphicsMagick or upload images instead.',
      );
      throw new Error('Scanned PDF OCR not available in this environment');
    }

    const tmpDir = await fs.mkdtemp(path.join(path.dirname(filePath), 'pdf-ocr-'));
    try {
      const converter = pdf2pic.fromPath(filePath, {
        density: 300,
        savePath: tmpDir,
        saveFilename: 'page',
        format: 'png',
        width: 2480,
        height: 3508,
      });
      const pages = await converter.bulk(-1, { responseType: 'image' });

      let combinedText = '';
      let confidenceSum = 0;
      let pageCount = 0;
      const allTokens: OcrToken[] = [];

      for (const page of pages) {
        if (!page.path) continue;
        const { text, confidence, tokens } = await this.runNativeTesseract(
          page.path,
          pageCount,
        );
        combinedText += `${text}\n`;
        confidenceSum += confidence;
        if (tokens) allTokens.push(...tokens);
        pageCount += 1;
      }

      if (!combinedText.trim()) throw new Error('OCR returned an empty result for PDF');

      return {
        text: combinedText.trim(),
        confidence: pageCount ? confidenceSum / pageCount : 0,
        tokens: allTokens,
      };
    } finally {
      await this.cleanupDir(tmpDir);
    }
  }

  private async cleanupDir(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(`Failed to clean tmp dir ${dir}: ${(err as Error).message}`);
    }
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}
