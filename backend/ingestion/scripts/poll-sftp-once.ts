/**
 * Triggers a single SFTP poll on demand. Useful for ops to force a tick
 * outside the SFTP_POLL_CRON schedule (incident response, manual
 * catch-up after a partner pushed a batch).
 *
 *   npm run poll:sftp
 *
 * Boots the Nest application context (no HTTP listener), runs one
 * SftpIngestionService.pollAllPaths(), then exits. Any uploaded
 * documents land wherever BLOB_UPLOAD_CLIENT is configured to write
 * (Azure Blob / Roshni's API) -- inspect them there, not on disk.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { SftpIngestionService } from '../src/ingestion/sftp/sftp-ingestion.service';

const log = new Logger('PollSftpOnce');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  log.log(`SFTP paths: ${process.env.SFTP_INCOMING_PATHS ?? '(none)'}`);
  await app.get(SftpIngestionService).pollAllPaths();
  log.log('SFTP poll complete.');

  await app.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
