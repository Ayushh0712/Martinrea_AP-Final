import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import {
  MAIL_CLIENT,
  MailClient,
  MailMessage,
  BLOB_UPLOAD_CLIENT,
  StorageUnavailableError,
} from '../shared';
import { PreProcessingService } from '../pre-processing/pre-processing.service';
import { EmailIngestionService } from './email-ingestion.service';
import { makeJpeg, makePdf } from '../../../test/fixtures/file-bytes';

class FakeMail implements MailClient {
  public moves: Array<{ mailbox: string; messageId: string; folder: string }> = [];
  constructor(private readonly inbox: Map<string, MailMessage[]>) {}
  async fetchUnreadWithAttachments(mailbox: string): Promise<MailMessage[]> {
    return this.inbox.get(mailbox) ?? [];
  }
  async markReadAndMove(
    mailbox: string,
    messageId: string,
    destinationFolder: 'AP-Processed' | 'AP-No-Attachment' | 'AP-Failed',
  ): Promise<void> {
    this.moves.push({ mailbox, messageId, folder: destinationFolder });
  }
}

class FakeBlob {
  public uploaded: Array<{ name: string; channel: string }> = [];
  async upload(doc: { metadata: { originalName: string; sourceChannel: string } }) {
    this.uploaded.push({ name: doc.metadata.originalName, channel: doc.metadata.sourceChannel });
    return { documentId: `doc-${this.uploaded.length}`, blobPath: 'x', isDuplicate: false };
  }
  async quarantine(): Promise<void> {
    /* noop */
  }
}

/** Blob client that always fails the upload transiently (storage down). */
class TransientBlob {
  public quarantined = 0;
  async upload(): Promise<never> {
    throw new StorageUnavailableError('bucket unreachable');
  }
  async quarantine(): Promise<void> {
    this.quarantined += 1;
  }
}

const buildModule = async (
  mail: FakeMail,
  mailboxes: string,
  blob: unknown = new FakeBlob(),
) => {
  const env: Record<string, string> = {
    MAX_FILE_BYTES: '10485760',
    ALLOWED_MIME_TYPES: 'application/pdf,image/jpeg,image/png,image/tiff,application/xml,text/xml',
    MAIL_AP_MAILBOXES: mailboxes,
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      EmailIngestionService,
      PreProcessingService,
      { provide: MAIL_CLIENT, useValue: mail },
      { provide: BLOB_UPLOAD_CLIENT, useValue: blob },
      { provide: ConfigService, useValue: { get: (k: string, d?: string) => env[k] ?? d } },
      // onModuleInit is not invoked in these tests (.compile() not .init()),
      // but the constructor still requires SchedulerRegistry.
      { provide: SchedulerRegistry, useValue: new SchedulerRegistry() },
    ],
  }).compile();
  return moduleRef;
};

describe('EmailIngestionService', () => {
  it('ingests attachments from a single mailbox and moves the message to AP-Processed', async () => {
    const inbox = new Map<string, MailMessage[]>([
      [
        'ap-mexico@martinrea.local',
        [
          {
            id: 'msg-1',
            mailbox: 'ap-mexico@martinrea.local',
            fromAddress: 'billing@acerotijuana.mx',
            subject: 'Factura 2026-04321',
            receivedAt: new Date(),
            attachments: [
              {
                id: 'a1',
                name: 'factura.pdf',
                contentType: 'application/pdf',
                contentBytes: makePdf(),
              },
              { id: 'a2', name: 'photo.jpg', contentType: 'image/jpeg', contentBytes: makeJpeg() },
            ],
          },
        ],
      ],
    ]);
    const mail = new FakeMail(inbox);
    const moduleRef = await buildModule(mail, 'ap-mexico@martinrea.local');
    const service = moduleRef.get(EmailIngestionService);
    const blob = moduleRef.get(BLOB_UPLOAD_CLIENT) as unknown as FakeBlob;

    await service.pollAllMailboxes();

    expect(blob.uploaded).toHaveLength(2);
    expect(blob.uploaded[0].channel).toBe('email');
    expect(mail.moves).toEqual([
      { mailbox: 'ap-mexico@martinrea.local', messageId: 'msg-1', folder: 'AP-Processed' },
    ]);
  });

  it('moves messages with no attachments to AP-No-Attachment', async () => {
    const inbox = new Map<string, MailMessage[]>([
      [
        'ap-canada@martinrea.local',
        [
          {
            id: 'msg-empty',
            mailbox: 'ap-canada@martinrea.local',
            fromAddress: 'someone@vendor.com',
            subject: 'thoughts on the weather',
            receivedAt: new Date(),
            attachments: [],
          },
        ],
      ],
    ]);
    const mail = new FakeMail(inbox);
    const moduleRef = await buildModule(mail, 'ap-canada@martinrea.local');
    const service = moduleRef.get(EmailIngestionService);
    await service.pollAllMailboxes();
    expect(mail.moves[0].folder).toBe('AP-No-Attachment');
  });

  it('moves messages where every attachment was rejected to AP-Failed', async () => {
    const garbage = Buffer.from('not-a-real-file');
    const inbox = new Map<string, MailMessage[]>([
      [
        'ap-us@martinrea.local',
        [
          {
            id: 'msg-bad',
            mailbox: 'ap-us@martinrea.local',
            fromAddress: 'sketchy@vendor.com',
            subject: 'invoice (i swear)',
            receivedAt: new Date(),
            attachments: [
              {
                id: 'a1',
                name: 'invoice.pdf',
                contentType: 'application/pdf',
                contentBytes: garbage,
              },
            ],
          },
        ],
      ],
    ]);
    const mail = new FakeMail(inbox);
    const moduleRef = await buildModule(mail, 'ap-us@martinrea.local');
    const service = moduleRef.get(EmailIngestionService);
    await service.pollAllMailboxes();
    expect(mail.moves[0].folder).toBe('AP-Failed');
  });

  it('does nothing (gracefully) when MAIL_AP_MAILBOXES is empty', async () => {
    const mail = new FakeMail(new Map());
    const moduleRef = await buildModule(mail, '');
    const service = moduleRef.get(EmailIngestionService);
    await service.pollAllMailboxes();
    expect(mail.moves).toEqual([]);
  });

  it('leaves the message unread (no move) on a transient storage failure', async () => {
    const inbox = new Map<string, MailMessage[]>([
      [
        'ap-us@martinrea.local',
        [
          {
            id: 'msg-transient',
            mailbox: 'ap-us@martinrea.local',
            fromAddress: 'billing@vendor.com',
            subject: 'invoice',
            receivedAt: new Date(),
            attachments: [
              {
                id: 'a1',
                name: 'invoice.pdf',
                contentType: 'application/pdf',
                contentBytes: makePdf(),
              },
            ],
          },
        ],
      ],
    ]);
    const mail = new FakeMail(inbox);
    const moduleRef = await buildModule(mail, 'ap-us@martinrea.local', new TransientBlob());
    const service = moduleRef.get(EmailIngestionService);

    await service.pollAllMailboxes();

    // A transient blob outage must NOT move the message to AP-Failed/Processed;
    // it stays unread so the next poll retries it.
    expect(mail.moves).toEqual([]);
  });
});
