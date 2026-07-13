import * as fs from 'fs/promises';
import * as path from 'path';
import { SftpClient, SftpClientFactory, SftpRemoteFile } from '../../shared';

/**
 * Filesystem-backed SftpClient for INGESTION_PROFILE=local.
 *
 * Remote paths like `/incoming/welland` map onto local directories under
 * LOCAL_SFTP_DIR, e.g. `<baseDir>/incoming/welland/`. The polling service
 * is identical for local and real SFTP -- only this transport differs.
 */
class LocalSftpClient implements SftpClient {
  constructor(private readonly baseDir: string) {}

  async list(remotePath: string): Promise<SftpRemoteFile[]> {
    const dir = this.toLocal(remotePath);

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return []; // directory not seeded yet -- treat as empty
    }

    const files: SftpRemoteFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const stat = await fs.stat(path.join(dir, entry.name));
      files.push({
        name: entry.name,
        path: posixJoin(remotePath, entry.name),
        sizeBytes: stat.size,
        modifiedAtMs: stat.mtimeMs,
      });
    }
    return files;
  }

  async get(remotePath: string): Promise<Buffer> {
    return fs.readFile(this.toLocal(remotePath));
  }

  async delete(remotePath: string): Promise<void> {
    await fs.unlink(this.toLocal(remotePath));
  }

  async disconnect(): Promise<void> {
    // Nothing to tear down for the filesystem transport.
  }

  private toLocal(remotePath: string): string {
    return path.join(this.baseDir, ...remotePath.split('/').filter(Boolean));
  }
}

function posixJoin(...segments: string[]): string {
  return '/' + segments.flatMap((s) => s.split('/').filter(Boolean)).join('/');
}

export class LocalSftpClientFactory implements SftpClientFactory {
  constructor(private readonly baseDir: string) {}

  async connect(): Promise<SftpClient> {
    return new LocalSftpClient(this.baseDir);
  }
}
