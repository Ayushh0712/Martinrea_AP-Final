import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  IngestionError,
  SftpClient,
  SftpClientFactory,
  SftpRemoteFile,
  SFTP_CLIENT_FACTORY,
} from '../shared';
import { PreProcessingService } from '../pre-processing/pre-processing.service';

/**
 * ING-03: SFTP Ingestion.
 *
 * Polls each path in SFTP_INCOMING_PATHS on the schedule defined by
 * SFTP_POLL_CRON (default: every 2 minutes; set "*\/30 * * * * *" for
 * demo speed):
 *   1. List remote files.
 *   2. SKIP files modified within SFTP_PARTIAL_WRITE_GRACE_MS -- the
 *      scanner / partner may still be writing to them.
 *   3. SKIP files larger than SFTP_HARD_CEILING_BYTES -- this is a
 *      bandwidth guard for pathological cases (a partner accidentally
 *      drops a 2 GB file). Set well above MAX_FILE_BYTES so legitimate
 *      oversize invoices still get audited.
 *   4. Download as buffer, hand off to PreProcessingService. Pre-
 *      processing handles type/size/empty rejection and writes the bad
 *      buffer into .local-quarantine/ (the audit record).
 *   5. Outcome dispatch (after pre-processing returns or throws):
 *        - success                  -> delete from SFTP
 *        - IngestionError (permanent: too large / wrong MIME / empty)
 *                                   -> delete from SFTP; the quarantine
 *                                      entry IS the audit record, no
 *                                      point re-quarantining every poll
 *        - any other error (transient: blob backend down, network blip)
 *                                   -> leave on SFTP; next poll retries
 *   6. Always disconnect at end of poll. Connect-per-poll is essential
 *      because long-lived SFTP connections die in firewalls.
 */
@Injectable()
export class SftpIngestionService implements OnModuleInit {
  private readonly logger = new Logger(SftpIngestionService.name);
  private readonly incomingPaths: string[];
  private readonly graceMs: number;
  private readonly hardCeilingBytes: number;
  private readonly cronExpression: string;

  /**
   * PRD ING-03: transient failures (download error, blob backend down) are
   * retried up to 3 times; persistent failures raise an ops alert and the file
   * is then skipped so it doesn't loop forever. Counts are per remote path and
   * cleared once the file is successfully ingested or permanently rejected.
   */
  static readonly MAX_TRANSIENT_ATTEMPTS = 3;
  private readonly transientAttempts = new Map<string, number>();

  /**
   * Default hard ceiling = 50 MiB. Sized as ~5x the typical MAX_FILE_BYTES
   * policy (10 MiB) so legitimately oversize invoices still get downloaded
   * + quarantined for ops to see, while a runaway multi-GB upload from
   * a partner does not get pulled across the network.
   */
  static readonly DEFAULT_HARD_CEILING_BYTES = 50 * 1024 * 1024;

  /** Every 2 minutes (6-field cron; product decision, 12 Jun 2026). */
  static readonly DEFAULT_CRON = '0 */2 * * * *';

  /**
   * Matches the seed script's plant folders so the zero-setup quickstart
   * (`npm run seed:local && npm run poll:sftp`) works without a .env.
   * Real deployments always set SFTP_INCOMING_PATHS explicitly.
   */
  static readonly DEFAULT_INCOMING_PATHS = '/incoming/welland,/incoming/saltillo';

  constructor(
    @Inject(SFTP_CLIENT_FACTORY) private readonly factory: SftpClientFactory,
    private readonly preProcessing: PreProcessingService,
    private readonly schedulerRegistry: SchedulerRegistry,
    config: ConfigService,
  ) {
    this.incomingPaths = (
      config.get<string>('SFTP_INCOMING_PATHS', SftpIngestionService.DEFAULT_INCOMING_PATHS) ||
      SftpIngestionService.DEFAULT_INCOMING_PATHS
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.graceMs = Number(config.get<string>('SFTP_PARTIAL_WRITE_GRACE_MS', '30000'));
    this.hardCeilingBytes = Number(
      config.get<string>(
        'SFTP_HARD_CEILING_BYTES',
        String(SftpIngestionService.DEFAULT_HARD_CEILING_BYTES),
      ),
    );
    this.cronExpression =
      config.get<string>('SFTP_POLL_CRON', SftpIngestionService.DEFAULT_CRON) ||
      SftpIngestionService.DEFAULT_CRON;
  }

  onModuleInit(): void {
    const job = new CronJob(this.cronExpression, () => {
      void this.pollAllPaths();
    });
    this.schedulerRegistry.addCronJob('sftp-poll', job);
    job.start();
    this.logger.log(`SFTP cron registered (expression: "${this.cronExpression}")`);
  }

  async pollAllPaths(): Promise<void> {
    for (const remotePath of this.incomingPaths) {
      await this.pollPath(remotePath);
    }
  }

  /** Public so the demo runner / tests can drive a single poll. */
  async pollPath(remotePath: string): Promise<void> {
    let client: SftpClient;
    try {
      client = await this.factory.connect();
    } catch (err) {
      this.logger.error(`SFTP connect failed: ${(err as Error).message}`);
      return;
    }

    try {
      const files = await client.list(remotePath);
      const cutoff = Date.now() - this.graceMs;

      for (const file of files) {
        if (file.modifiedAtMs > cutoff) {
          this.logger.debug(
            `Skip ${file.name} (modified <${this.graceMs}ms ago, may still be writing)`,
          );
          continue;
        }
        if (file.sizeBytes > this.hardCeilingBytes) {
          // Bandwidth guard for pathological cases only -- legitimate
          // oversize files (just above MAX_FILE_BYTES) are downloaded and
          // quarantined by pre-processing for an audit trail.
          this.logger.warn(
            `Skip ${file.name} (${file.sizeBytes} bytes exceeds SFTP hard ceiling ${this.hardCeilingBytes}; left on SFTP, NOT quarantined)`,
          );
          continue;
        }
        // Give up (after an alert) on files that have already exhausted their
        // transient-retry budget, so a permanently-failing file can't loop.
        if (
          (this.transientAttempts.get(file.path) ?? 0) >=
          SftpIngestionService.MAX_TRANSIENT_ATTEMPTS
        ) {
          continue;
        }
        await this.processFile(client, remotePath, file);
      }
    } catch (err) {
      this.logger.error(`SFTP poll error for ${remotePath}: ${(err as Error).message}`);
    } finally {
      try {
        await client.disconnect();
      } catch (err) {
        this.logger.debug(`SFTP disconnect failed (ignored): ${(err as Error).message}`);
      }
    }
  }

  private async processFile(
    client: SftpClient,
    remoteDir: string,
    file: SftpRemoteFile,
  ): Promise<void> {
    let buffer: Buffer;
    try {
      buffer = await client.get(file.path);
    } catch (err) {
      // Transient: leave on SFTP, retry next poll (bounded).
      this.recordTransientFailure(file.path, `download error: ${(err as Error).message}`);
      return;
    }

    let permanentlyRejected = false;
    try {
      await this.preProcessing.validateAndHandoff(buffer, {
        sourceChannel: 'sftp',
        originalName: file.name,
        sourceMeta: {
          remotePath: file.path,
          remoteDir,
          plantCode: this.guessPlantCode(remoteDir),
          modifiedAtMs: file.modifiedAtMs,
          sizeBytes: file.sizeBytes,
        },
      });
    } catch (err) {
      if (err instanceof IngestionError) {
        // Permanent: pre-processing has already written the buffer to
        // quarantine with the rejection reason. Delete from SFTP
        // so we don't re-quarantine the same file on every poll.
        permanentlyRejected = true;
        this.transientAttempts.delete(file.path);
        this.logger.warn(
          `Rejected ${file.path} (${err.code}): quarantined by pre-processing, deleting from SFTP.`,
        );
      } else {
        // Transient (blob backend down, etc.) -- leave on SFTP for retry (bounded).
        this.recordTransientFailure(file.path, (err as Error).message);
        return;
      }
    }

    // Success (or permanent reject) -- clear any transient counter.
    this.transientAttempts.delete(file.path);

    try {
      await client.delete(file.path);
    } catch (err) {
      const note = permanentlyRejected
        ? 'Quarantine record exists; next poll will re-quarantine until the file is removed.'
        : 'Dedup hash will catch the re-poll.';
      this.logger.warn(`Delete failed for ${file.path}: ${(err as Error).message}. ${note}`);
    }
  }

  /**
   * Record a transient failure for a file and, once the retry budget is
   * exhausted, raise a single ops alert. The poll loop then skips the file so
   * it can't retry indefinitely (PRD ING-03).
   */
  private recordTransientFailure(filePath: string, detail: string): void {
    const attempts = (this.transientAttempts.get(filePath) ?? 0) + 1;
    this.transientAttempts.set(filePath, attempts);
    const max = SftpIngestionService.MAX_TRANSIENT_ATTEMPTS;
    if (attempts >= max) {
      this.logger.error(
        `[OPS ALERT] SFTP ingestion gave up on ${filePath} after ${attempts} transient failures (last: ${detail}). Left on SFTP for manual intervention.`,
      );
    } else {
      this.logger.warn(
        `Transient failure (${attempts}/${max}) for ${filePath}: ${detail} -- leaving on SFTP for retry.`,
      );
    }
  }

  /**
   * Best-effort plant code inference from the remote folder, e.g.
   * `/incoming/welland/...` -> "WELLAND". Useful metadata for Manav's
   * Epicor sync; not a hard requirement.
   */
  private guessPlantCode(remoteDir: string): string | null {
    const segments = remoteDir.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last || last === 'incoming') return null;
    return last.toUpperCase();
  }
}
