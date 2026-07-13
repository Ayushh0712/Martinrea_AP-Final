import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../../invoices/entities/invoice-line-item.entity';
import { OcrResult } from '../../ocr-results/entities/ocr-result.entity';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { UPLOAD_SUBFOLDERS } from '../common/constants';
import { FilesService } from '../files/files.service';
import { OcrService } from '../ocr/ocr.service';
import { OcrParserService } from '../ocr/parser/ocr-parser.service';
import { ParsedInvoice } from '../ocr/parser/parsed-invoice.interface';

/**
 * Background work for an invoice once it has been uploaded:
 *   - run OCR
 *   - parse fields via OcrParserService (Feature 1 + 2 + 3 + 5 + 6 + 7)
 *   - duplicate detection (Feature 12)
 *   - move file to processed/review
 *   - persist all results + audit logs (Feature 10 + 11)
 *
 * Persistence uses the unified Sequelize schema (Invoice + InvoiceLineItem +
 * OcrResult) - the OCR sub-app no longer owns a separate Prisma table.
 */
@Injectable()
export class InvoiceProcessorService {
  private readonly logger = new Logger(InvoiceProcessorService.name);
  private readonly maxRetries: number;

  constructor(
    @InjectModel(Invoice) private readonly invoiceModel: typeof Invoice,
    @InjectModel(InvoiceLineItem) private readonly lineItemModel: typeof InvoiceLineItem,
    @InjectModel(OcrResult) private readonly ocrResultModel: typeof OcrResult,
    private readonly files: FilesService,
    private readonly ocr: OcrService,
    private readonly parser: OcrParserService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.maxRetries = this.config.get<number>('ocr.maxRetries') ?? 3;
  }

  /**
   * Run the full OCR → parse → persist pipeline for a single invoice.
   */
  async processOcr(invoiceId: string): Promise<void> {
    const invoice = await this.invoiceModel.findByPk(invoiceId);
    if (!invoice) {
      this.logger.warn(`Invoice ${invoiceId} not found; skipping OCR`);
      return;
    }

    const filePath = invoice.filePath;
    if (!filePath) {
      await this.markFailed(invoiceId, 'File path missing on invoice record');
      return;
    }

    const fileExists = await this.files.exists(filePath);
    if (!fileExists) {
      await this.markFailed(invoiceId, `File missing: ${filePath}`);
      return;
    }

    await this.invoiceModel.update(
      { status: InvoiceStatus.OCR_PROCESSING },
      { where: { id: invoiceId } },
    );
    await this.audit.log({
      invoiceId,
      action: AuditAction.OCR_STARTED,
      message: `OCR started (attempt ${(invoice.ocrRetryCount ?? 0) + 1})`,
    });

    try {
      // 1. OCR (Tesseract / pdf-parse / pdf2pic path)
      const result = await this.ocr.recognize(filePath);

      // 2. Parse: field extraction + detectors + rule-based confidence scoring
      const parsed: ParsedInvoice = this.parser.parse({
        rawText: result.text,
        ocrConfidence: result.confidence,
        tokens: result.tokens,
      });

      // 3. Duplicate detection — rule: same supplier + invoice number (Feature 12)
      const duplicateOf = await this.findDuplicate(
        parsed.supplierName,
        parsed.invoiceNumber,
        invoiceId,
      );

      let finalStatus: InvoiceStatus;
      let targetSubfolder: (typeof UPLOAD_SUBFOLDERS)[keyof typeof UPLOAD_SUBFOLDERS];

      if (duplicateOf) {
        finalStatus = InvoiceStatus.DUPLICATE_INVOICE;
        targetSubfolder = UPLOAD_SUBFOLDERS.REVIEW;
        await this.audit.log({
          invoiceId,
          action: AuditAction.DUPLICATE_DETECTED,
          newValue: { duplicateOfInvoiceId: duplicateOf },
          message: `Duplicate of invoice ${duplicateOf}`,
        });
      } else if (parsed.requiresReview) {
        finalStatus = InvoiceStatus.PENDING_REVIEW;
        targetSubfolder = UPLOAD_SUBFOLDERS.REVIEW;
        // Spec Feature 10: REVIEW_REQUIRED audit action
        await this.audit.log({
          invoiceId,
          action: AuditAction.REVIEW_REQUIRED,
          newValue: {
            confidence_score: parsed.confidenceScore,
            review_reason: parsed.reviewReason,
          },
          message: parsed.reviewReason ?? 'Below confidence threshold',
        });
      } else {
        // PRD section 5.2: OCR_PROCESSING -> PENDING_REVIEW. Every invoice must
        // be verified by an AP clerk before matching, so even high-confidence
        // extractions land in PENDING_REVIEW (the `requiresReview` flag still
        // distinguishes low-confidence docs for the amber "verify" banner).
        finalStatus = InvoiceStatus.PENDING_REVIEW;
        targetSubfolder = UPLOAD_SUBFOLDERS.REVIEW;
      }

      const newPath = await this.files.moveTo(filePath, targetSubfolder);

      await this.persistResults(invoiceId, parsed, result.text, newPath, finalStatus);

      await this.audit.log({
        invoiceId,
        action: AuditAction.OCR_COMPLETED,
        newValue: {
          confidence_score: parsed.confidenceScore,
          status: finalStatus,
          document_type: parsed.documentType,
          language: parsed.language,
        },
        message: `OCR completed: score=${parsed.confidenceScore} type=${parsed.documentType} lang=${parsed.language}`,
      });

      await this.audit.log({
        invoiceId,
        action:
          targetSubfolder === UPLOAD_SUBFOLDERS.REVIEW
            ? AuditAction.MOVED_TO_REVIEW
            : AuditAction.MOVED_TO_PROCESSED,
        newValue: { filePath: newPath },
        message: `File moved to ${targetSubfolder}`,
      });

      this.logger.log(
        `Invoice ${invoiceId}: status=${finalStatus} score=${parsed.confidenceScore} ` +
          `type=${parsed.documentType} lang=${parsed.language}`,
      );
    } catch (err) {
      const error = err as Error;
      this.logger.error(`OCR failed for invoice ${invoiceId}: ${error.message}`, error.stack);

      const newRetryCount = (invoice.ocrRetryCount ?? 0) + 1;
      await this.invoiceModel.update(
        { ocrRetryCount: newRetryCount, errorMessage: error.message },
        { where: { id: invoiceId } },
      );

      await this.audit.log({
        invoiceId,
        action: AuditAction.OCR_FAILED,
        message: `OCR attempt ${newRetryCount} failed: ${error.message}`,
      });

      if (newRetryCount >= this.maxRetries) {
        await this.markFailed(
          invoiceId,
          `Exceeded max retries (${this.maxRetries}): ${error.message}`,
        );
      }

      // Re-throw so BullMQ retries the job.
      throw err;
    }
  }

  // ---------- Internals ----------

  private async persistResults(
    invoiceId: string,
    parsed: ParsedInvoice,
    rawText: string,
    newFilePath: string,
    finalStatus: InvoiceStatus,
  ): Promise<void> {
    const sequelize = this.invoiceModel.sequelize!;
    await sequelize.transaction(async (tx) => {
      await this.lineItemModel.destroy({ where: { invoiceId }, transaction: tx });

      await this.invoiceModel.update(
        {
          supplierName: parsed.supplierName,
          invoiceNumber: parsed.invoiceNumber,
          invoiceDate: parsed.invoiceDate ? new Date(parsed.invoiceDate) : null,
          poNumber: parsed.poNumber,
          currency: parsed.currency ?? 'USD',
          subtotal: parsed.subtotal,
          taxAmount: parsed.taxAmount,
          totalAmount: parsed.totalAmount ?? 0,
          confidenceScore: parsed.confidenceScore,
          requiresReview:
            parsed.requiresReview || finalStatus === InvoiceStatus.DUPLICATE_INVOICE,
          reviewReason: parsed.reviewReason,
          status: finalStatus,
          documentType: parsed.documentType,
          language: parsed.language,
          filePath: newFilePath,
          rawOcrText: rawText,
          errorMessage: null,
        },
        { where: { id: invoiceId }, transaction: tx },
      );

      if (parsed.lineItems.length > 0) {
        await this.lineItemModel.bulkCreate(
          parsed.lineItems.map((li, idx) => ({
            invoiceId,
            lineNumber: idx + 1,
            itemCode: li.itemCode,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            lineTotal: li.lineTotal,
          })) as unknown as InvoiceLineItem[],
          { transaction: tx },
        );
      }

      // Richer structured OCR result row (one per invoice). Upsert by invoiceId.
      const ocrPayload = {
        invoiceId,
        extractionEngine: 'tesseract',
        rawResponse: null,
        extractedInvoiceNumber: parsed.invoiceNumber,
        extractedSupplierName: parsed.supplierName,
        extractedPoNumber: parsed.poNumber,
        extractedTotalAmount: parsed.totalAmount,
        extractedTaxAmount: parsed.taxAmount,
        extractedInvoiceDate: parsed.invoiceDate,
        extractedLineItems: parsed.lineItems.map((li, idx) => ({
          lineNumber: idx + 1,
          itemCode: li.itemCode ?? undefined,
          description: li.description ?? undefined,
          quantity: li.quantity ?? undefined,
          unitPrice: li.unitPrice ?? undefined,
          lineTotal: li.lineTotal ?? undefined,
        })),
        overallConfidence: parsed.confidenceScore,
        requiresHumanReview: parsed.requiresReview,
        languageDetected: parsed.language,
        documentType: parsed.documentType,
      };

      const existingOcr = await this.ocrResultModel.findOne({
        where: { invoiceId },
        transaction: tx,
      });
      if (existingOcr) {
        await existingOcr.update(ocrPayload, { transaction: tx });
      } else {
        await this.ocrResultModel.create(ocrPayload as unknown as OcrResult, {
          transaction: tx,
        });
      }
    });
  }

  /**
   * Feature 12 duplicate rule: same supplierName + invoiceNumber (total dropped).
   */
  private async findDuplicate(
    supplierName: string | null,
    invoiceNumber: string | null,
    selfId: string,
  ): Promise<string | null> {
    if (!supplierName || !invoiceNumber) return null;

    const existing = await this.invoiceModel.findOne({
      where: {
        id: { [Op.ne]: selfId },
        supplierName,
        invoiceNumber,
        status: { [Op.notIn]: [InvoiceStatus.REJECTED, InvoiceStatus.FAILED] },
      },
      attributes: ['id'],
    });

    return existing?.id ?? null;
  }

  private async markFailed(invoiceId: string, message: string): Promise<void> {
    await this.invoiceModel.update(
      { status: InvoiceStatus.FAILED, errorMessage: message },
      { where: { id: invoiceId } },
    );
    await this.audit.log({
      invoiceId,
      action: AuditAction.STATUS_CHANGED,
      newValue: { status: InvoiceStatus.FAILED },
      message,
    });
  }
}
