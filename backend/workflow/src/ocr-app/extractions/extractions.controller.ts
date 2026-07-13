import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TiffPreviewService } from '../documents/tiff-preview.service';
import { SendForMatchingDto } from '../invoices/dto/send-for-matching.dto';
import { InvoicesService } from '../invoices/invoices.service';
import { OciAutoIngestService } from '../oci/oci-autoingest.service';
import { OciService } from '../oci/oci.service';
import { ExtractionStoreService } from './extraction-store.service';

/**
 * Read + trigger surface for the in-memory OCR extractions produced by the OCI
 * auto-ingest poller. No DB is involved: results are held transiently and shown
 * to the user for review. Persistence is deferred to a later phase.
 */
@ApiTags('OCR Extractions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ocr/extractions')
export class ExtractionsController {
  private readonly logger = new Logger(ExtractionsController.name);

  constructor(
    private readonly store: ExtractionStoreService,
    private readonly autoIngest: OciAutoIngestService,
    private readonly invoices: InvoicesService,
    private readonly oci: OciService,
    private readonly tiff: TiffPreviewService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all in-memory OCR extractions (most recent first)' })
  list() {
    const items = this.store.list();
    return { success: true, count: items.length, items };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single in-memory OCR extraction by id' })
  get(@Param('id') id: string) {
    const extraction = this.store.get(id);
    if (!extraction) {
      throw new NotFoundException(`Extraction ${id} not found`);
    }
    return { success: true, extraction };
  }

  @Post('scan')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Scan the OCI source folder now and OCR-extract any new documents into memory',
  })
  async scan() {
    const result = await this.autoIngest.runScan();
    return { success: true, ...result };
  }

  @Post(':id/send-for-matching')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Persist an edited OCR extraction as a PENDING_MATCH invoice and send it to the 2-way match workbench',
  })
  async sendForMatching(@Param('id') id: string, @Body() body: SendForMatchingDto) {
    // Capture the document identity BEFORE persisting: success removes the
    // extraction from the store.
    const extraction = this.store.get(id);
    const invoice = await this.invoices.commitExtractionForMatching(id, body);
    await this.writeProcessedMarker(extraction, invoice, 'sent-for-matching');
    return { success: true, invoice };
  }

  @Post(':id/reject')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Persist an OCR extraction as an EXCEPTION invoice and send it to the exception queue',
  })
  async reject(@Param('id') id: string, @Body() body: SendForMatchingDto) {
    const extraction = this.store.get(id);
    const invoice = await this.invoices.rejectExtractionToException(id, body);
    await this.writeProcessedMarker(extraction, invoice, 'rejected');
    return { success: true, invoice };
  }

  /**
   * Durable "already processed" marker so the OCI poller never resurrects this
   * document in the OCR queue — not even after a database reset. Best-effort:
   * markProcessed swallows upload failures (the invoice row still excludes the
   * document, and the next poller scan self-heals the marker).
   */
  private async writeProcessedMarker(
    extraction: { originalFilename: string; sourceObjectName: string } | undefined,
    invoice: { id?: string; status?: string } | null,
    action: string,
  ): Promise<void> {
    if (!extraction) return;
    await this.autoIngest.markProcessed(extraction.originalFilename, {
      sourceObjectName: extraction.sourceObjectName,
      invoiceId: invoice?.id ?? null,
      status: invoice?.status ?? null,
      reason: action,
    });
  }

  @Delete()
  @Roles(Role.AP_CLERK)
  @ApiOperation({ summary: 'Clear all in-memory OCR extractions' })
  clear() {
    const cleared = this.store.clear();
    return { success: true, cleared };
  }

  /**
   * Same-origin binary fetch of the ORIGINAL document bytes for this
   * in-memory extraction (used by the client-side TIFF renderer). The bytes
   * are streamed from the OCI bucket unmodified — no server-side conversion.
   */
  @Get(':id/bytes')
  @ApiOperation({ summary: 'Stream original extraction bytes (same-origin, authed)' })
  async bytes(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Buffer> {
    const extraction = this.store.get(id);
    if (!extraction) {
      throw new NotFoundException(`Extraction ${id} not found`);
    }
    const buffer = await this.oci.downloadBuffer(extraction.sourceObjectName);
    res.set({
      'Content-Type': extraction.mimeType || 'application/octet-stream',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `inline; filename="${encodeURIComponent(extraction.originalFilename)}"`,
      'Cache-Control': 'no-store',
    });
    return buffer;
  }

  /**
   * Server-rendered PNG page for browser review of TIFFs (the primary display
   * path — browsers can't render TIFF in an <img>). The stored original TIFF
   * is untouched: sharp reads it once and returns a lossless PNG for display
   * only. X-Page-Count enables multi-page nav.
   */
  @Get(':id/preview')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Server-rendered PNG page for extraction TIFF preview' })
  async preview(
    @Param('id') id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 0,
    // Non-passthrough @Res(): we write the raw PNG bytes to the socket
    // ourselves. With passthrough:true Nest re-serialises whatever we return,
    // which JSON-encodes the Buffer as `{"type":"Buffer","data":[...]}` even
    // when Content-Type is set to image/png.
    @Res() res: Response,
  ): Promise<void> {
    const extraction = this.store.get(id);
    if (!extraction) {
      throw new NotFoundException(`Extraction ${id} not found`);
    }
    this.logger.log(
      `preview extraction=${id} object=${extraction.sourceObjectName} page=${page}`,
    );
    try {
      const buffer = await this.oci.downloadBuffer(extraction.sourceObjectName);
      const total = await this.tiff.pageCount(buffer);
      const safePage = Math.min(Math.max(page, 0), Math.max(total - 1, 0));
      const png = await this.tiff.renderPng(buffer, safePage);
      res.set({
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
        'X-Page-Count': String(total),
      });
      this.logger.log(
        `preview ok extraction=${id} page=${safePage}/${total} bytes=${png.length}`,
      );
      res.end(png);
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(
        `preview failed extraction=${id} object=${extraction.sourceObjectName} page=${page}: ${msg}`,
      );
      throw new InternalServerErrorException(`TIFF preview failed: ${msg}`);
    }
  }
}
