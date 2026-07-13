import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../../common/constants';
import { InvoiceProcessorService } from '../invoice-processor.service';

export interface OcrJobData {
  invoiceId: string;
}

@Processor(QUEUES.OCR, { concurrency: 2 })
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(private readonly processor: InvoiceProcessorService) {
    super();
  }

  async process(job: Job<OcrJobData>): Promise<void> {
    const { invoiceId } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.log(
      `[ocr-queue] OCR worker started: job=${job.id} invoice=${invoiceId} attempt=${attempt}`,
    );

    try {
      await this.processor.processOcr(invoiceId);
      this.logger.log(`[ocr-queue] OCR completed: job=${job.id} invoice=${invoiceId}`);
    } catch (err) {
      this.logger.error(
        `[ocr-queue] OCR failed: job=${job.id} invoice=${invoiceId}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<OcrJobData>): void {
    this.logger.log(`[ocr-queue] ACTIVE job=${job.id} invoice=${job.data.invoiceId}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<OcrJobData>): void {
    this.logger.log(`[ocr-queue] COMPLETED job=${job.id} invoice=${job.data.invoiceId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<OcrJobData> | undefined, err: Error): void {
    this.logger.error(
      `[ocr-queue] FAILED job=${job?.id} invoice=${job?.data?.invoiceId}: ${err.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`[ocr-queue] STALLED job=${jobId}`);
  }
}
