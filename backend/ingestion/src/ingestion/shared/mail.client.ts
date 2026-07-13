/**
 * Transport-agnostic mailbox abstraction for ING-02.
 *
 * Intentionally protocol-free: only the operations the polling service
 * actually performs. Both the IMAP adapter (Gmail demo) and the future
 * Microsoft Graph adapter (Martinrea production) implement this same
 * interface, so EmailIngestionService never needs to change.
 *
 * Was previously named `GraphClient` -- renamed because the protocol is
 * incidental.
 */
export interface MailAttachment {
  id: string;
  name: string;
  contentType: string;
  contentBytes: Buffer;
}

export interface MailMessage {
  id: string;
  mailbox: string;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  attachments: MailAttachment[];
}

export type MailDestinationFolder = 'AP-Processed' | 'AP-No-Attachment' | 'AP-Failed';

export interface MailClient {
  /** Fetch unread messages with attachments for the given mailbox. */
  fetchUnreadWithAttachments(mailbox: string): Promise<MailMessage[]>;
  /** Mark a message as read AND move it into the named destination folder. */
  markReadAndMove(
    mailbox: string,
    messageId: string,
    destinationFolder: MailDestinationFolder,
  ): Promise<void>;
}

export const MAIL_CLIENT = Symbol('MailClient');
