/**
 * Triggers a single email poll on demand. Useful for ops to force a tick
 * outside the EMAIL_POLL_CRON schedule (incident response, demos, manual
 * catch-up after a Graph outage).
 *
 *   npm run poll:email
 *
 * Boots the Nest application context (no HTTP listener), runs one
 * EmailIngestionService.pollAllMailboxes(), then exits. Any uploaded
 * documents land wherever BLOB_UPLOAD_CLIENT is configured to write
 * (Azure Blob / Roshni's API) -- inspect them there, not on disk.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { EmailIngestionService } from '../src/ingestion/email/email-ingestion.service';

const log = new Logger('PollEmailOnce');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  log.log(`Mailboxes: ${process.env.MAIL_AP_MAILBOXES ?? '(none)'}`);
  await app.get(EmailIngestionService).pollAllMailboxes();
  log.log('Email poll complete.');

  await app.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
