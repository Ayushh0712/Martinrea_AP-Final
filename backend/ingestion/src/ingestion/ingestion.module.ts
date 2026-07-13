import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PreProcessingService } from './pre-processing/pre-processing.service';
import { EmailIngestionService } from './email/email-ingestion.service';
import { SftpIngestionService } from './sftp/sftp-ingestion.service';
import { PortalIngestionController } from './portal/portal-ingestion.controller';
import { HealthController } from './health/health.controller';
import {
  BLOB_UPLOAD_CLIENT,
  BlobUploadClient,
  MAIL_CLIENT,
  MailClient,
  SFTP_CLIENT_FACTORY,
  SftpClientFactory,
} from './shared';
import { LocalBlobUploader } from './adapters/local/local-blob-uploader';
import { LocalMailClient } from './adapters/local/local-mail.client';
import { LocalSftpClientFactory } from './adapters/local/local-sftp.client';
import { HttpBlobUploader } from './adapters/prod/http-blob-uploader';
import { OciParBlobUploader } from './adapters/prod/oci-par-blob-uploader';
import { SharePointBlobUploader } from './adapters/prod/sharepoint-blob-uploader';
import { GraphMailClient } from './adapters/prod/graph-mail.client';
import { ImapMailClient } from './adapters/prod/imap-mail.client';
import { Ssh2SftpClientFactory } from './adapters/prod/ssh2-sftp.client';

const logger = new Logger('IngestionModule');

type MailTransport = 'local' | 'imap' | 'graph';
type BlobTransport = 'local' | 'http' | 'par' | 'sharepoint';
type SftpTransport = 'local' | 'ssh2';

/** Resolves the active profile. Defaults to `local` for zero-setup dev/demo. */
function profileOf(cfg: ConfigService): 'local' | 'prod' {
  return (cfg.get<string>('INGESTION_PROFILE') ?? 'local') === 'prod' ? 'prod' : 'local';
}

/**
 * Each channel's transport can be overridden independently, so the demo can
 * mix real and local transports (e.g. real Gmail IMAP + local file storage).
 * When the override is unset, the INGESTION_PROFILE default applies.
 */
function transportOf<T extends string>(
  cfg: ConfigService,
  envKey: string,
  prodDefault: T,
  allowed: readonly T[],
): T {
  const explicit = cfg.get<string>(envKey);
  if (explicit) {
    if (!allowed.includes(explicit as T)) {
      throw new Error(`${envKey}="${explicit}" is invalid. Allowed: ${allowed.join(', ')}`);
    }
    return explicit as T;
  }
  return profileOf(cfg) === 'prod' ? prodDefault : ('local' as T);
}

/**
 * Wires the Ingestion Epic together.
 *
 * Transport selection (set INGESTION_PROFILE for the defaults, or override
 * each channel individually):
 *
 *   MAIL_TRANSPORT = local | imap | graph                (profile default: local / graph)
 *   BLOB_TRANSPORT = local | http | par | sharepoint     (profile default: local / http)
 *   SFTP_TRANSPORT = local | ssh2                        (profile default: local / ssh2)
 *
 * Demo-phase recipe (dummy Gmail inbox + everything else on the laptop):
 *
 *   INGESTION_PROFILE=local
 *   MAIL_TRANSPORT=imap
 *   IMAP_USER=<dummy-gmail>@gmail.com
 *   IMAP_PASSWORD=<gmail app password>
 *   MAIL_AP_MAILBOXES=<dummy-gmail>@gmail.com
 *
 * Non-local adapters validate their credentials at construction and FAIL
 * LOUDLY at boot if they're missing, so a misconfigured deploy never
 * silently drops invoices. The credentials/contracts each one needs are
 * tracked in NEEDS.md.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local', '.env.production'],
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [PortalIngestionController, HealthController],
  providers: [
    PreProcessingService,
    EmailIngestionService,
    SftpIngestionService,
    {
      provide: BLOB_UPLOAD_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): BlobUploadClient => {
        const transport = transportOf<BlobTransport>(cfg, 'BLOB_TRANSPORT', 'http', [
          'local',
          'http',
          'par',
          'sharepoint',
        ]);
        if (transport === 'local') {
          const dir = cfg.get<string>('LOCAL_STORAGE_DIR', '.local-storage');
          logger.log(`BLOB_UPLOAD_CLIENT -> LocalBlobUploader (${dir})`);
          return new LocalBlobUploader(dir);
        }
        if (transport === 'sharepoint') {
          const rootFolder = cfg.get<string>('SP_ROOT_FOLDER', 'AP-Ingestion');
          const rawPrefix = cfg.get<string>('SP_RAW_PREFIX', 'raw');
          logger.log(
            `BLOB_UPLOAD_CLIENT -> SharePointBlobUploader (Graph drive, root="${rootFolder}", prefix="${rawPrefix}")`,
          );
          return new SharePointBlobUploader({
            // SharePoint may reuse the same app registration as Graph mail; the
            // SP_* keys take precedence so they can diverge if needed.
            tenantId: cfg.get<string>('SP_GRAPH_TENANT_ID') || cfg.get<string>('GRAPH_TENANT_ID', ''),
            clientId: cfg.get<string>('SP_GRAPH_CLIENT_ID') || cfg.get<string>('GRAPH_CLIENT_ID', ''),
            clientSecret:
              cfg.get<string>('SP_GRAPH_CLIENT_SECRET') || cfg.get<string>('GRAPH_CLIENT_SECRET', ''),
            driveId: cfg.get<string>('SP_DRIVE_ID', ''),
            rootFolder,
            rawPrefix,
            timeoutMs: Number(cfg.get<string>('SP_TIMEOUT_MS', '15000')),
            maxAttempts: Number(cfg.get<string>('SP_MAX_ATTEMPTS', '3')),
          });
        }
        if (transport === 'par') {
          const rawPrefix = cfg.get<string>(
            'BLOB_PAR_PREFIX',
            'AP-Accepted_Correct/',
          );
          const quarantinePrefix = cfg.get<string>(
            'BLOB_PAR_QUARANTINE_PREFIX',
            'quarantine/',
          );
          const metaPrefix = cfg.get<string>('BLOB_PAR_META_PREFIX', 'meta/');
          logger.log(
            `BLOB_UPLOAD_CLIENT -> OciParBlobUploader (OCI POC bucket, accepted="${rawPrefix}", rejected="${quarantinePrefix}", dedup="${metaPrefix}")`,
          );
          return new OciParBlobUploader(cfg.get<string>('BLOB_PAR_BASE_URL', ''), {
            timeoutMs: Number(cfg.get<string>('BLOB_PAR_TIMEOUT_MS', '15000')),
            maxAttempts: Number(cfg.get<string>('BLOB_PAR_MAX_ATTEMPTS', '3')),
            rawPrefix,
            quarantinePrefix,
            metaPrefix,
          });
        }
        logger.log('BLOB_UPLOAD_CLIENT -> HttpBlobUploader (backend document API)');
        return new HttpBlobUploader(
          cfg.get<string>('BLOB_API_BASE_URL', ''),
          cfg.get<string>('BLOB_API_AUTH_TOKEN', ''),
        );
      },
    },
    {
      provide: MAIL_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): MailClient => {
        const transport = transportOf<MailTransport>(cfg, 'MAIL_TRANSPORT', 'graph', [
          'local',
          'imap',
          'graph',
        ]);
        if (transport === 'local') {
          const dir = cfg.get<string>('LOCAL_MAILDIR', '.local-maildir');
          logger.log(`MAIL_CLIENT -> LocalMailClient (${dir})`);
          return new LocalMailClient(dir);
        }
        if (transport === 'imap') {
          logger.log('MAIL_CLIENT -> ImapMailClient (Gmail/IMAP demo inbox)');
          return new ImapMailClient({
            host: cfg.get<string>('IMAP_HOST', 'imap.gmail.com'),
            port: Number(cfg.get<string>('IMAP_PORT', '993')),
            secure: (cfg.get<string>('IMAP_SECURE', 'true') ?? 'true') !== 'false',
            user: cfg.get<string>('IMAP_USER', ''),
            password: cfg.get<string>('IMAP_PASSWORD', ''),
          });
        }
        logger.log('MAIL_CLIENT -> GraphMailClient (Microsoft Graph)');
        return new GraphMailClient({
          tenantId: cfg.get<string>('GRAPH_TENANT_ID', ''),
          clientId: cfg.get<string>('GRAPH_CLIENT_ID', ''),
          clientSecret: cfg.get<string>('GRAPH_CLIENT_SECRET', ''),
        });
      },
    },
    {
      provide: SFTP_CLIENT_FACTORY,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): SftpClientFactory => {
        const transport = transportOf<SftpTransport>(cfg, 'SFTP_TRANSPORT', 'ssh2', [
          'local',
          'ssh2',
        ]);
        if (transport === 'local') {
          const dir = cfg.get<string>('LOCAL_SFTP_DIR', '.local-sftp');
          logger.log(`SFTP_CLIENT_FACTORY -> LocalSftpClientFactory (${dir})`);
          return new LocalSftpClientFactory(dir);
        }
        logger.log('SFTP_CLIENT_FACTORY -> Ssh2SftpClientFactory');
        return new Ssh2SftpClientFactory({
          host: cfg.get<string>('SFTP_HOST', ''),
          port: Number(cfg.get<string>('SFTP_PORT', '22')),
          username: cfg.get<string>('SFTP_USERNAME', ''),
          privateKey: cfg.get<string>('SFTP_PRIVATE_KEY', ''),
        });
      },
    },
  ],
})
export class IngestionModule {}
