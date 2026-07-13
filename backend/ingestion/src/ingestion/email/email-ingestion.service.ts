import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { IngestionError, MAIL_CLIENT, MailClient, MailMessage } from '../shared';
import { PreProcessingService } from '../pre-processing/pre-processing.service';

/**
 * ING-02: Automated Email Ingestion.
 *
 * Polls one or more AP mailboxes via the MailClient abstraction on the
 * schedule defined by EMAIL_POLL_CRON (default: every 2 minutes; set
 * something like "*\/30 * * * * *" for demo speed). For each unread
 * message:
 *   - Streams every attachment buffer through PreProcessingService.
 *   - On any TRANSIENT attachment failure (e.g. the blob store is down) ->
 *     leave the message unread and untouched so the next poll retries it;
 *     nothing is moved or lost.
 *   - Otherwise, on at least one successful attachment ingest -> mark read +
 *     move to `AP-Processed`.
 *   - On no valid attachments at all -> move to `AP-No-Attachment` for
 *     human review.
 *   - When ALL attachments are PERMANENTLY rejected by pre-processing
 *     (bad type/size/empty) -> move to `AP-Failed`.
 *
 * Resilience:
 *   - `fetchUnreadWithAttachments` failures are logged and the poll is
 *     abandoned for this tick; the next cron tick re-tries (the messages
 *     are still unread, so nothing is lost).
 *   - Transient per-attachment failures (storage unavailable, network
 *     blips) keep the message unread for the next poll rather than moving
 *     it to `AP-Failed`; content-hash dedup makes the retry idempotent.
 *   - The folder-move at the end of `processMessage` retries up to 3
 *     times with exponential backoff (see `safeMove`); if it still fails
 *     the message stays unread and gets retried on the next poll.
 *
 * Idempotency: PreProcessingService computes a content hash and Roshni's
 * BlobUploadClient deduplicates on it -- so re-polling the same message
 * is safe and produces no duplicates.
 */
@Injectable()
export class EmailIngestionService implements OnModuleInit {
  private readonly logger = new Logger(EmailIngestionService.name);
  private readonly mailboxes: string[];
  private readonly cronExpression: string;
  private readonly maxAttempts = 3;

  /**
   * Cron expressions accepted by the `cron` library (5 or 6 fields, second
   * granularity supported with 6 fields). Default = every 2 minutes
   * (product decision, 12 Jun 2026). Override via EMAIL_POLL_CRON to crank
   * it down for demos:
   *   EMAIL_POLL_CRON="*\/30 * * * * *"   (every 30 seconds)
   *   EMAIL_POLL_CRON="*\/10 * * * * *"   (every 10 seconds)
   */
  static readonly DEFAULT_CRON = '0 */2 * * * *';

  /**
   * Matches the seed script's default so the zero-setup quickstart
   * (`npm run seed:local && npm run poll:email`) works without a .env.
   * Real deployments always set MAIL_AP_MAILBOXES explicitly.
   */
  static readonly DEFAULT_MAILBOXES = 'ap-canada@martinrea.com';

  constructor(
    @Inject(MAIL_CLIENT) private readonly mail: MailClient,
    private readonly preProcessing: PreProcessingService,
    private readonly schedulerRegistry: SchedulerRegistry,
    config: ConfigService,
  ) {
    this.mailboxes = (
      config.get<string>('MAIL_AP_MAILBOXES', EmailIngestionService.DEFAULT_MAILBOXES) ||
      EmailIngestionService.DEFAULT_MAILBOXES
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.cronExpression =
      config.get<string>('EMAIL_POLL_CRON', EmailIngestionService.DEFAULT_CRON) ||
      EmailIngestionService.DEFAULT_CRON;
  }

  onModuleInit(): void {
    const job = new CronJob(this.cronExpression, () => {
      void this.pollAllMailboxes();
    });
    this.schedulerRegistry.addCronJob('email-poll', job);
    job.start();
    this.logger.log(`Email cron registered (expression: "${this.cronExpression}")`);
  }

  async pollAllMailboxes(): Promise<void> {
    if (this.mailboxes.length === 0) {
      this.logger.debug('No MAIL_AP_MAILBOXES configured -- skipping email poll');
      return;
    }
    for (const mailbox of this.mailboxes) {
      await this.pollMailbox(mailbox);
    }
  }

  /** Public so the demo runner / tests can invoke a single poll on demand. */
  async pollMailbox(mailbox: string): Promise<void> {
    let messages: MailMessage[];
    try {
      messages = await this.mail.fetchUnreadWithAttachments(mailbox);
    } catch (err) {
      this.logger.error(`[${mailbox}] fetch failed: ${(err as Error).message}`);
      return;
    }

    this.logger.log(`[${mailbox}] ${messages.length} unread message(s)`);
    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: MailMessage): Promise<void> {
    if (message.attachments.length === 0) {
      await this.safeMove(message, 'AP-No-Attachment');
      return;
    }

    let ingested = 0;
    let permanentlyRejected = 0;
    let transientFailed = 0;

    for (const attachment of message.attachments) {
      try {
        await this.preProcessing.validateAndHandoff(attachment.contentBytes, {
          sourceChannel: 'email',
          originalName: attachment.name,
          sourceMeta: {
            mailbox: message.mailbox,
            messageId: message.id,
            fromAddress: message.fromAddress,
            subject: message.subject,
            receivedAt: message.receivedAt.toISOString(),
            attachmentId: attachment.id,
          },
        });
        ingested += 1;
      } catch (err) {
        // Permanent = a validation rejection (bad type/size/empty); these carry
        // a quarantine reason and are already quarantined by pre-processing, so
        // retrying is pointless. Everything else (StorageUnavailableError when
        // the blob store is down, network blips) is transient and must be
        // retried, not silently discarded.
        if (this.isPermanentRejection(err)) {
          permanentlyRejected += 1;
        } else {
          transientFailed += 1;
        }
        this.logger.warn(
          `[${message.mailbox}] attachment ${attachment.name} failed: ${(err as Error).message}`,
        );
      }
    }

    // Any transient failure: leave the message UNREAD so the next poll retries
    // it. The blob layer dedups on content hash, so re-processing an attachment
    // that already succeeded on this pass is safe and produces no duplicates.
    if (transientFailed > 0) {
      this.logger.warn(
        `[${message.mailbox}] message ${message.id}: ${transientFailed} attachment(s) hit a transient error; leaving unread for retry.`,
      );
      return;
    }

    if (ingested === 0 && permanentlyRejected > 0) {
      await this.safeMove(message, 'AP-Failed');
    } else {
      await this.safeMove(message, 'AP-Processed');
    }
  }

  /**
   * A permanent rejection is an `IngestionError` raised by validation
   * (bad type/size/empty) -- its `reason` is a quarantine code, not
   * 'INTERNAL'. `StorageUnavailableError` also extends `IngestionError` but
   * uses reason 'INTERNAL', so it is (correctly) treated as transient.
   */
  private isPermanentRejection(err: unknown): boolean {
    return err instanceof IngestionError && err.reason !== 'INTERNAL';
  }

  private async safeMove(
    message: MailMessage,
    folder: 'AP-Processed' | 'AP-No-Attachment' | 'AP-Failed',
  ): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.mail.markReadAndMove(message.mailbox, message.id, folder);
        return;
      } catch (err) {
        lastErr = err;
        const backoffMs = 250 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    this.logger.error(
      `[${message.mailbox}] could not move message ${message.id} to ${folder} after ${this.maxAttempts} attempts: ${
        (lastErr as Error)?.message
      }`,
    );
  }
}
