/**
 * Invoice upload via the ingestion service (ING-04).
 *
 * The file is POSTed to `POST /api/ingestion/upload` (proxied by Next to the
 * ingestion service). Ingestion validates it and stores it in the OCI bucket
 * under `raw/<hash>-<name>`, where the backend OCR poller picks it up. This
 * keeps the storage credential server-side (not in the browser bundle) and
 * ensures the file lands under the prefix the poller scans.
 */
import { AUTH_COOKIE, getCookie } from './storage';
import { notifyUnauthorized } from './api';

/** Accepted invoice document types (PRD ING-01: PDF, JPG, PNG, TIF). */
export const ACCEPTED_UPLOAD_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.tif',
  '.tiff',
] as const;

export const ACCEPTED_UPLOAD_ACCEPT_ATTR =
  '.pdf,.jpg,.jpeg,.png,.tif,.tiff,application/pdf,image/jpeg,image/png,image/tiff';

/** Max document size — 10 MB (PRD ING-01). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Returns an error message if the file is invalid, or null if it's acceptable. */
export function validateInvoiceFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const okType = ACCEPTED_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!okType) {
    return 'Unsupported type — use PDF, JPG, PNG, or TIF.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'Too large — the limit is 10 MB.';
  }
  if (file.size === 0) {
    return 'File is empty.';
  }
  return null;
}

/**
 * Uploads a single document through the ingestion service. Resolves on success,
 * throws with a readable message on failure. The browser sets the multipart
 * boundary automatically (no Content-Type header is forced).
 */
export async function uploadInvoiceFile(file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file, file.name);

  const token = getCookie(AUTH_COOKIE);
  let res: Response;
  try {
    res = await fetch('/api/ingestion/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch {
    throw new Error('Network error — could not reach the ingestion service.');
  }
  if (!res.ok) {
    // The bearer token expired / is invalid. Mirror the axios interceptor:
    // clear the session and bounce to /login rather than surfacing the raw
    // backend error (e.g. 'Invalid token: "exp" claim timestamp check failed').
    if (res.status === 401) {
      notifyUnauthorized();
      throw new Error('Your session has expired. Please log in again.');
    }
    const detail = await res.text().catch(() => '');
    throw new Error(detail.trim() || `Upload failed (HTTP ${res.status}).`);
  }
}
