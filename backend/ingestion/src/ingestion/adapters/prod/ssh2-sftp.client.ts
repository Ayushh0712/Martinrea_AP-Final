import SftpClientImpl from 'ssh2-sftp-client';
import { SftpClient, SftpClientFactory, SftpRemoteFile } from '../../shared';

export interface Ssh2SftpOptions {
  host: string;
  port: number;
  username: string;
  /** PEM-encoded private key. In real prod, pulled from Key Vault at startup. */
  privateKey: string;
}

/**
 * ssh2-sftp-client transport (SFTP_TRANSPORT=ssh2) -- for when the real
 * SFTP drop server exists (NEEDS.md section 2.2). The demo phase uses
 * LocalSftpClientFactory against a local folder instead.
 *
 * connect() opens a fresh connection per poll and disconnect() tears it
 * down -- long-lived SFTP connections die silently behind corporate
 * firewalls, so the polling service always reconnects.
 */
class Ssh2SftpClient implements SftpClient {
  constructor(private readonly sftp: SftpClientImpl) {}

  async list(remotePath: string): Promise<SftpRemoteFile[]> {
    const entries = await this.sftp.list(remotePath);
    return entries
      .filter((e) => e.type === '-')
      .map((e) => ({
        name: e.name,
        path: `${remotePath.replace(/\/+$/, '')}/${e.name}`,
        sizeBytes: e.size,
        modifiedAtMs: e.modifyTime,
      }));
  }

  async get(remotePath: string): Promise<Buffer> {
    const result = await this.sftp.get(remotePath);
    if (Buffer.isBuffer(result)) return result;
    if (typeof result === 'string') return Buffer.from(result);
    throw new Error(`Unexpected non-buffer result downloading ${remotePath}`);
  }

  async delete(remotePath: string): Promise<void> {
    await this.sftp.delete(remotePath);
  }

  async disconnect(): Promise<void> {
    await this.sftp.end();
  }
}

export class Ssh2SftpClientFactory implements SftpClientFactory {
  constructor(private readonly options: Ssh2SftpOptions) {
    if (!options.host || !options.username || !options.privateKey) {
      throw new Error(
        'Ssh2SftpClientFactory requires SFTP_HOST, SFTP_USERNAME and SFTP_PRIVATE_KEY. ' +
          'Set them in .env or switch SFTP_TRANSPORT to "local".',
      );
    }
  }

  async connect(): Promise<SftpClient> {
    const sftp = new SftpClientImpl();
    await sftp.connect({
      host: this.options.host,
      port: this.options.port,
      username: this.options.username,
      privateKey: this.options.privateKey,
    });
    return new Ssh2SftpClient(sftp);
  }
}
