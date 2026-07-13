import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Queue } from 'bullmq';
import { createReadStream, ReadStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fn, col, Op, WhereOptions } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { DocumentType } from '../../common/enums/document-type.enum';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';
import { AuditLog } from '../../audit-logs/entities/audit-log.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../../invoices/entities/invoice-line-item.entity';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  JOBS,
  QUEUES,
  UPLOAD_SUBFOLDERS,
} from '../common/constants';
import { ExtractionStoreService } from '../extractions/extraction-store.service';
import { FilesService } from '../files/files.service';
import { OcrService } from '../ocr/ocr.service';
import { OcrParserService } from '../ocr/parser/ocr-parser.service';
import type { ParsedInvoice } from '../ocr/parser/parsed-invoice.interface';
import { CommitInvoiceDto } from './dto/commit-invoice.dto';
import { InvoiceQueryDto } from './dto/invoice-query.dto';
import { SendForMatchingDto } from './dto/send-for-matching.dto';
import { UpdateOcrInvoiceDto } from './dto/update-ocr-invoice.dto';

/**
 * Money comparison tolerance (half a cent) for the invoice-total consistency
 * gate. Mirrors `MONEY_EPS` in the 2-way match engine (match.service.ts).
 */
const MONEY_EPS = 0.005;

/** Result of a stateless OCR extraction (no DB write). */
export interface ExtractionResult {
  stagingId: string;
  file: { originalFilename: string; mimeType: string; fileSize: number };
  fields: ParsedInvoice;
}

@Injectable()
export class InvoicesService implements OnModuleInit {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly maxFileSizeBytes: number;

  constructor(
    @InjectModel(Invoice) private readonly invoiceModel: typeof Invoice,
    @InjectModel(InvoiceLineItem) private readonly lineItemModel: typeof InvoiceLineItem,
    @InjectModel(AuditLog) private readonly auditLogModel: typeof AuditLog,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly ocr: OcrService,
    private readonly parser: OcrParserService,
    private readonly extractionStore: ExtractionStoreService,
    @InjectQueue(QUEUES.UPLOAD) private readonly uploadQueue: Queue,
    @InjectQueue(QUEUES.OCR) private readonly ocrQueue: Queue,
  ) {
    const mb = this.config.get<number>('upload.maxFileSizeMB') ?? 10;
    this.maxFileSizeBytes = mb * 1024 * 1024;
  }

  /**
   * Recovery hook: re-enqueue any invoices that got stuck in RECEIVED /
   * OCR_PROCESSING because of an earlier crash, dead worker, or bad job id.
   */
  async onModuleInit(): Promise<void> {
    const stuck = await this.invoiceModel.findAll({
      where: {
        status: { [Op.in]: [InvoiceStatus.RECEIVED, InvoiceStatus.OCR_PROCESSING] },
      },
      attributes: ['id', 'filePath', 'status'],
    });

    if (stuck.length === 0) return;

    this.logger.log(`Re-enqueueing ${stuck.length} stuck invoice(s) on startup`);
    for (const inv of stuck) {
      try {
        if (!inv.filePath) {
          this.logger.warn(`Skipping ${inv.id}: no file path on record`);
          continue;
        }
        const exists = await this.files.exists(inv.filePath);
        if (!exists) {
          this.logger.warn(`Skipping ${inv.id}: file missing at ${inv.filePath}`);
          continue;
        }
        const jobId = `recover-${inv.id}-${Date.now()}`;
        await this.ocrQueue.add(JOBS.PROCESS_OCR, { invoiceId: inv.id }, { jobId });
        this.logger.log(`[ocr-queue] Recovery: re-enqueued invoice ${inv.id} as ${jobId}`);
      } catch (err) {
        this.logger.error(
          `Recovery enqueue failed for invoice ${inv.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ---------------- Upload ----------------

  async upload(file: Express.Multer.File): Promise<{
    invoiceId: string;
    status: InvoiceStatus;
    message: string;
  }> {
    if (!file) throw new BadRequestException('No file uploaded');

    try {
      this.validateFile(file);
    } catch (err) {
      await this.rejectUploadedFile(file, (err as Error).message);
      throw err;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const storedName = `${Date.now()}-${uuidv4()}${ext}`;
    const rawDir = this.files.getSubfolderPath(UPLOAD_SUBFOLDERS.RAW);
    const rawPath = path.join(rawDir, storedName);

    await fs.mkdir(rawDir, { recursive: true });
    await fs.writeFile(rawPath, file.buffer);

    const invoice = await this.invoiceModel.create({
      filePath: rawPath,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      status: InvoiceStatus.RECEIVED,
    } as unknown as Invoice);

    await this.audit.log({
      invoiceId: invoice.id,
      action: AuditAction.FILE_UPLOADED,
      newValue: {
        originalFilename: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      },
      message: `File uploaded to ${rawPath}`,
    });

    // BullMQ rejects job ids containing ":" — use "-" as separator instead.
    const jobId = `upload-${invoice.id}`;
    try {
      const job = await this.uploadQueue.add(
        JOBS.PROCESS_UPLOAD,
        { invoiceId: invoice.id },
        { jobId },
      );
      this.logger.log(
        `[upload-queue] Enqueued job ${job.id} for invoice ${invoice.id} (file=${file.originalname})`,
      );
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`[upload-queue] Failed to enqueue invoice ${invoice.id}: ${message}`);
      await this.invoiceModel.update(
        { status: InvoiceStatus.FAILED, errorMessage: `Enqueue failed: ${message}` },
        { where: { id: invoice.id } },
      );
      await this.audit.log({
        invoiceId: invoice.id,
        action: AuditAction.OCR_FAILED,
        message: `Enqueue failed: ${message}`,
      });
      throw err;
    }

    // Row stays at RECEIVED until the OCR worker flips it to OCR_PROCESSING.
    return {
      invoiceId: invoice.id,
      status: InvoiceStatus.RECEIVED,
      message: 'File accepted and queued for OCR processing',
    };
  }

  // ----------- Stateless extract + human-verified commit (review flow) -----------

  /**
   * OCR-extract an uploaded file WITHOUT writing to the database. The file is
   * parked in the `staging` folder alongside a sidecar JSON (raw text + parsed
   * fields) so a later `commit()` can persist the human-verified values.
   */
  async extractFromUpload(file: Express.Multer.File): Promise<ExtractionResult> {
    if (!file) throw new BadRequestException('No file uploaded');
    this.validateFile(file);

    const ext = path.extname(file.originalname).toLowerCase();
    const stagingId = `staging-${Date.now()}-${uuidv4()}${ext}`;
    const stagingDir = this.files.getSubfolderPath(UPLOAD_SUBFOLDERS.STAGING);
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(path.join(stagingDir, stagingId), file.buffer);

    return this.runExtraction(stagingId, file.originalname, file.mimetype, file.size);
  }

  /**
   * Core extraction over a file that already lives in the `staging` folder.
   * Shared by direct uploads and OCI pulls. Returns parsed fields only — no DB.
   */
  async runExtraction(
    stagingId: string,
    originalFilename: string,
    mimeType: string,
    fileSize: number,
  ): Promise<ExtractionResult> {
    const stagingDir = this.files.getSubfolderPath(UPLOAD_SUBFOLDERS.STAGING);
    const stagingPath = path.join(stagingDir, stagingId);

    try {
      const ocr = await this.ocr.recognize(stagingPath);
      const parsed = this.parser.parse({
        rawText: ocr.text,
        ocrConfidence: ocr.confidence,
        tokens: ocr.tokens,
      });

      // Sidecar lets commit() persist even if the reviewer makes no edits.
      const sidecar = { rawOcrText: ocr.text, originalFilename, mimeType, fileSize, parsed };
      await fs.writeFile(`${stagingPath}.json`, JSON.stringify(sidecar), 'utf8');

      return { stagingId, file: { originalFilename, mimeType, fileSize }, fields: parsed };
    } catch (err) {
      // Never leave an orphan staged file behind on failure.
      await this.files.deleteIfExists(stagingPath);
      await this.files.deleteIfExists(`${stagingPath}.json`);
      throw err;
    }
  }

  /**
   * Persist the human-verified fields to the database and move the staged file
   * into `processed`. This is the ONLY place a verified invoice gets stored.
   */
  async commit(dto: CommitInvoiceDto) {
    const stagingDir = this.files.getSubfolderPath(UPLOAD_SUBFOLDERS.STAGING);
    const safeId = path.basename(dto.stagingId);
    if (safeId !== dto.stagingId || safeId.includes('..')) {
      throw new BadRequestException('Invalid stagingId');
    }
    const stagingPath = path.join(stagingDir, safeId);
    if (!(await this.files.exists(stagingPath))) {
      throw new NotFoundException(
        'Staged file not found (already committed or expired). Please re-run extraction.',
      );
    }

    // Defaults captured at extraction time; the request body overrides them.
    let sidecar: Record<string, any> = {};
    try {
      sidecar = JSON.parse(await fs.readFile(`${stagingPath}.json`, 'utf8'));
    } catch {
      sidecar = {};
    }
    const base: Record<string, any> = sidecar.parsed ?? {};
    const pick = <T>(edited: T | undefined, fallback: T | null | undefined): T | null =>
      edited !== undefined ? edited : fallback ?? null;

    const confidenceScore = pick(dto.confidenceScore, base.confidenceScore) ?? 100;
    const documentType = (dto.documentType ??
      base.documentType ??
      DocumentType.INVOICE) as DocumentType;
    const invoiceDateStr = pick(dto.invoiceDate, base.invoiceDate);
    const lineItems: any[] = dto.lineItems ?? base.lineItems ?? [];

    // Move the staged file into processed storage before persisting.
    const processedPath = await this.files.moveTo(stagingPath, UPLOAD_SUBFOLDERS.PROCESSED);

    const sequelize = this.invoiceModel.sequelize!;
    const invoiceId = await sequelize.transaction(async (tx) => {
      const invoice = await this.invoiceModel.create(
        {
          supplierName: pick(dto.supplierName, base.supplierName),
          invoiceNumber: pick(dto.invoiceNumber, base.invoiceNumber),
          invoiceDate: invoiceDateStr ? new Date(invoiceDateStr) : null,
          poNumber: pick(dto.poNumber, base.poNumber),
          currency: pick(dto.currency, base.currency) ?? 'USD',
          subtotal: pick(dto.subtotal, base.subtotal),
          taxAmount: pick(dto.taxAmount, base.taxAmount),
          totalAmount: pick(dto.totalAmount, base.totalAmount) ?? 0,
          confidenceScore,
          requiresReview: false, // a human already verified these values
          reviewReason: null,
          status: InvoiceStatus.COMPLETED,
          documentType,
          language: pick(dto.language, base.language),
          filePath: processedPath,
          originalFilename: sidecar.originalFilename ?? path.basename(processedPath),
          mimeType: sidecar.mimeType ?? null,
          fileSize: sidecar.fileSize ?? null,
          rawOcrText: sidecar.rawOcrText ?? null,
        } as unknown as Invoice,
        { transaction: tx },
      );

      if (lineItems.length > 0) {
        await this.lineItemModel.bulkCreate(
          lineItems.map((li, idx) => ({
            invoiceId: invoice.id,
            lineNumber: idx + 1,
            itemCode: li.itemCode ?? null,
            description: li.description ?? null,
            quantity: li.quantity ?? null,
            unitPrice: li.unitPrice ?? null,
            // The line total is always derived from quantity x unitPrice so the
            // stored figure can never disagree with those two inputs.
            lineTotal:
              li.quantity != null && li.unitPrice != null
                ? Number(li.quantity) * Number(li.unitPrice)
                : li.lineTotal ?? null,
          })) as unknown as InvoiceLineItem[],
          { transaction: tx },
        );
      }

      return invoice.id;
    });

    await this.audit.log({
      invoiceId,
      action: AuditAction.UPLOAD,
      newValue: { source: 'verified-commit' },
      message: 'Invoice committed after human verification',
    });
    await this.audit.log({
      invoiceId,
      action: AuditAction.INVOICE_UPDATED,
      newValue: { status: InvoiceStatus.COMPLETED, confidence_score: confidenceScore },
      message: 'Human-verified fields saved',
    });

    await this.files.deleteIfExists(`${stagingPath}.json`);
    this.logger.log(`Committed verified invoice ${invoiceId}`);
    return this.findById(invoiceId);
  }

  /**
   * Persist an in-memory OCR extraction (from the OCR Validation screen) as a
   * DB Invoice at status PENDING_MATCH, ready for the 2-way match workbench.
   *
   * The human-edited fields in `dto` override the values captured at extraction
   * time. Creating the row directly at PENDING_MATCH mirrors how `commit()`
   * creates directly at COMPLETED (bypassing the state machine). On success the
   * extraction is removed from the in-memory store so it drops off the list.
   */
  async commitExtractionForMatching(extractionId: string, dto: SendForMatchingDto) {
    return this.persistExtraction(extractionId, dto, {
      status: InvoiceStatus.PENDING_MATCH,
      source: 'ocr-extraction-send-for-matching',
      auditMessage: 'OCR extraction persisted and sent for 2-way matching',
      savedMessage: 'Human-verified OCR fields saved (sent for matching)',
      logVerb: 'for matching',
      // Only the "send for matching" path is gated: an invoice with internally
      // inconsistent totals must never enter the match queue. The reject path
      // (-> EXCEPTION) intentionally skips this so bad invoices can still be
      // triaged out.
      enforceTotals: true,
    });
  }

  /**
   * Persist an in-memory OCR extraction (from the OCR Validation screen) as a
   * DB Invoice at status EXCEPTION, sending it to the exception queue. Same
   * persistence path as `commitExtractionForMatching` but with a rejection
   * reason recorded and no match ever attempted.
   */
  async rejectExtractionToException(extractionId: string, dto: SendForMatchingDto) {
    return this.persistExtraction(extractionId, dto, {
      status: InvoiceStatus.EXCEPTION,
      rejectionReason: 'Rejected during OCR validation',
      source: 'ocr-extraction-reject',
      auditMessage: 'OCR extraction rejected and sent to the exception queue',
      savedMessage: 'OCR fields saved (rejected to exception queue)',
      logVerb: 'to exception queue',
    });
  }

  /**
   * Shared persistence path for turning an in-memory OCR extraction into a DB
   * Invoice at the requested status. The human-edited fields in `dto` override
   * the values captured at extraction time; the row is created directly at
   * `opts.status` (bypassing the state machine, like `commit()`), audited, and
   * the extraction is removed from the in-memory store on success.
   */
  private async persistExtraction(
    extractionId: string,
    dto: SendForMatchingDto,
    opts: {
      status: InvoiceStatus;
      source: string;
      auditMessage: string;
      savedMessage: string;
      logVerb: string;
      rejectionReason?: string | null;
      enforceTotals?: boolean;
    },
  ) {
    const extraction = this.extractionStore.get(extractionId);
    if (!extraction) {
      throw new NotFoundException(
        `Extraction ${extractionId} not found (already sent or expired). Please re-scan.`,
      );
    }

    const base = extraction.fields;
    const pick = <T>(edited: T | undefined, fallback: T | null | undefined): T | null =>
      edited !== undefined ? edited : fallback ?? null;

    const confidenceScore = pick(dto.confidenceScore, base.confidenceScore) ?? 100;
    const documentType = (dto.documentType ??
      base.documentType ??
      DocumentType.INVOICE) as DocumentType;
    const invoiceDateStr = pick(dto.invoiceDate, base.invoiceDate);
    const lineItems = (dto.lineItems ?? base.lineItems ?? []) as Array<{
      itemCode?: string | null;
      description?: string | null;
      quantity?: number | null;
      unitPrice?: number | null;
      lineTotal?: number | null;
    }>;

    const subtotalVal = pick(dto.subtotal, base.subtotal);
    const taxVal = pick(dto.taxAmount, base.taxAmount) ?? 0;
    const discountVal = dto.discount ?? 0;
    const totalVal = pick(dto.totalAmount, base.totalAmount) ?? 0;

    // Invoice-total consistency gate (send-for-matching only). Each line total
    // is quantity x unitPrice; the subtotal must equal the sum of those, and
    // the declared total must equal subtotal - discount + tax. Reject before
    // any row is created so the extraction survives in the in-memory store and
    // stays on the OCR Processing screen until the numbers are corrected.
    if (opts.enforceTotals) {
      const priced = lineItems.filter(
        (li) => li.quantity != null && li.unitPrice != null,
      );
      if (priced.length > 0) {
        const computedSubtotal = priced.reduce(
          (sum, li) => sum + Number(li.quantity) * Number(li.unitPrice),
          0,
        );
        const effectiveSubtotal = subtotalVal ?? computedSubtotal;
        const expectedTotal = effectiveSubtotal - discountVal + taxVal;
        const linesVsSubtotal =
          Math.abs(computedSubtotal - effectiveSubtotal) > MONEY_EPS;
        const headerMath = Math.abs(totalVal - expectedTotal) > MONEY_EPS;
        if (linesVsSubtotal || headerMath) {
          throw new BadRequestException(
            'Invalid invoice — total price is not correct. ' +
              `Line items sum to ${computedSubtotal.toFixed(2)}, ` +
              `subtotal is ${effectiveSubtotal.toFixed(2)}, ` +
              `and the declared total ${totalVal.toFixed(2)} should equal ` +
              `subtotal - discount + tax (${expectedTotal.toFixed(2)}). ` +
              'Fix the amounts and try again.',
          );
        }
      }
    }

    const sequelize = this.invoiceModel.sequelize!;
    const invoiceId = await sequelize.transaction(async (tx) => {
      const invoice = await this.invoiceModel.create(
        {
          supplierName: pick(dto.supplierName, base.supplierName),
          supplierTaxId: pick(dto.supplierTaxId, base.supplierTaxId),
          invoiceNumber: pick(dto.invoiceNumber, base.invoiceNumber),
          invoiceDate: invoiceDateStr ? new Date(invoiceDateStr) : null,
          poNumber: pick(dto.poNumber, base.poNumber),
          currency: pick(dto.currency, base.currency) ?? 'USD',
          subtotal: subtotalVal,
          taxAmount: pick(dto.taxAmount, base.taxAmount),
          discount: dto.discount ?? null,
          totalAmount: totalVal,
          confidenceScore,
          requiresReview: false, // a human verified these values on the OCR screen
          reviewReason: null,
          rejectionReason: opts.rejectionReason ?? null,
          status: opts.status,
          documentType,
          language: pick(dto.language, base.language),
          ingestionChannel: 'OCI',
          originalFilename: extraction.originalFilename,
          mimeType: extraction.mimeType ?? null,
          fileSize: extraction.fileSize ?? null,
        } as unknown as Invoice,
        { transaction: tx },
      );

      if (lineItems.length > 0) {
        await this.lineItemModel.bulkCreate(
          lineItems.map((li, idx) => ({
            invoiceId: invoice.id,
            lineNumber: idx + 1,
            itemCode: li.itemCode ?? null,
            description: li.description ?? null,
            quantity: li.quantity ?? null,
            unitPrice: li.unitPrice ?? null,
            // The line total is always derived from quantity x unitPrice so the
            // stored figure can never disagree with those two inputs.
            lineTotal:
              li.quantity != null && li.unitPrice != null
                ? Number(li.quantity) * Number(li.unitPrice)
                : li.lineTotal ?? null,
          })) as unknown as InvoiceLineItem[],
          { transaction: tx },
        );
      }

      return invoice.id;
    });

    await this.audit.log({
      invoiceId,
      action: AuditAction.UPLOAD,
      newValue: { source: opts.source },
      message: opts.auditMessage,
    });
    await this.audit.log({
      invoiceId,
      action: AuditAction.INVOICE_UPDATED,
      newValue: { status: opts.status, confidence_score: confidenceScore },
      message: opts.savedMessage,
    });

    this.extractionStore.remove(extractionId);
    this.logger.log(
      `Sent extraction ${extractionId} ${opts.logVerb} as invoice ${invoiceId}`,
    );
    return this.findById(invoiceId);
  }

  /**
   * PRD UI-A-09: persist human-corrected header fields AND line items onto the
   * OCR record during review. When `lineItems` is supplied it fully replaces
   * the existing lines (delete + recreate) inside one transaction.
   */
  async updateFields(id: string, dto: UpdateOcrInvoiceDto) {
    const existing = await this.invoiceModel.findByPk(id);
    if (!existing) throw new NotFoundException(`OCR invoice ${id} not found`);

    const data: Record<string, unknown> = {};
    if (dto.supplierName !== undefined) data.supplierName = dto.supplierName;
    if (dto.invoiceNumber !== undefined) data.invoiceNumber = dto.invoiceNumber;
    if (dto.poNumber !== undefined) data.poNumber = dto.poNumber;
    if (dto.currency !== undefined) data.currency = dto.currency ?? 'USD';
    if (dto.invoiceDate !== undefined) {
      data.invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : null;
    }

    const sequelize = this.invoiceModel.sequelize!;
    await sequelize.transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await this.invoiceModel.update(data, { where: { id }, transaction: tx });
      }

      if (dto.lineItems) {
        await this.lineItemModel.destroy({ where: { invoiceId: id }, transaction: tx });
        if (dto.lineItems.length > 0) {
          await this.lineItemModel.bulkCreate(
            dto.lineItems.map((li, idx) => {
              const qty = li.quantity ?? null;
              const unit = li.unitPrice ?? null;
              const lineTotal =
                li.lineTotal ?? (qty !== null && unit !== null ? qty * unit : null);
              return {
                invoiceId: id,
                lineNumber: idx + 1,
                itemCode: li.itemCode ?? null,
                description: li.description ?? null,
                quantity: qty,
                unitPrice: unit,
                lineTotal,
              };
            }) as unknown as InvoiceLineItem[],
            { transaction: tx },
          );
        }
      }
    });

    await this.audit.log({
      invoiceId: id,
      action: AuditAction.INVOICE_UPDATED,
      newValue: {
        ...(dto.supplierName !== undefined ? { supplierName: dto.supplierName } : {}),
        ...(dto.invoiceNumber !== undefined ? { invoiceNumber: dto.invoiceNumber } : {}),
        ...(dto.poNumber !== undefined ? { poNumber: dto.poNumber } : {}),
        ...(dto.lineItems ? { lineItemCount: dto.lineItems.length } : {}),
      },
      message: 'Human-corrected fields saved during review',
    });

    return this.findById(id);
  }

  private validateFile(file: Express.Multer.File): void {
    if (file.size > this.maxFileSizeBytes) {
      throw new PayloadTooLargeException(
        `File exceeds maximum size of ${this.maxFileSizeBytes / (1024 * 1024)}MB`,
      );
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file extension "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
      throw new UnsupportedMediaTypeException(
        `Unsupported MIME type "${file.mimetype}". Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
  }

  private async rejectUploadedFile(file: Express.Multer.File, reason: string): Promise<void> {
    try {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      const rejectedName = `${Date.now()}-${uuidv4()}${ext}`;
      const rejectedDir = this.files.getSubfolderPath(UPLOAD_SUBFOLDERS.REJECTED);
      await fs.mkdir(rejectedDir, { recursive: true });
      const rejectedPath = path.join(rejectedDir, rejectedName);
      await fs.writeFile(rejectedPath, file.buffer);

      await this.audit.log({
        action: AuditAction.FILE_REJECTED,
        newValue: {
          originalFilename: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          storedAt: rejectedPath,
        },
        message: `File rejected: ${reason}`,
      });
    } catch (err) {
      this.logger.error(`Failed to persist rejected file: ${(err as Error).message}`);
    }
  }

  /**
   * Idempotency helper for the OCI auto-ingest poller: has a document with this
   * stored filename already been pulled into the pipeline? Includes soft-deleted
   * rows (the model is paranoid) — deleting an invoice must not resurrect its
   * source document in the OCR queue.
   */
  async existsByOriginalFilename(originalFilename: string): Promise<boolean> {
    const count = await this.invoiceModel.count({
      where: { originalFilename },
      paranoid: false,
    });
    return count > 0;
  }

  // ---------------- Retrieval ----------------

  async findById(id: string) {
    const invoice = await this.invoiceModel.findByPk(id);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);

    const [lines, auditLogs] = await Promise.all([
      this.lineItemModel.findAll({ where: { invoiceId: id }, order: [['lineNumber', 'ASC']] }),
      this.auditLogModel.findAll({ where: { invoiceId: id }, order: [['createdAt', 'DESC']] }),
    ]);

    return this.toJson(invoice, lines, auditLogs);
  }

  async findAll(query: InvoiceQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where: WhereOptions = {};

    if (query.status) (where as Record<string, unknown>).status = query.status;
    if (query.documentType) (where as Record<string, unknown>).documentType = query.documentType;
    if (query.supplier) {
      (where as Record<string, unknown>).supplierName = { [Op.iLike]: `%${query.supplier}%` };
    }
    if (query.dateFrom || query.dateTo) {
      (where as Record<string, unknown>).createdAt = {
        ...(query.dateFrom ? { [Op.gte]: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { [Op.lte]: new Date(query.dateTo + 'T23:59:59.999Z') } : {}),
      };
    }
    if (query.confidenceMin !== undefined || query.confidenceMax !== undefined) {
      (where as Record<string, unknown>).confidenceScore = {
        ...(query.confidenceMin !== undefined ? { [Op.gte]: query.confidenceMin } : {}),
        ...(query.confidenceMax !== undefined ? { [Op.lte]: query.confidenceMax } : {}),
      };
    }

    const { rows, count } = await this.invoiceModel.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      offset: (page - 1) * limit,
      limit,
    });

    const linesByInvoice = await this.loadLinesFor(rows.map((r) => r.id));

    return {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
      items: rows.map((i) => this.toJson(i, linesByInvoice.get(i.id) ?? [])),
    };
  }

  /**
   * Dashboard stats widget data (Feature 13).
   */
  async getStats() {
    const [total, byStatusRows, pendingReview, completed, failed, duplicates] = await Promise.all([
      this.invoiceModel.count(),
      this.invoiceModel.findAll({
        attributes: ['status', [fn('COUNT', col('id')), 'count']],
        group: ['status'],
        raw: true,
      }) as unknown as Promise<Array<{ status: string; count: string }>>,
      this.invoiceModel.count({ where: { requiresReview: true } }),
      this.invoiceModel.count({ where: { status: InvoiceStatus.COMPLETED } }),
      this.invoiceModel.count({ where: { status: InvoiceStatus.FAILED } }),
      this.invoiceModel.count({ where: { status: InvoiceStatus.DUPLICATE_INVOICE } }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of byStatusRows) statusMap[row.status] = Number(row.count);

    return {
      total,
      pendingReview,
      completed,
      failed,
      duplicates,
      byStatus: statusMap,
    };
  }

  async findReviewQueue(query: InvoiceQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const where: WhereOptions = {
      [Op.or]: [
        { requiresReview: true },
        { status: InvoiceStatus.PENDING_REVIEW },
        { status: InvoiceStatus.DUPLICATE_INVOICE },
      ],
    };

    const { rows, count } = await this.invoiceModel.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      offset: (page - 1) * limit,
      limit,
    });

    const linesByInvoice = await this.loadLinesFor(rows.map((r) => r.id));

    return {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
      items: rows.map((i) => this.toJson(i, linesByInvoice.get(i.id) ?? [])),
    };
  }

  // ---------------- File download ----------------

  /**
   * Opens a read stream for the original uploaded file so the controller can
   * stream it to the client with a Content-Disposition: attachment header.
   */
  async getFile(id: string): Promise<{
    stream: ReadStream;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    const invoice = await this.invoiceModel.findByPk(id, {
      attributes: ['id', 'filePath', 'originalFilename', 'mimeType'],
    });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    if (!invoice.filePath) {
      throw new NotFoundException(`File for invoice ${id} has no stored path`);
    }

    const exists = await this.files.exists(invoice.filePath);
    if (!exists) {
      throw new NotFoundException(`File for invoice ${id} no longer exists on disk`);
    }

    const stat = await fs.stat(invoice.filePath);
    const filename = invoice.originalFilename ?? path.basename(invoice.filePath);
    const mimeType = invoice.mimeType ?? 'application/octet-stream';

    return {
      stream: createReadStream(invoice.filePath),
      filename,
      mimeType,
      size: stat.size,
    };
  }

  // ---------------- Retry ----------------

  async retryOcr(id: string) {
    const invoice = await this.invoiceModel.findByPk(id);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    if (!invoice.filePath) {
      throw new BadRequestException('Invoice has no stored file to retry');
    }

    const exists = await this.files.exists(invoice.filePath);
    if (!exists) {
      throw new BadRequestException(`Original file not found at ${invoice.filePath}`);
    }

    let newPath = invoice.filePath;
    if (!invoice.filePath.includes(`${path.sep}${UPLOAD_SUBFOLDERS.RAW}${path.sep}`)) {
      newPath = await this.files.moveTo(invoice.filePath, UPLOAD_SUBFOLDERS.RAW);
    }

    await this.invoiceModel.update(
      {
        status: InvoiceStatus.RECEIVED,
        ocrRetryCount: 0,
        errorMessage: null,
        filePath: newPath,
      },
      { where: { id } },
    );

    await this.audit.log({
      invoiceId: id,
      action: AuditAction.OCR_RETRIED,
      message: 'Manual OCR retry requested',
    });

    const jobId = `ocr-${id}-retry-${Date.now()}`;
    const job = await this.ocrQueue.add(JOBS.PROCESS_OCR, { invoiceId: id }, { jobId });
    this.logger.log(`[ocr-queue] Enqueued retry job ${job.id} for invoice ${id}`);

    return { invoiceId: id, status: InvoiceStatus.RECEIVED, message: 'Retry queued' };
  }

  // ---------------- Helpers ----------------

  private async loadLinesFor(invoiceIds: string[]): Promise<Map<string, InvoiceLineItem[]>> {
    const grouped = new Map<string, InvoiceLineItem[]>();
    if (invoiceIds.length === 0) return grouped;
    const lines = await this.lineItemModel.findAll({
      where: { invoiceId: { [Op.in]: invoiceIds } },
      order: [['lineNumber', 'ASC']],
    });
    for (const line of lines) {
      const list = grouped.get(line.invoiceId) ?? [];
      list.push(line);
      grouped.set(line.invoiceId, list);
    }
    return grouped;
  }

  private toJson(invoice: Invoice, lines: InvoiceLineItem[] = [], auditLogs: AuditLog[] = []) {
    const dec = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const toDate = (v: unknown) =>
      v instanceof Date ? v : v ? new Date(v as string) : null;
    const invoiceDate = toDate(invoice.invoiceDate);
    // createdAt/updatedAt are Sequelize-managed timestamps not declared on the
    // entity class, so read them through the untyped accessor.
    const inv = invoice as unknown as { createdAt: Date; updatedAt: Date };
    return {
      id: invoice.id,
      supplier_name: invoice.supplierName,
      invoice_number: invoice.invoiceNumber,
      invoice_date: invoiceDate ? invoiceDate.toISOString().slice(0, 10) : null,
      po_number: invoice.poNumber,
      currency: invoice.currency,
      subtotal: dec(invoice.subtotal),
      tax_amount: dec(invoice.taxAmount),
      discount: dec(invoice.discount),
      total_amount: dec(invoice.totalAmount),
      confidence_score: dec(invoice.confidenceScore),
      requires_review: invoice.requiresReview,
      review_reason: invoice.reviewReason ?? null,
      status: invoice.status,
      document_type: invoice.documentType,
      language: invoice.language ?? null,
      file_path: invoice.filePath,
      original_filename: invoice.originalFilename,
      mime_type: invoice.mimeType,
      file_size: invoice.fileSize,
      ocr_retry_count: invoice.ocrRetryCount,
      error_message: invoice.errorMessage,
      created_at: inv.createdAt,
      updated_at: inv.updatedAt,
      line_items: lines.map((l) => ({
        id: l.id,
        item_code: l.itemCode,
        description: l.description,
        quantity: dec(l.quantity),
        unit_price: dec(l.unitPrice),
        line_total: dec(l.lineTotal),
      })),
      audit_logs: auditLogs.map((a) => ({
        id: a.id,
        action: a.actionType,
        message: a.notes,
        old_value: a.oldValue,
        new_value: a.newValue,
        timestamp: (a as unknown as { createdAt: Date }).createdAt,
      })),
    };
  }
}
