import { Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { MailAttachment, MailClient, MailDestinationFolder, MailMessage } from '../../shared';

export interface ImapMailClientOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** For Gmail this is an App Password (Google account -> Security -> App passwords). */
  password: string;
}

/**
 * IMAP-backed MailClient -- the DEMO-PHASE real transport (MAIL_TRANSPORT=imap).
 *
 * Used with the dummy Gmail AP inbox while the project runs on a laptop:
 * polls INBOX for unseen messages, parses attachments with mailparser, and
 * after processing marks the message \Seen and moves it into the
 * AP-Processed / AP-No-Attachment / AP-Failed folder (Gmail renders these
 * as labels). Folders are created on first use.
 *
 * Connection strategy: connect-per-operation. A poll touches the server a
 * handful of times, and short-lived connections survive flaky hotel/office
 * wifi far better than a long-lived socket. Swap to GraphMailClient
 * (MAIL_TRANSPORT=graph) when Martinrea's M365 tenant is provisioned.
 *
 * The `mailbox` argument from MAIL_AP_MAILBOXES is attribution metadata
 * here -- the connection always uses the configured IMAP account, so set
 * MAIL_AP_MAILBOXES to that same Gmail address.
 */
export class ImapMailClient implements MailClient {
  private readonly logger = new Logger(ImapMailClient.name);

  constructor(private readonly options: ImapMailClientOptions) {
    if (!options.host || !options.user || !options.password) {
      throw new Error(
        'ImapMailClient requires IMAP_HOST, IMAP_USER and IMAP_PASSWORD (Gmail App Password). ' +
          'Set them in .env or switch MAIL_TRANSPORT to "local".',
      );
    }
  }

  async fetchUnreadWithAttachments(mailbox: string): Promise<MailMessage[]> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        if (!uids || uids.length === 0) return [];

        const messages: MailMessage[] = [];
        for (const uid of uids) {
          const fetched = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!fetched || !fetched.source) {
            this.logger.warn(`UID ${uid}: could not fetch message source, skipping`);
            continue;
          }
          const parsed = await simpleParser(fetched.source);

          const attachments: MailAttachment[] = (parsed.attachments ?? [])
            .filter((a) => a.content && a.content.length > 0)
            .map((a, i) => ({
              id: a.checksum ?? `${uid}-att-${i}`,
              name: a.filename ?? `attachment-${i}`,
              contentType: a.contentType ?? 'application/octet-stream',
              contentBytes: a.content,
            }));

          messages.push({
            id: String(uid),
            mailbox,
            fromAddress: parsed.from?.value?.[0]?.address ?? 'unknown',
            subject: parsed.subject ?? '(no subject)',
            receivedAt: parsed.date ?? new Date(),
            attachments,
          });
        }
        return messages;
      } finally {
        lock.release();
      }
    });
  }

  async markReadAndMove(
    _mailbox: string,
    messageId: string,
    destinationFolder: MailDestinationFolder,
  ): Promise<void> {
    await this.withConnection(async (client) => {
      await this.ensureFolder(client, destinationFolder);
      const lock = await client.getMailboxLock('INBOX');
      try {
        await client.messageFlagsAdd(messageId, ['\\Seen'], { uid: true });
        await client.messageMove(messageId, destinationFolder, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  private async ensureFolder(client: ImapFlow, folder: string): Promise<void> {
    try {
      await client.mailboxCreate(folder);
    } catch {
      // Already exists -- the common case after the first poll.
    }
  }

  private async withConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth: { user: this.options.user, pass: this.options.password },
      logger: false,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      try {
        await client.logout();
      } catch {
        // Best-effort teardown; the socket dies with the process anyway.
      }
    }
  }
}
