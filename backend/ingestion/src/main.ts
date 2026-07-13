import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Load .env with `override: true` so the file is authoritative for transport
// selection (BLOB_TRANSPORT / MAIL_TRANSPORT / SFTP_TRANSPORT). Without this, a
// stray inherited env var in the launching shell (e.g. BLOB_TRANSPORT=local)
// silently shadows the .env value and the service writes uploads to the wrong
// backend — which strands portal uploads in local storage instead of the OCI
// bucket the OCR poller scans.
loadEnv({ override: true });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Frontend (and other browsers) must be allowed to call the portal-upload
  // endpoint. Origins are env-driven (comma-separated) to match the rest of
  // the linked stack.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Distinct default port (3002) so ingestion, workflow-service (3001)
  // and the frontend (3000) coexist.
  const port = Number(process.env.PORT ?? 3002);
  await app.listen(port);
  Logger.log(`Ingestion service listening on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Profile: ${process.env.INGESTION_PROFILE ?? 'local'}`, 'Bootstrap');
}

void bootstrap();
