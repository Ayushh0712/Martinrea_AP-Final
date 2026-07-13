import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { JOBS, QUEUES } from '../../common/constants';

export interface UploadJobData {
  invoiceId: string;
}

/**
 * Upload worker: lightweight stage that hands off to the OCR queue.
 * Splitting these queues lets us throttle OCR independently and add
 * cheaper preprocessing here later (e.g. virus scan, mime sniffing).
 */
@Processor(QUEUES.UPLOAD, { concurrency: 5 })
export class UploadProcessor extends WorkerHost {
  private readonly logger = new Logger(UploadProcessor.name);

  constructor(@InjectQueue(QUEUES.OCR) private readonly ocrQueue: Queue) {
    super();
  }

  async process(job: Job<UploadJobData>): Promise<void> {
    const { invoiceId } = job.data;
    this.logger.log(
      `[upload-queue] Worker started for job ${job.id} -> dispatching invoice ${invoiceId} to ocr-queue`,
    );

    // BullMQ rejects ":" in custom job ids — use "-" instead.
    const ocrJobId = `ocr-${invoiceId}`;
    const ocrJob = await this.ocrQueue.add(JOBS.PROCESS_OCR, { invoiceId }, { jobId: ocrJobId });

    this.logger.log(
      `[upload-queue] Handed off invoice ${invoiceId} to ocr-queue as job ${ocrJob.id}`,
    );
  }

  @OnWorkerEvent('active')
  onActive(job: Job<UploadJobData>): void {
    this.logger.log(`[upload-queue] ACTIVE job=${job.id} invoice=${job.data.invoiceId}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<UploadJobData>): void {
    this.logger.log(`[upload-queue] COMPLETED job=${job.id} invoice=${job.data.invoiceId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<UploadJobData>, err: Error): void {
    this.logger.error(
      `[upload-queue] FAILED job=${job?.id} invoice=${job?.data?.invoiceId}: ${err.message}`,
      err.stack,
    );
  }
}
