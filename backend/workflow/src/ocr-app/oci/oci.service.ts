import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import { promises as fs } from 'fs';
import { URL } from 'url';

export interface OciObject {
  name: string;
  size?: number;
  contentType?: string;
  timeModified?: string;
  /** Download URL (pre-authenticated, ready to use) */
  downloadUrl: string;
}

export interface OciListResult {
  objects: OciObject[];
  prefixes: string[];
}

/**
 * OCI Object Storage integration via Pre-Authenticated Request (PAR) URLs.
 *
 * A PAR URL grants time-limited, credential-free access to list and read
 * objects in a specific bucket. No OCI SDK, no configuration files needed —
 * only the PAR URL from `.env` (OCI_PAR_URL).
 *
 * Supported operations:
 *   - listObjects()  — GET <parUrl>   → JSON list of objects
 *   - downloadToTmp() — GET <parUrl><objectName> → saves to local tmp file
 */
@Injectable()
export class OciService {
  private readonly logger = new Logger(OciService.name);
  private readonly parUrl: string;

  constructor(private readonly config: ConfigService) {
    this.parUrl = (this.config.get<string>('oci.parUrl') ?? '').trim();
    if (this.parUrl) {
      this.logger.log(`OCI PAR URL configured: ${this.parUrl.substring(0, 60)}...`);
    } else {
      this.logger.warn('OCI_PAR_URL not set — OCI file listing disabled');
    }
  }

  /**
   * Build a directly-loadable view URL for an OCI object using the PAR.
   * The PAR itself is the time-limited credential (DAT-02 SAS-equivalent), so
   * this URL can be opened by the browser without app auth. Returns null when
   * OCI is not configured.
   */
  getViewUrl(objectName: string): string | null {
    if (!this.parUrl) return null;
    return this.parUrl + encodeURIComponent(objectName).replace(/%2F/g, '/');
  }

  /**
   * List all objects in the OCI bucket.
   * Filters out directory-like prefixes and non-document objects by default.
   */
  async listObjects(prefix?: string): Promise<OciListResult> {
    if (!this.parUrl) {
      throw new ServiceUnavailableException('OCI_PAR_URL not configured');
    }

    let url = this.parUrl;
    if (prefix) url += `?prefix=${encodeURIComponent(prefix)}`;

    const rawBody = await this.httpGet(url);
    const json = JSON.parse(rawBody) as {
      objects?: Array<{ name: string; size?: number; timeModified?: string }>;
      prefixes?: string[];
    };

    const objects: OciObject[] = (json.objects ?? []).map((obj) => ({
      name: obj.name,
      size: obj.size,
      timeModified: obj.timeModified,
      downloadUrl: this.parUrl + encodeURIComponent(obj.name).replace(/%2F/g, '/'),
    }));

    return {
      objects,
      prefixes: json.prefixes ?? [],
    };
  }

  /**
   * List only supported document files (PDF, JPG, JPEG, PNG, TIF, TIFF).
   */
  async listDocuments(prefix?: string): Promise<OciObject[]> {
    const SUPPORTED = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff']);
    const result = await this.listObjects(prefix);
    return result.objects.filter((o) => {
      const ext = path.extname(o.name).toLowerCase();
      return SUPPORTED.has(ext);
    });
  }

  /**
   * Upload an in-memory buffer into the OCI bucket via PAR PUT.
   * NOTE: the PAR must be created with "Permit object reads and writes" —
   * a read-only PAR fails the PUT with 401/403/404.
   */
  async putObject(
    objectName: string,
    body: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    if (!this.parUrl) {
      throw new ServiceUnavailableException('OCI_PAR_URL not configured');
    }
    const url = this.parUrl + encodeURIComponent(objectName).replace(/%2F/g, '/');
    await this.httpPut(url, body, contentType);
  }

  /** Upload a local file into the OCI bucket via PAR PUT (see putObject). */
  async uploadObject(
    objectName: string,
    localPath: string,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const body = await fs.readFile(localPath);
    await this.putObject(objectName, body, contentType);
    this.logger.log(
      `Uploaded ${path.basename(localPath)} -> ${objectName} (${body.length} bytes)`,
    );
  }

  /**
   * Download an OCI object directly into memory. Used by the document viewer
   * (TIFF preview) — the API needs raw bytes to serve same-origin or run
   * server-side rasterisation without touching the filesystem.
   */
  async downloadBuffer(objectName: string): Promise<Buffer> {
    if (!this.parUrl) {
      throw new ServiceUnavailableException('OCI_PAR_URL not configured');
    }
    const url =
      this.parUrl + encodeURIComponent(objectName).replace(/%2F/g, '/');
    return this.httpGetBinary(url);
  }

  /**
   * Download an OCI object to a local temporary file.
   * Returns the local file path so OCR can process it.
   */
  async downloadToTmp(objectName: string, localDir: string): Promise<string> {
    if (!this.parUrl) {
      throw new ServiceUnavailableException('OCI_PAR_URL not configured');
    }

    const downloadUrl =
      this.parUrl + encodeURIComponent(objectName).replace(/%2F/g, '/');
    const ext = path.extname(objectName) || '.bin';
    const tmpName = `oci-${Date.now()}-${objectName.replace(/[^a-zA-Z0-9._-]/g, '_')}${ext.startsWith('.') ? '' : ext}`;
    const localPath = path.join(localDir, path.basename(tmpName));

    this.logger.log(`Downloading OCI object: ${objectName} -> ${localPath}`);
    await fs.mkdir(localDir, { recursive: true });
    await this.httpDownload(downloadUrl, localPath);
    this.logger.log(`Downloaded ${objectName} (${(await fs.stat(localPath)).size} bytes)`);

    return localPath;
  }

  // ---------- Low-level HTTP helpers (no external dependencies) ----------

  private httpPut(url: string, body: Buffer, contentType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(
        url,
        {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Content-Length': body.length,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            if (status >= 400) {
              const hint =
                status === 401 || status === 403 || status === 404
                  ? ' — the OCI PAR may be read-only or expired (it must permit object reads AND writes)'
                  : '';
              reject(new Error(`HTTP ${status} uploading to OCI${hint}`));
            } else {
              resolve();
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(30_000, () => {
        req.destroy(new Error('OCI upload timeout'));
      });
      req.end(body);
    });
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            this.httpGet(res.headers.location as string).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${url}`));
            return;
          }
          resolve(data);
        });
      });
      req.on('error', reject);
      req.setTimeout(30_000, () => { req.destroy(new Error('OCI request timeout')); });
    });
  }

  private httpGetBinary(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.httpGetBinary(res.headers.location as string).then(resolve).catch(reject);
          res.resume();
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(30_000, () => { req.destroy(new Error('OCI request timeout')); });
    });
  }

  private httpDownload(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      lib.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.httpDownload(res.headers.location as string, destPath).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          return;
        }
        const fileStream = require('fs').createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    });
  }
}
