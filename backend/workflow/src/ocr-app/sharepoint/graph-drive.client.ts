import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ClientSecretCredential } from '@azure/identity';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

export interface GraphDriveClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveId: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
}

export interface DriveChild {
  id: string;
  name: string;
  size?: number;
  isFolder: boolean;
  downloadUrl?: string;
  lastModified?: string;
}

/**
 * Read side of a SharePoint / OneDrive drive via Microsoft Graph, used by the
 * OCR pipeline to list + download documents the ingestion service wrote there.
 *
 * Mirrors the resilience of the OCI client (per-attempt timeout, retry with
 * backoff, readable 503 on exhaustion). App-only auth via @azure/identity; the
 * bearer token is cached until ~1 min before expiry.
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

  /** Resolve a directly-loadable, pre-authenticated download URL for one item. */
  async getDownloadUrl(path: string): Promise<string | null> {
    const res = await this.graphFetch(
      `${GRAPH_BASE}/drives/${this.driveId}/root:/${encodeDrivePath(path)}?$select=id,@microsoft.graph.downloadUrl`,
      { method: 'GET' },
      `Graph META ${path}`,
      { allow404: true },
    );
    if (res.status === 404) return null;
    const json = (await res.json()) as { '@microsoft.graph.downloadUrl'?: string };
    return json['@microsoft.graph.downloadUrl'] ?? null;
  }

  async download(path: string): Promise<Buffer> {
    const res = await this.graphFetch(
      `${GRAPH_BASE}/drives/${this.driveId}/root:/${encodeDrivePath(path)}:/content`,
      { method: 'GET' },
      `Graph DOWNLOAD ${path}`,
    );
    return Buffer.from(await res.arrayBuffer());
  }

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
      throw new ServiceUnavailableException('Could not acquire a Microsoft Graph access token');
    }
    this.cachedToken = { token: result.token, expiresAt: result.expiresOnTimestamp };
    return result.token;
  }

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

        if (res.status < 500 && res.status !== 429) {
          throw new ServiceUnavailableException(
            `${description} returned HTTP ${res.status}` +
              (res.status === 401 || res.status === 403
                ? ' -- check the app registration has Files.Read.All / Sites.Read.All and admin consent.'
                : res.status === 404
                  ? ' -- check SP_DRIVE_ID and the folder path exist.'
                  : '.'),
          );
        }
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        if (err instanceof ServiceUnavailableException) throw err;
        lastError = describeFetchError(err);
        this.logger.warn(
          `${description} attempt ${attempt}/${this.maxAttempts} failed: ${lastError}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.maxAttempts) await this.backoff(attempt);
    }

    throw new ServiceUnavailableException(
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
