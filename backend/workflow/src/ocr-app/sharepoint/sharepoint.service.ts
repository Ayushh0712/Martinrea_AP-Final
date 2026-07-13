import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DriveChild, GraphDriveClient } from './graph-drive.client';

export interface SpObject {
  /** Path relative to the configured root folder, e.g. `raw/<hash>-<name>`. */
  name: string;
  size?: number;
  timeModified?: string;
  /** Pre-authenticated download URL (when listing returned one). */
  downloadUrl?: string;
}

/**
 * SharePoint / OneDrive (Microsoft Graph) read access for the OCR pipeline.
 *
 * The ingestion service's SharePointBlobUploader writes validated documents to
 * <root>/raw/. This service is the OCR-side counterpart of OciService: it lists
 * and downloads those objects so the SharePointAutoIngestService can pull NEW
 * ones into the pipeline. Disabled (no-op) unless SP_DRIVE_ID + the Graph app
 * credentials are configured.
 */
@Injectable()
export class SharePointService {
  private readonly logger = new Logger(SharePointService.name);
  private readonly rootFolder: string;
  private readonly client: GraphDriveClient | null;

  constructor(private readonly config: ConfigService) {
    const tenantId = this.config.get<string>('sharePoint.tenantId') ?? '';
    const clientId = this.config.get<string>('sharePoint.clientId') ?? '';
    const clientSecret = this.config.get<string>('sharePoint.clientSecret') ?? '';
    const driveId = this.config.get<string>('sharePoint.driveId') ?? '';
    this.rootFolder = trimSlashes(this.config.get<string>('sharePoint.rootFolder') ?? 'AP-Ingestion');

    if (tenantId && clientId && clientSecret && driveId) {
      this.client = new GraphDriveClient({ tenantId, clientId, clientSecret, driveId });
      this.logger.log(
        `SharePoint Graph drive configured (driveId=${driveId.substring(0, 12)}..., root="${this.rootFolder}")`,
      );
    } else {
      this.client = null;
      this.logger.warn(
        'SharePoint not configured (need SP_DRIVE_ID + SP_GRAPH_*/GRAPH_* creds) — Graph file listing disabled',
      );
    }
  }

  isConfigured(): boolean {
    return this.client != null;
  }

  /** List supported document files under <root>/<prefix>. */
  async listDocuments(prefix = 'raw/'): Promise<SpObject[]> {
    if (!this.client) {
      throw new ServiceUnavailableException('SharePoint Graph drive not configured');
    }
    const SUPPORTED = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff']);
    const cleanPrefix = trimSlashes(prefix);
    const folderPath = cleanPrefix ? `${this.rootFolder}/${cleanPrefix}` : this.rootFolder;

    const children = await this.client.listChildren(folderPath);
    return children
      .filter((c: DriveChild) => !c.isFolder && SUPPORTED.has(path.extname(c.name).toLowerCase()))
      .map((c) => ({
        // Keep the prefix in the name so downstream basename/dedup matches OCI.
        name: cleanPrefix ? `${cleanPrefix}/${c.name}` : c.name,
        size: c.size,
        timeModified: c.lastModified,
        downloadUrl: c.downloadUrl,
      }));
  }

  /**
   * Download an object (path relative to root, e.g. `raw/<hash>-<name>`) to a
   * local temporary file. Returns the local path so OCR can process it.
   */
  async downloadToTmp(objectName: string, localDir: string, downloadUrl?: string): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException('SharePoint Graph drive not configured');
    }
    const ext = path.extname(objectName) || '.bin';
    const tmpName = `sp-${Date.now()}-${objectName.replace(/[^a-zA-Z0-9._-]/g, '_')}${ext.startsWith('.') ? '' : ext}`;
    const localPath = path.join(localDir, path.basename(tmpName));

    this.logger.log(`Downloading SharePoint object: ${objectName} -> ${localPath}`);
    await fs.mkdir(localDir, { recursive: true });

    // Prefer the short-lived pre-authenticated URL from the listing (no token);
    // fall back to an authenticated content GET by path.
    const buffer = downloadUrl
      ? await this.client.downloadFromUrl(downloadUrl, `download ${objectName}`)
      : await this.client.download(`${this.rootFolder}/${objectName}`);

    await fs.writeFile(localPath, buffer);
    this.logger.log(`Downloaded ${objectName} (${buffer.length} bytes)`);
    return localPath;
  }
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
