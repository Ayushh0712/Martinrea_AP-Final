import * as fs from 'fs/promises';
import * as path from 'path';
import { MailAttachment, MailClient, MailDestinationFolder, MailMessage } from '../../shared';

/**
 * Filesystem-backed MailClient for INGESTION_PROFILE=local.
 *
 * Maildir-style layout under LOCAL_MAILDIR:
 *
 *   <baseDir>/<mailbox>/<message-id>/            <- one folder per "unread" message
 *   <baseDir>/<mailbox>/<message-id>/meta.json   <- optional { fromAddress, subject, receivedAt }
 *   <baseDir>/<mailbox>/<message-id>/invoice.pdf <- every other file = attachment
 *   <baseDir>/<mailbox>/AP-Processed/<message-id>/    <- after markReadAndMove
 *
 * Folders whose names start with "AP-" are destination folders, never
 * treated as unread messages. The seed script (npm run seed:local) creates
 * this layout with sample invoices.
 */
export class LocalMailClient implements MailClient {
  constructor(private readonly baseDir: string) {}

  async fetchUnreadWithAttachments(mailbox: string): Promise<MailMessage[]> {
    const mailboxDir = path.join(this.baseDir, sanitizeMailbox(mailbox));

    let entries;
    try {
      entries = await fs.readdir(mailboxDir, { withFileTypes: true });
    } catch {
      return []; // mailbox dir doesn't exist yet -- nothing to ingest
    }

    const messages: MailMessage[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('AP-')) continue;
      messages.push(await this.readMessage(mailbox, mailboxDir, entry.name));
    }
    return messages;
  }

  async markReadAndMove(
    mailbox: string,
    messageId: string,
    destinationFolder: MailDestinationFolder,
  ): Promise<void> {
    const mailboxDir = path.join(this.baseDir, sanitizeMailbox(mailbox));
    const src = path.join(mailboxDir, messageId);
    const destDir = path.join(mailboxDir, destinationFolder);
    await fs.mkdir(destDir, { recursive: true });
    await fs.rename(src, path.join(destDir, messageId));
  }

  private async readMessage(
    mailbox: string,
    mailboxDir: string,
    messageId: string,
  ): Promise<MailMessage> {
    const messageDir = path.join(mailboxDir, messageId);
    const files = await fs.readdir(messageDir, { withFileTypes: true });

    let meta: { fromAddress?: string; subject?: string; receivedAt?: string } = {};
    const attachments: MailAttachment[] = [];

    for (const file of files) {
      if (!file.isFile()) continue;
      if (file.name === 'meta.json') {
        try {
          meta = JSON.parse(await fs.readFile(path.join(messageDir, file.name), 'utf8'));
        } catch {
          // malformed meta.json -- fall back to defaults
        }
        continue;
      }
      attachments.push({
        id: file.name,
        name: file.name,
        contentType: guessContentType(file.name),
        contentBytes: await fs.readFile(path.join(messageDir, file.name)),
      });
    }

    return {
      id: messageId,
      mailbox,
      fromAddress: meta.fromAddress ?? 'vendor@example.com',
      subject: meta.subject ?? messageId,
      receivedAt: meta.receivedAt ? new Date(meta.receivedAt) : new Date(),
      attachments,
    };
  }
}

/** Mailbox addresses contain characters Windows dislikes in dir names. */
function sanitizeMailbox(mailbox: string): string {
  return mailbox.replace(/[^a-zA-Z0-9.@_-]/g, '_');
}

/**
 * Best-effort content type from extension. Purely informational --
 * PreProcessingService re-detects by magic bytes and trusts only that.
 */
function guessContentType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.xml': 'application/xml',
  };
  return map[ext] ?? 'application/octet-stream';
}
