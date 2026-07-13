import { Logger } from '@nestjs/common';
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { MailAttachment, MailClient, MailDestinationFolder, MailMessage } from '../../shared';

export interface GraphMailClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

interface GraphMessage {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } };
}

interface GraphAttachment {
  '@odata.type'?: string;
  id: string;
  name?: string;
  contentType?: string;
  contentBytes?: string;
}

interface GraphFolder {
  id: string;
  displayName: string;
}

/**
 * Microsoft Graph MailClient -- the FUTURE production transport
 * (MAIL_TRANSPORT=graph), for when Martinrea's M365 tenant, app
 * registration and AP mailboxes are provisioned (NEEDS.md section 2.1).
 * Until then the demo runs on ImapMailClient against the dummy Gmail inbox.
 *
 * App-only auth (client credentials); token acquisition and refresh are
 * handled by @azure/identity. Fails loudly at construction if credentials
 * are missing.
 */
export class GraphMailClient implements MailClient {
  private readonly logger = new Logger(GraphMailClient.name);
  private readonly client: Client;
  /** displayName -> folder id, cached per mailbox to avoid re-listing. */
  private readonly folderCache = new Map<string, string>();

  constructor(options: GraphMailClientOptions) {
    if (!options.tenantId || !options.clientId || !options.clientSecret) {
      throw new Error(
        'GraphMailClient requires GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET. ' +
          'Set them in .env or switch MAIL_TRANSPORT to "imap" or "local".',
      );
    }

    const credential = new ClientSecretCredential(
      options.tenantId,
      options.clientId,
      options.clientSecret,
    );
    this.client = Client.initWithMiddleware({
      authProvider: new TokenCredentialAuthenticationProvider(credential, {
        scopes: ['https://graph.microsoft.com/.default'],
      }),
    });
  }

  async fetchUnreadWithAttachments(mailbox: string): Promise<MailMessage[]> {
    const response = (await this.client
      .api(`/users/${mailbox}/mailFolders/inbox/messages`)
      .filter('isRead eq false')
      .select('id,subject,receivedDateTime,from,hasAttachments')
      .top(25)
      .get()) as { value: (GraphMessage & { hasAttachments?: boolean })[] };

    const messages: MailMessage[] = [];
    for (const msg of response.value ?? []) {
      const attachments = msg.hasAttachments ? await this.fetchAttachments(mailbox, msg.id) : [];
      messages.push({
        id: msg.id,
        mailbox,
        fromAddress: msg.from?.emailAddress?.address ?? 'unknown',
        subject: msg.subject ?? '(no subject)',
        receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
        attachments,
      });
    }
    return messages;
  }

  async markReadAndMove(
    mailbox: string,
    messageId: string,
    destinationFolder: MailDestinationFolder,
  ): Promise<void> {
    await this.client.api(`/users/${mailbox}/messages/${messageId}`).patch({ isRead: true });
    const folderId = await this.ensureFolder(mailbox, destinationFolder);
    await this.client
      .api(`/users/${mailbox}/messages/${messageId}/move`)
      .post({ destinationId: folderId });
  }

  private async fetchAttachments(mailbox: string, messageId: string): Promise<MailAttachment[]> {
    const response = (await this.client
      .api(`/users/${mailbox}/messages/${messageId}/attachments`)
      .get()) as { value: GraphAttachment[] };

    return (response.value ?? [])
      .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes)
      .map((a) => ({
        id: a.id,
        name: a.name ?? 'attachment',
        contentType: a.contentType ?? 'application/octet-stream',
        // Graph returns fileAttachment payloads base64-encoded; decode to a
        // buffer here so downstream never touches the wire format.
        contentBytes: Buffer.from(a.contentBytes as string, 'base64'),
      }));
  }

  private async ensureFolder(mailbox: string, displayName: string): Promise<string> {
    const cacheKey = `${mailbox}:${displayName}`;
    const cached = this.folderCache.get(cacheKey);
    if (cached) return cached;

    const listed = (await this.client
      .api(`/users/${mailbox}/mailFolders`)
      .filter(`displayName eq '${displayName}'`)
      .get()) as { value: GraphFolder[] };

    let folderId = listed.value?.[0]?.id;
    if (!folderId) {
      const created = (await this.client
        .api(`/users/${mailbox}/mailFolders`)
        .post({ displayName })) as GraphFolder;
      folderId = created.id;
      this.logger.log(`[${mailbox}] created mail folder "${displayName}"`);
    }

    this.folderCache.set(cacheKey, folderId);
    return folderId;
  }
}
