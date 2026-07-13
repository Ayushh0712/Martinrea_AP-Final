import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Server-side TIFF -> PNG rasterisation for the document viewer. This is a
 * *display-only* fallback used when the browser's client-side TIFF decoder
 * (utif) can't handle a specific TIFF variant (e.g. CCITT Group 3/4 fax,
 * JPEG-in-TIFF, tiled or 16-bit/CMYK). The stored original TIFF is never
 * modified — sharp reads it once, renders one page, and returns the PNG.
 *
 * Requires libvips with TIFF support, which the workflow Dockerfile already
 * installs via `apk add vips`.
 */
@Injectable()
export class TiffPreviewService {
  private readonly logger = new Logger(TiffPreviewService.name);

  /**
   * Number of pages/directories inside a (possibly multi-page) TIFF. Returns 1
   * for any format sharp can't page-count so single-page fallback still works.
   */
  async pageCount(buf: Buffer): Promise<number> {
    try {
      const meta = await sharp(buf).metadata();
      return meta.pages && meta.pages > 0 ? meta.pages : 1;
    } catch (err) {
      this.logger.warn(
        `pageCount failed: ${(err as Error).message} — assuming single page`,
      );
      return 1;
    }
  }

  /**
   * Render a specific TIFF page to a lossless PNG buffer. `page` is 0-indexed
   * (matches libvips/sharp's `page` option). Callers clamp against pageCount
   * so we don't have to.
   */
  async renderPng(buf: Buffer, page: number): Promise<Buffer> {
    return sharp(buf, { page }).png().toBuffer();
  }
}
