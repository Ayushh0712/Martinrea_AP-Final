import { Logger } from '@nestjs/common';
import { ClientSecretCredential } from '@azure/identity';
import { StorageUnavailableError } from '../../shared';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

export interface GraphDriveClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The target drive (SharePoint document library / OneDrive) id. */
  driveId: string;
  /** Per-attempt request timeout in ms (AbortController). Default 15s. */
  timeoutMs?: number;
  /** Total attempts per request (>=1). Default 3. */
  maxAttempts?: number;
  /** Base backoff between retries in ms (doubles each attempt). Default 300. */
  baseBackoffMs?: number;
}

/** A single child item returned when listing a drive folder. */
export interface DriveChild {
  id: string;
  name: string;
  size?: number;
  isFolder: boolean;
  /** Pre-authenticated, short-lived download URL (files only). */
  downloadUrl?: string;
  lastModified?: string;
}

/**
 * Thin Microsoft Graph "drive" (SharePoint document library / OneDrive) client.
 *
 * Why hand-rolled REST over the Graph SDK: binary upload + following the
 * pre-authenticated `@microsoft.graph.downloadUrl` is far more predictable with
 * plain fetch, and it lets us reuse the same retry/timeout discipline the OCI
 * adapter already proved out. App-only auth (client credentials) is handled by
 * `@azure/identity`; the bearer token is cached until ~1 min before expiry.
 *
 * All object paths are RELATIVE to the drive root (e.g. `AP-Ingestion/raw/x.pdf`).
 * Folders are created implicitly by Graph on upload (the `:/content` addressing
 * with a nested path auto-provisions parents).
 */
export class GraphDriveClient {
  private readonly logger = new Logger(GraphDriveClient.name);
  private readonly credential: ClientSecretCredential;
  private readonly driveId: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private cachedToken?: { token: string; expiresAt: number };

  constructor(options: GraphDriveClientOptions) {
    const missing = (['tenantId', 'clientId', 'clientSecret', 'driveId'] as const).filter(
      (k) => !options[k],
    );
    if (missing.length) {
      throw new Error(
        `GraphDriveClient requires ${missing
          .map((k) => `SP_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`)
          .join(', ')}. ` +
          'Provide the Azure app-registration credentials (or reuse GRAPH_*) and ' +
          'SP_DRIVE_ID, or switch the transport back to "par"/"http"/"local".',
      );
    }
    this.driveId = options.driveId;
    this.credential = new ClientSecretCredential(
      options.tenantId,
      options.clientId,
      options.clientSecret,
    );
    this.timeoutMs = positiveOr(options.timeoutMs, 15_000);
    this.maxAttempts = Math.max(1, Math.trunc(positiveOr(options.maxAttempts, 3)));
    this.baseBackoffMs = positiveOr(options.baseBackoffMs, 300);
  }

  /** Upload (create/replace) a file at `path` (relative to drive root). */
  async putContent(path: string, body: Buffer, contentType: string): Promise<void> {
    await this.graphFetch(
      `${GRAPH_BASE}/drives/${this.driveId}/root:/${encodeDrivePath(path)}:/content`,
      {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(body),
      },
      `Graph PUT ${path}`,
    );
  }

  /**
   * Read a JSON sidecar's content. Returns undefined when the item is absent
   * (used for the content-hash dedup check).
   */
  async getJson<T>(path: string): Promise<T | undefined> {
    const res = await this.graphFetch(
      `${GRAPH_BASE}/drives/${this.driveId}/root:/${encodeDrivePath(path)}:/content`,
      { method: 'GET' },
      `Graph GET ${path}`,
      { allow404: true },
    );
    if (res.status === 404) return undefined;
    return (await res.json()) as T;
  }

  /** List children of a folder (relative path). Follows @odata.nextLink paging. */
  async listChildren(folderPath: string): Promise<DriveChild[]> {
    const encoded = encodeDrivePath(folderPath);
    let url =
      encoded.length > 0
        ? `${GRAPH_BASE}/drives/${this.driveId}/root:/${encoded}:/children?$top=200`
        : `${GRAPH_BASE}/drives/${this.driveId}/root/children?$top=200`;

    const children: DriveChild[] = [];
    while (url) {
      const res = await this.graphFetch(url, { method: 'GET' }, `Graph LIST ${folderPath}`, {
        allow404: true,
      });
      // A missing folder simply means "nothing ingested yet".
      if (res.status === 404) break;
      const json = (await res.json()) as {
        value?: Array<{
          id: string;
          name: string;
          size?: number;
          folder?: unknown;
          lastModifiedDateTime?: string;
          '@microsoft.graph.downloadUrl'?: string;
        }>;
        '@odata.nextLink'?: string;
      };
      for (const item of json.value ?? []) {
        children.push({
          id: item.id,
          name: item.name,
          size: item.size,
          isFolder: item.folder != null,
          downloadUrl: item['@microsoft.graph.downloadUrl'],
          lastModified: item.lastModifiedDateTime,
        });
      }
      url = json['@odata.nextLink'] ?? '';
    }
    return children;
  }

  /** Download a file (by relative path) into a Buffer. */
  async download(path: string): Promise<Buffer> {
    const res = await this.graphFetch(
      `${GRAPH_BASE}/drives/${this.driveId}/root:/${encodeDrivePath(path)}:/content`,
      { method: 'GET' },
      `Graph DOWNLOAD ${path}`,
    );
    return Buffer.from(await res.arrayBuffer());
  }

  /** Download from a pre-authenticated URL returned by listChildren (no auth header). */
  async downloadFromUrl(downloadUrl: string, description: string): Promise<Buffer> {
    const res = await this.graphFetch(downloadUrl, { method: 'GET' }, description, {
      noAuth: true,
    });
    return Buffer.from(await res.arrayBuffer());
  }

  private async token(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 60_000 > now) {
      return this.cachedToken.token;
    }
    const result = await this.credential.getToken(GRAPH_SCOPE);
    if (!result?.token) {
      throw new StorageUnavailableError('Could not acquire a Microsoft Graph access token.');
    }
    this.cachedToken = { token: result.token, expiresAt: result.expiresOnTimestamp };
    return result.token;
  }

  /**
   * Single choke-point for every Graph request: per-attempt timeout, retry with
   * backoff on transient failures (network, timeout, 5xx, 429), and a readable
   * StorageUnavailableError on exhaustion or a non-retryable response. Mirrors
   * the resilience the OCI adapter added so a flaky connection never bubbles up
   * as a raw `fetch failed` 500.
   */
  private async graphFetch(
    url: string,
    init: RequestInit,
    description: string,
    opts: { allow404?: boolean; noAuth?: boolean } = {},
  ): Promise<Response> {
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = new Headers(init.headers);
        if (!opts.noAuth) headers.set('Authorization', `Bearer ${await this.token()}`);

        const res = await fetch(url, { ...init, headers, signal: controller.signal });

        if (opts.allow404 && res.status === 404) return res;
        if (res.ok) return res;

        // 5xx + 429 are transient (retry); 401/403/404 on a write are a
        // configuration/permission problem we should not hammer.
        if (res.status < 500 && res.status !== 429) {
          throw new StorageUnavailableError(
            `${description} returned HTTP ${res.status}` +
              (res.status === 401 || res.status === 403
                ? ' -- check the app registration has Files.ReadWrite.All / Sites.ReadWrite.All and admin consent.'
                : res.status === 404
                  ? ' -- check SP_DRIVE_ID and the folder path exist.'
                  : '.'),
          );
        }
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        if (err instanceof StorageUnavailableError) throw err;
        lastError = describeFetchError(err);
        this.logger.warn(
          `${description} attempt ${attempt}/${this.maxAttempts} failed: ${lastError}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.maxAttempts) await this.backoff(attempt);
    }

    throw new StorageUnavailableError(
      `${description} failed after ${this.maxAttempts} attempt(s): ${lastError}.`,
    );
  }

  private backoff(attempt: number): Promise<void> {
    const ms = this.baseBackoffMs * 2 ** (attempt - 1);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Encode each path segment but keep `/` as the folder separator. */
export function encodeDrivePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'request timed out';
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return `${err.message} (${cause.code})`;
    if (cause?.message) return `${err.message}: ${cause.message}`;
    return err.message;
  }
  return String(err);
}
