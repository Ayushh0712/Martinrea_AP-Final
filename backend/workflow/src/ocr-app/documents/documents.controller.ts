import {
  Controller,
  Get,
  Header,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OciService } from '../oci/oci.service';
import { TiffPreviewService } from './tiff-preview.service';

/**
 * PRD DAT-02 - document viewer hand-off.
 *
 * GET /api/documents/:id/view returns a short-lived, directly-loadable URL for
 * the original invoice document so the split-screen PDF viewer (UI-A-03) can
 * render it without proxying bytes through the API.
 *
 * When OCI is configured the URL is the PAR-signed object URL (the SAS
 * equivalent in this deployment). Otherwise it falls back to the
 * authenticated streaming endpoint.
 */
@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    @InjectModel(Invoice) private readonly invoiceModel: typeof Invoice,
    private readonly oci: OciService,
    private readonly config: ConfigService,
    private readonly tiff: TiffPreviewService,
  ) {}

  @Get(':id/view')
  @ApiOperation({ summary: 'Get a short-lived view URL for an invoice document' })
  async view(@Param('id', new ParseUUIDPipe()) id: string) {
    const invoice = await this.invoiceModel.findByPk(id, {
      attributes: ['id', 'originalFilename'],
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    const expiresInMinutes = parseInt(
      this.config.get<string>('DOCUMENT_VIEW_EXPIRY_MINUTES') ?? '15',
      10,
    );

    // Ingestion stores objects under `<prefix><originalFilename>`. Default
    // mirrors the OCR poller's OCI_AUTOINGEST_PREFIX ('AP-Accepted_Correct/').
    const prefix =
      this.config.get<string>('OCI_AUTOINGEST_PREFIX') ?? 'AP-Accepted_Correct/';
    const objectName = invoice.originalFilename
      ? `${prefix}${invoice.originalFilename}`
      : null;
    const ociUrl = objectName ? this.oci.getViewUrl(objectName) : null;

    if (ociUrl) {
      return {
        success: true,
        data: { url: ociUrl, source: 'oci', expiresInMinutes, originalFilename: invoice.originalFilename },
      };
    }

    // Fallback: stream through the API (requires the bearer token).
    return {
      success: true,
      data: {
        url: `/api/ocr/invoices/${id}/file`,
        source: 'api',
        expiresInMinutes,
        originalFilename: invoice.originalFilename,
      },
    };
  }

  /**
   * Same-origin binary fetch for the client-side TIFF renderer. Serves the
   * ORIGINAL invoice bytes untouched — either from the OCI bucket (when the
   * invoice was ingested through the OCI pipeline) or from the local upload
   * path (direct uploads). The browser can then decode the TIFF into a canvas
   * without hitting cross-origin CORS on the raw OCI PAR URL.
   */
  @Get(':id/bytes')
  @ApiOperation({ summary: 'Stream original invoice bytes (same-origin, authed)' })
  async bytes(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | Buffer> {
    const { buffer, mimeType, filename } = await this.resolveBytes(id);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    });
    return buffer;
  }

  /**
   * Server-rendered PNG page for browser review of TIFFs (browsers can't
   * render TIFF in an <img>). `page` is 0-indexed; the response includes
   * X-Page-Count so the viewer can build multi-page nav. The stored TIFF
   * is never modified.
   */
  @Get(':id/preview')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Server-rendered PNG page for TIFF preview' })
  async preview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 0,
    // Non-passthrough @Res(): write the raw PNG bytes to the socket ourselves.
    // With passthrough:true Nest JSON-encodes the returned Buffer even when
    // Content-Type is image/png (yields `{"type":"Buffer","data":[...]}`).
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`preview invoice=${id} page=${page}`);
    try {
      const { buffer, filename } = await this.resolveBytes(id);
      const total = await this.tiff.pageCount(buffer);
      const safePage = Math.min(Math.max(page, 0), Math.max(total - 1, 0));
      const png = await this.tiff.renderPng(buffer, safePage);
      res.set({
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
        'X-Page-Count': String(total),
      });
      this.logger.log(
        `preview ok invoice=${id} file=${filename} page=${safePage}/${total} bytes=${png.length}`,
      );
      res.end(png);
    } catch (err) {
      // NotFoundException from resolveBytes should propagate as-is; sharp/OCI
      // errors bubble up as a 500 with the message surfaced in the log.
      if (err instanceof NotFoundException) throw err;
      const msg = (err as Error).message;
      this.logger.error(`preview failed invoice=${id} page=${page}: ${msg}`);
      throw new InternalServerErrorException(`TIFF preview failed: ${msg}`);
    }
  }

  /**
   * Resolve the raw bytes for an invoice: OCI first (matches the /view logic),
   * with a local-file fallback for direct uploads whose filePath is set.
   */
  private async resolveBytes(id: string): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }> {
    const invoice = await this.invoiceModel.findByPk(id, {
      attributes: ['id', 'originalFilename', 'filePath', 'mimeType'],
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    const filename = invoice.originalFilename ?? `invoice-${id}`;
    const mimeType = invoice.mimeType ?? 'application/octet-stream';

    const prefix =
      this.config.get<string>('OCI_AUTOINGEST_PREFIX') ?? 'AP-Accepted_Correct/';
    const objectName = invoice.originalFilename
      ? `${prefix}${invoice.originalFilename}`
      : null;
    if (objectName && this.oci.getViewUrl(objectName)) {
      try {
        const buffer = await this.oci.downloadBuffer(objectName);
        return { buffer, mimeType, filename };
      } catch {
        // OCI fetch failed — fall through to the local upload path (if any).
      }
    }

    if (invoice.filePath) {
      try {
        const buffer = await fs.readFile(invoice.filePath);
        return { buffer, mimeType, filename };
      } catch {
        throw new NotFoundException(`File for invoice ${id} no longer exists`);
      }
    }

    throw new NotFoundException(`No bytes available for invoice ${id}`);
  }
}
