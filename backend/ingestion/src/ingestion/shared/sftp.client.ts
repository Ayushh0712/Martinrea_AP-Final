/**
 * Minimal abstraction over an SFTP server for ING-03.
 *
 * Real implementation = `ssh2-sftp-client`.
 * Local implementation polls a local directory so the same logic can run
 * without any SFTP daemon installed.
 */
export interface SftpRemoteFile {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

export interface SftpClient {
  list(remotePath: string): Promise<SftpRemoteFile[]>;
  get(remotePath: string): Promise<Buffer>;
  delete(remotePath: string): Promise<void>;
  /**
   * Release the underlying connection (best-effort). MUST be called by the
   * polling service at the end of every poll because long-lived SSH
   * connections die silently behind corporate firewalls.
   *
   * Adapters that have nothing to tear down implement this as a no-op.
   */
  disconnect(): Promise<void>;
}

/**
 * Factory creates a connected SftpClient and tears it down per-poll.
 * Long-lived SFTP connections die in weird ways through corporate firewalls;
 * always connect-per-poll.
 */
export interface SftpClientFactory {
  connect(): Promise<SftpClient>;
}

export const SFTP_CLIENT_FACTORY = Symbol('SftpClientFactory');
