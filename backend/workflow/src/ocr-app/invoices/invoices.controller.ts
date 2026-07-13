import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommitInvoiceDto } from './dto/commit-invoice.dto';
import { InvoiceQueryDto } from './dto/invoice-query.dto';
import { UpdateOcrInvoiceDto } from './dto/update-ocr-invoice.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('OCR Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ocr/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post('upload')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload an invoice (PDF/JPG/PNG/TIF, max 10MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  async upload(@UploadedFile() file: Express.Multer.File) {
    const result = await this.invoices.upload(file);
    return { success: true, ...result };
  }

  @Post('extract')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'OCR-extract fields from an uploaded file WITHOUT saving (for human review)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  async extract(@UploadedFile() file: Express.Multer.File) {
    const result = await this.invoices.extractFromUpload(file);
    return { success: true, ...result };
  }

  @Post('commit')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Persist human-verified extracted fields to the database' })
  async commit(@Body() body: CommitInvoiceDto) {
    const invoice = await this.invoices.commit(body);
    return { success: true, invoice };
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Dashboard stats — totals by status, pending review count, etc.',
  })
  async getStats() {
    const stats = await this.invoices.getStats();
    return { success: true, ...stats };
  }

  @Get('review-queue')
  @ApiOperation({ summary: 'List invoices waiting for human review' })
  async getReviewQueue(@Query() query: InvoiceQueryDto) {
    const result = await this.invoices.findReviewQueue(query);
    return { success: true, ...result };
  }

  @Get()
  @ApiOperation({
    summary: 'List invoices — filters: status, documentType, supplier, dateFrom/To, confidenceMin/Max',
  })
  async findAll(@Query() query: InvoiceQueryDto) {
    const result = await this.invoices.findAll(query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single invoice by ID' })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const invoice = await this.invoices.findById(id);
    return { success: true, invoice };
  }

  @Patch(':id')
  @Roles(Role.AP_CLERK)
  @ApiOperation({
    summary:
      'Persist human-corrected header fields + line items during review (UI-A-09)',
  })
  async updateFields(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOcrInvoiceDto,
  ) {
    const invoice = await this.invoices.updateFields(id, dto);
    return { success: true, invoice };
  }

  @Post(':id/retry')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Retry OCR processing for an invoice' })
  async retry(@Param('id', new ParseUUIDPipe()) id: string) {
    const result = await this.invoices.retryOcr(id);
    return { success: true, ...result };
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Download the original uploaded invoice file' })
  async downloadFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename, mimeType, size } = await this.invoices.getFile(id);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(stream);
  }
}
