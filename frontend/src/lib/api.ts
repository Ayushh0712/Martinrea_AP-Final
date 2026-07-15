import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { AUTH_COOKIE, STORAGE_KEYS, deleteCookie, getCookie, remove } from './storage';
import type {
  AllowedTransitionsResponse,
  ApproveResult,
  CreateInvoicePayload,
  Invoice,
  InvoiceStatus,
} from '@/types/invoice';
import type { AuthUser, LoginResponse } from '@/types/user';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'https://bloating-plausibly-ardently.ngrok-free.dev/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 20_000,
  headers: {
    'Content-Type': 'application/json',
    // Bypass ngrok-free's browser-warning interstitial when calling a tunnel
    // directly. Ignored by everything else (localhost, custom domains).
    'ngrok-skip-browser-warning': '1',
  },
});

// ─── Request interceptor: attach JWT ────────────────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getCookie(AUTH_COOKIE);
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// ─── Response interceptor: 401 → wipe + redirect ───────────────────────────
let onUnauthorized: (() => void) | null = null;
export function registerUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/**
 * Central "session is no longer valid" handler: clear the persisted token +
 * user and let the registered handler (AuthContext) redirect to /login.
 *
 * Exported so non-axios callers can trigger the exact same flow. The multipart
 * upload in `object-storage.ts` uses a raw `fetch` (to stream FormData through
 * the Next rewrite to the ingestion service) and therefore never hits the
 * interceptor below — without this it would surface the raw backend error
 * ("Invalid token: \"exp\" claim timestamp check failed") instead of bouncing
 * the user to log in again.
 */
export function notifyUnauthorized() {
  deleteCookie(AUTH_COOKIE);
  remove(STORAGE_KEYS.authUser);
  onUnauthorized?.();
}

api.interceptors.response.use(
  (r) => {
    // Unwrap the PRD response envelope `{ success, data, pagination }` so every
    // endpoint helper + mutation receives the resource (or array) directly.
    // Endpoints without the envelope (e.g. /auth/login, /users/me) pass through.
    const body = r.data;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const env = body as Record<string, unknown>;
      // Keep the full envelope when it carries pagination metadata (e.g.
      // GET /invoices/search) so callers can read `data` AND `pagination`.
      // The `list()` helper tolerates both shapes, so leaving these wrapped
      // is safe. Single-resource envelopes are still unwrapped to the resource.
      if ('success' in env && 'data' in env && !('pagination' in env)) {
        r.data = env.data;
      }
    }
    return r;
  },
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      notifyUnauthorized();
    }
    return Promise.reject(error);
  },
);

/**
 * Pull the most useful error string from an Axios error.
 * NestJS validation errors come back as { message: string | string[] }.
 */
export function extractApiError(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { message?: string | string[]; error?: string }
      | undefined;
    if (data?.message) {
      return Array.isArray(data.message) ? data.message.join(', ') : data.message;
    }
    if (data?.error) return data.error;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

// ─── Endpoint helpers ───────────────────────────────────────────────────────
export const authApi = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const { data } = await api.post<LoginResponse>('/auth/login', {
      email,
      password,
    });
    return data;
  },
  me: async (): Promise<AuthUser> => {
    const { data } = await api.get<AuthUser>('/users/me');
    return data;
  },
};

export interface InvoiceSearchParams {
  q?: string;
  status?: InvoiceStatus;
  statusGroup?: 'open' | 'closed';
  supplierName?: string;
  supplierId?: string;
  poNumber?: string;
  invoiceNumber?: string;
  ingestionChannel?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  sortBy?: 'createdAt' | 'invoiceNumber' | 'supplierName' | 'poNumber' | 'totalAmount' | 'status';
  sortDir?: 'ASC' | 'DESC';
  page?: number;
  limit?: number;
}

export interface InvoiceSearchPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface InvoiceSearchResult {
  data: Invoice[];
  pagination: InvoiceSearchPagination;
}

export const invoicesApi = {
  /**
   * List every invoice. Tolerates either a bare array response or a wrapped
   * envelope ({ data | invoices | items: Invoice[] }) so it works regardless
   * of how the backend shapes the collection.
   */
  list: async (status?: InvoiceStatus): Promise<Invoice[]> => {
    const { data } = await api.get<
      | Invoice[]
      | { data?: Invoice[]; invoices?: Invoice[]; items?: Invoice[] }
    >('/invoices', { params: { limit: 200, ...(status ? { status } : {}) } });
    if (Array.isArray(data)) return data;
    return data?.data ?? data?.invoices ?? data?.items ?? [];
  },
  /**
   * PRD DAT-05 / UI-A-02: server-side search with filter, sort and pagination.
   * Preferred over `list()` for the Command Center so filtering/sorting/paging
   * happen in the database rather than the browser (scales to the ~450K
   * docs/year NFR).
   */
  search: async (params: InvoiceSearchParams): Promise<InvoiceSearchResult> => {
    const { data } = await api.get<{
      success?: boolean;
      data?: Invoice[];
      pagination?: InvoiceSearchPagination;
    }>('/invoices/search', { params });
    return {
      data: data?.data ?? [],
      pagination:
        data?.pagination ?? {
          total: data?.data?.length ?? 0,
          page: params.page ?? 1,
          limit: params.limit ?? 25,
          totalPages: 1,
        },
    };
  },
  get: async (id: string): Promise<Invoice> => {
    const { data } = await api.get<Invoice>(`/invoices/${id}`);
    return data;
  },
  create: async (payload: CreateInvoicePayload): Promise<Invoice> => {
    const { data } = await api.post<Invoice>('/invoices', payload);
    return data;
  },
  update: async (
    id: string,
    patch: Partial<CreateInvoicePayload>,
  ): Promise<Invoice> => {
    const { data } = await api.patch<Invoice>(`/invoices/${id}`, patch);
    return data;
  },
  allowedTransitions: async (id: string): Promise<AllowedTransitionsResponse> => {
    const { data } = await api.get<AllowedTransitionsResponse>(
      `/invoices/${id}/allowed-transitions`,
    );
    return data;
  },
  submitReview: async (id: string): Promise<Invoice> => {
    const { data } = await api.post<Invoice>(`/invoices/${id}/submit-review`);
    return data;
  },
  /** Pull an EXCEPTION invoice back into review (EXCEPTION -> PENDING_REVIEW). */
  retrieveFromException: async (id: string): Promise<Invoice> => {
    const { data } = await api.post<Invoice>(`/invoices/${id}/retrieve`);
    return data;
  },
  /**
   * Dead-end an EXCEPTION invoice (EXCEPTION -> REJECTED). The row leaves the
   * exception queue but stays in the database as a record (never shown in the
   * UI) with the transition recorded in the append-only audit log.
   */
  rejectException: async (id: string, reason: string): Promise<Invoice> => {
    const { data } = await api.post<Invoice>(
      `/invoices/${id}/reject-exception`,
      { reason },
    );
    return data;
  },
  submitMatch: async (id: string): Promise<Invoice> => {
    // PRD UI-B-05 step 1: verify the 2-way match (PENDING_MATCH -> MATCHED).
    // The invoice rests in MATCHED until submitApproval() routes it onward.
    const { data } = await api.post<Invoice>('/workflow/submit-match', {
      invoiceId: id,
    });
    return data;
  },
  submitApproval: async (id: string): Promise<Invoice> => {
    // PRD UI-B-05 step 2: route a MATCHED invoice into the approval chain
    // (MATCHED -> PENDING_APPROVAL).
    const { data } = await api.post<Invoice>('/workflow/submit-approval', {
      invoiceId: id,
    });
    return data;
  },
  approve: async (id: string): Promise<ApproveResult> => {
    const { data } = await api.post<ApproveResult>(`/invoices/${id}/approve`);
    return data;
  },
  reject: async (id: string, reason: string): Promise<Invoice> => {
    const { data } = await api.post<Invoice>(`/invoices/${id}/reject`, {
      reason,
    });
    return data;
  },
  flagException: async (
    id: string,
    reasonCode = 'OTHER',
    notes?: string,
  ): Promise<Invoice> => {
    // Backend requires `reasonCode`, and `notes` when reasonCode is OTHER.
    const payload = {
      reasonCode,
      notes:
        notes ?? (reasonCode === 'OTHER' ? 'Flagged from workbench' : undefined),
    };
    const { data } = await api.post<Invoice>(
      `/invoices/${id}/flag-exception`,
      payload,
    );
    return data;
  },
  transition: async (
    id: string,
    to: InvoiceStatus,
    notes?: string,
  ): Promise<Invoice> => {
    const { data } = await api.post<Invoice>(`/invoices/${id}/transitions`, {
      to,
      notes,
    });
    return data;
  },
};

export const escalationApi = {
  runNow: async (): Promise<unknown> => {
    const { data } = await api.post('/escalation/run-now');
    return data;
  },
};

/** A single audit-log record. Shape is backend-defined, so kept open-ended. */
export type AuditLogRecord = Record<string, unknown>;

export const auditApi = {
  /**
   * Fetch the audit trail (`GET /audit-logs`). Tolerates a bare array or a
   * wrapped envelope so it works regardless of the backend's response shape.
   */
  list: async (): Promise<AuditLogRecord[]> => {
    const { data } = await api.get<
      | AuditLogRecord[]
      | {
          data?: AuditLogRecord[];
          logs?: AuditLogRecord[];
          auditLogs?: AuditLogRecord[];
          items?: AuditLogRecord[];
        }
    >('/audit-logs');
    if (Array.isArray(data)) return data;
    return data?.data ?? data?.logs ?? data?.auditLogs ?? data?.items ?? [];
  },
};

// ─── OCR (workflow /api/ocr/*) ──────────────────────────────────────────────
// These endpoints use {success, items} / {success, invoice} envelopes (not the
// standard {success, data}), so they pass through the unwrap interceptor.
export interface OcrLineItem {
  id?: string;
  item_code: string | null;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
}
export interface OcrInvoice {
  id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  po_number: string | null;
  currency: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  discount: number | null;
  total_amount: number | null;
  confidence_score: number | null;
  requires_review: boolean;
  review_reason: string | null;
  status: string;
  document_type: string | null;
  original_filename: string | null;
  error_message: string | null;
  line_items: OcrLineItem[];
}

export const ocrApi = {
  reviewQueue: async (): Promise<OcrInvoice[]> => {
    const { data } = await api.get<{ items?: OcrInvoice[]; data?: OcrInvoice[] }>(
      '/ocr/invoices/review-queue',
      { params: { limit: 100 } },
    );
    return data?.items ?? data?.data ?? [];
  },
  /** List OCR invoices, optionally filtered by status (e.g. 'FAILED'). */
  list: async (status?: string): Promise<OcrInvoice[]> => {
    const { data } = await api.get<{ items?: OcrInvoice[]; data?: OcrInvoice[] }>(
      '/ocr/invoices',
      { params: { limit: 100, ...(status ? { status } : {}) } },
    );
    return data?.items ?? data?.data ?? [];
  },
  get: async (id: string): Promise<OcrInvoice> => {
    const { data } = await api.get<{ invoice?: OcrInvoice } & OcrInvoice>(
      `/ocr/invoices/${id}`,
    );
    return (data?.invoice ?? data) as OcrInvoice;
  },
  /**
   * Persist human-corrected header fields + line items onto the OCR record
   * during review (PRD UI-A-09). Line items are sent in camelCase and fully
   * replace the existing lines so corrected data flows into 3-way matching.
   */
  update: async (
    id: string,
    payload: OcrInvoiceUpdate,
  ): Promise<OcrInvoice> => {
    const { data } = await api.patch<{ invoice?: OcrInvoice } & OcrInvoice>(
      `/ocr/invoices/${id}`,
      payload,
    );
    return (data?.invoice ?? data) as OcrInvoice;
  },
  /** Re-queue a FAILED OCR invoice for another extraction attempt. */
  retry: async (id: string): Promise<void> => {
    await api.post(`/ocr/invoices/${id}/retry`);
  },
  /**
   * Trigger an immediate OCI storage scan so a just-uploaded document enters OCR
   * without waiting for the auto-ingest poll. OCI Object Storage is the only
   * configured source. Fire-and-forget; the 30s poller is the fallback.
   */
  scanBucket: async (): Promise<void> => {
    await Promise.allSettled([api.post('/ocr/oci/scan')]);
  },
};

export interface OcrInvoiceUpdateLine {
  itemCode?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
}
export interface OcrInvoiceUpdate {
  supplierName?: string;
  invoiceNumber?: string;
  poNumber?: string;
  currency?: string;
  invoiceDate?: string;
  lineItems?: OcrInvoiceUpdateLine[];
}

// ─── OCR Extractions (in-memory, workflow /api/ocr/extractions) ─────────────
// Transient OCR results produced by the OCI auto-ingest poller. No DB is
// involved yet (persistence is deferred), so these live only for the lifetime
// of the backend process and are shown to the user for review.
export interface ExtractionLineItem {
  itemCode: string | null;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
}
export interface ExtractionFields {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  poNumber: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  confidenceScore: number;
  requiresReview: boolean;
  reviewReason: string | null;
  language: string;
  documentType: string;
  lineItems: ExtractionLineItem[];
}
export interface Extraction {
  id: string;
  sourceObjectName: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  extractedAt: string;
  ocrConfidence: number;
  viewUrl: string | null;
  fields: ExtractionFields;
}

/** Human-edited fields sent with "Send for Matching". */
export interface SendForMatchingBody {
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  poNumber?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  discount?: number | null;
  totalAmount?: number | null;
  confidenceScore?: number | null;
  documentType?: string;
  language?: string | null;
  lineItems?: ExtractionLineItem[];
}

export const extractionsApi = {
  /** List all in-memory extractions (most recent first). */
  list: async (): Promise<Extraction[]> => {
    const { data } = await api.get<{ items?: Extraction[]; data?: Extraction[] }>(
      '/ocr/extractions',
    );
    return data?.items ?? data?.data ?? [];
  },
  get: async (id: string): Promise<Extraction> => {
    const { data } = await api.get<{ extraction?: Extraction } & Extraction>(
      `/ocr/extractions/${id}`,
    );
    return (data?.extraction ?? data) as Extraction;
  },
  /** Scan the OCI source folder now and OCR-extract any new documents. */
  scan: async (): Promise<{ ingested: number; skipped: number; scanned: number }> => {
    const { data } = await api.post<{
      ingested: number;
      skipped: number;
      scanned: number;
    }>('/ocr/extractions/scan');
    return data;
  },
  /**
   * Persist an edited extraction as a PENDING_MATCH invoice and hand it to the
   * 2-way match workbench. Removes the extraction from the in-memory list.
   */
  sendForMatching: async (
    id: string,
    body: SendForMatchingBody,
  ): Promise<Invoice> => {
    const { data } = await api.post<{ invoice?: Invoice } & Invoice>(
      `/ocr/extractions/${id}/send-for-matching`,
      body,
    );
    return (data?.invoice ?? data) as Invoice;
  },
  /**
   * Reject an extraction: persist it as an EXCEPTION invoice (sent to the
   * exception queue) and remove it from the in-memory list.
   */
  reject: async (id: string, body: SendForMatchingBody): Promise<Invoice> => {
    const { data } = await api.post<{ invoice?: Invoice } & Invoice>(
      `/ocr/extractions/${id}/reject`,
      body,
    );
    return (data?.invoice ?? data) as Invoice;
  },
  /** Clear all in-memory extractions. */
  clear: async (): Promise<void> => {
    await api.delete('/ocr/extractions');
  },
};

// ─── Documents (workflow /api/documents/*) ──────────────────────────────────
export interface DocumentView {
  url: string;
  source: string;
  expiresInMinutes: number;
  originalFilename?: string | null;
}
export const documentsApi = {
  view: async (id: string): Promise<DocumentView> => {
    // {success, data:{url,...}} -> interceptor unwraps to the inner object.
    const { data } = await api.get<DocumentView>(`/documents/${id}/view`);
    return data;
  },
};

// ─── Purchase order shapes (shared by the PO panel + match workbench) ───────
export interface PurchaseOrderLine {
  lineNum: number;
  itemCode: string | null;
  description: string;
  orderedQty: number;
  remainingQty: number;
  unitPrice: number;
  lineTotal: number;
  remainingAmount: number;
  unitOfMeasure: string;
}
export interface PurchaseOrder {
  poNumber: string;
  supplierName: string;
  supplierCode: string;
  vendorCode: string | null;
  plantId: string | null;
  currency: string;
  totalAmount: number;
  remainingAmount: number;
  status: string;
  issuedDate: string | null;
  expectedDeliveryDate: string | null;
  lineItems?: PurchaseOrderLine[];
}
// ─── Purchase orders (workflow /api/purchase-orders/*) ──────────────────────
// Served from the workflow service's seeded `purchase_orders` table (the same
// source the 2-way match gate resolves against), so the match workbench PO
// panel agrees with the server-side match verdict (no integrations/CMS lookup).

/** Resolution of a PO's source document in the OCI PO-PDFs/ folder. */
export interface PoDocument {
  poNumber: string;
  available: boolean;
  objectName: string | null;
  url: string | null;
}

/**
 * Combined result of POST /po-ingest/scan
 * (local PDF sync + local PO-Data JSON ingest + OCI PO-JSON scan).
 */
export interface PoIngestScanResult {
  scanned: number;
  ingested: number;
  skipped: number;
  failed: number;
  /** Local PO-PDFs drop folder -> OCI upload counts. */
  pdfs?: { scanned: number; uploaded: number; failed: number };
  /** Local PO-Data drop folder -> DB ingest counts (mtime-based). */
  jsons?: { scanned: number; ingested: number; skipped: number; failed: number };
}

export const purchaseOrdersApi = {
  get: async (poNumber: string): Promise<PurchaseOrder> => {
    // {success, data:{...}} -> unwrapped to the PO object. 404 throws.
    const { data } = await api.get<PurchaseOrder>(
      `/purchase-orders/${encodeURIComponent(poNumber)}`,
    );
    return data;
  },
  /** Every PO header + line items (side-by-side view). */
  list: async (): Promise<PurchaseOrder[]> => {
    const { data } = await api.get<PurchaseOrder[] | { data?: PurchaseOrder[] }>(
      '/purchase-orders',
    );
    if (Array.isArray(data)) return data;
    return data?.data ?? [];
  },
  /**
   * Resolve the PO's PDF in the OCI bucket by filename convention
   * (PO-PDFs/<poNumber>.pdf). `available: false` when no file was uploaded yet.
   */
  document: async (poNumber: string): Promise<PoDocument> => {
    const { data } = await api.get<PoDocument>(
      `/purchase-orders/${encodeURIComponent(poNumber)}/document`,
    );
    return data;
  },
  /**
   * Trigger the PO ingest pipeline now: uploads PDFs from the local PO-PDFs
   * drop folder to OCI, then scans the OCI PO-JSON/ folder so freshly-uploaded
   * PO data lands in the DB without waiting for the auto-ingest polls.
   */
  scanPoJsonFolder: async (): Promise<PoIngestScanResult> => {
    const { data } = await api.post<PoIngestScanResult>('/po-ingest/scan');
    return data;
  },
};