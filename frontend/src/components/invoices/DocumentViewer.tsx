'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Loader2,
  Minus,
  Plus,
  RotateCw,
} from 'lucide-react';
import { api, documentsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { Button } from '@/components/ui/button';

/**
 * Renders the original invoice document (PRD UI-A-03 / DAT-02).
 *
 * - PDFs render in an iframe (browser's built-in viewer).
 * - PNG/JPG render in an <img> with CSS-zoom.
 * - TIFF is converted to PNG server-side (sharp/libvips) *for display only* —
 *   the stored original TIFF and the OCR pipeline are untouched. Browsers
 *   can't render TIFF in an <img>, so the server does the conversion and the
 *   viewer just shows the returned PNG. Multi-page TIFFs use X-Page-Count for
 *   prev/next nav.
 *
 * Use `invoiceId` for persisted invoices, or `extractionId` for in-memory OCR
 * extractions (OcrValidationPage). `directUrl` is used for non-TIFF documents
 * whose bytes live off-origin (e.g. the OCI PAR view URL for a PDF).
 */
export function DocumentViewer({
  invoiceId,
  extractionId,
  filename,
  mimeType,
  directUrl,
}: {
  invoiceId?: string | null;
  extractionId?: string | null;
  filename?: string | null;
  /**
   * Server-reported MIME type. Used as the primary TIFF detector so an
   * off-origin OCI URL with query params can't slip past the extension check.
   */
  mimeType?: string | null;
  /**
   * Render this URL directly (e.g. an OCI pre-authenticated view URL). Used
   * by callers that already have a browser-openable URL and no id. NOT used
   * for TIFFs — those always go through the server PNG endpoint.
   */
  directUrl?: string | null;
}) {
  const [zoom, setZoom] = useState(1);

  // Fetch the /view URL only for persisted invoices; extraction and direct
  // modes skip this call entirely.
  const q = useQuery({
    queryKey: invoiceId ? queryKeys.documentView(invoiceId) : ['documents', 'noop'],
    queryFn: () => documentsApi.view(invoiceId as string),
    enabled: !!invoiceId && !directUrl && !extractionId,
  });

  const nameForType =
    filename ?? q.data?.originalFilename ?? directUrl ?? q.data?.url ?? '';
  const looksTiff =
    (mimeType ?? '').toLowerCase() === 'image/tiff' ||
    /\.tiff?(?:$|[?#])/i.test(nameForType);
  const looksPdf = nameForType.toLowerCase().includes('.pdf');

  // TIFF path: identical for invoice / extraction — always fetches a
  // same-origin PNG rendered by sharp on the backend.
  if (looksTiff) {
    const base = extractionId
      ? `/ocr/extractions/${extractionId}`
      : invoiceId
        ? `/documents/${invoiceId}`
        : null;
    if (!base) {
      return (
        <Shell>
          <Hint icon={FileWarning} text="TIFF preview needs an invoice or extraction id." />
        </Shell>
      );
    }
    return <TiffViewer base={base} zoom={zoom} setZoom={setZoom} />;
  }

  // Direct-URL mode for non-TIFF documents (skip DB lookup entirely).
  if (directUrl) {
    return (
      <NonTiffViewer
        url={directUrl}
        looksPdf={looksPdf}
        zoom={zoom}
        setZoom={setZoom}
        withBlobFetch={false}
      />
    );
  }

  if (!invoiceId) {
    return <Shell><Hint icon={FileWarning} text="Select an invoice to preview its document." /></Shell>;
  }
  if (q.isLoading) {
    return <Shell><Loader2 className="h-6 w-6 animate-spin text-brand" /></Shell>;
  }
  if (q.isError || !q.data?.url) {
    return <Shell><Hint icon={FileWarning} text="Document not available for this invoice." /></Shell>;
  }

  return (
    <NonTiffViewer
      url={q.data.url}
      looksPdf={looksPdf}
      zoom={zoom}
      setZoom={setZoom}
      // `source: 'api'` means the URL is a same-origin authed stream — fetch as
      // a blob so the bearer token flows through the axios client.
      withBlobFetch={q.data.source === 'api'}
    />
  );
}

// ─── Non-TIFF renderer (PDF iframe + image tag) ─────────────────────────────

function NonTiffViewer({
  url,
  looksPdf,
  zoom,
  setZoom,
  withBlobFetch,
}: {
  url: string;
  looksPdf: boolean;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  withBlobFetch: boolean;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isFetchingBlob, setIsFetchingBlob] = useState(false);

  useEffect(() => {
    let active = true;
    if (withBlobFetch) {
      setIsFetchingBlob(true);
      api.get(url, { responseType: 'blob' })
        .then((res) => {
          if (active) {
            setBlobUrl(URL.createObjectURL(res.data));
            setIsFetchingBlob(false);
          }
        })
        .catch(() => {
          if (active) setIsFetchingBlob(false);
        });
    } else {
      setBlobUrl(null);
    }
    return () => { active = false; };
  }, [url, withBlobFetch]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (isFetchingBlob) {
    return <Shell><Loader2 className="h-6 w-6 animate-spin text-brand" /></Shell>;
  }

  const effectiveUrl = withBlobFetch ? (blobUrl ?? url) : url;
  const pdfSrc = looksPdf
    ? `${effectiveUrl}${effectiveUrl.includes('#') ? '&' : '#'}toolbar=1&navpanes=0&scrollbar=0&zoom=${Math.round(zoom * 100)}`
    : effectiveUrl;

  return (
    <div className="flex h-full flex-col">
      <ZoomBar zoom={zoom} setZoom={setZoom} />
      {looksPdf ? (
        /* Oversize the iframe by one scrollbar width and clip it, hiding the
           PDF viewer's internal scrollbars; wheel/keyboard scrolling still
           works inside the viewer. */
        <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
          <iframe
            key={pdfSrc}
            src={pdfSrc}
            title="Invoice document"
            className="absolute left-0 top-0 h-[calc(100%+18px)] w-[calc(100%+18px)]"
          />
        </div>
      ) : (
        <div className="no-scrollbar min-h-0 flex-1 overflow-auto bg-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={effectiveUrl}
            alt="Invoice document"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            className="mx-auto block"
          />
        </div>
      )}
    </div>
  );
}

// ─── TIFF renderer (server-side PNG via sharp) ──────────────────────────────

function TiffViewer({
  base,
  zoom,
  setZoom,
}: {
  base: string;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Reset when the target changes (e.g. selecting a different extraction).
  useEffect(() => {
    setPage(0);
    setPageCount(1);
    setStatus('loading');
    setErrMsg(null);
  }, [base]);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setStatus('loading');

    api
      .get(`${base}/preview`, {
        params: { page },
        responseType: 'blob',
      })
      .then((res) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(res.data);
        setPngUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return createdUrl;
        });
        const total = Number(res.headers['x-page-count'] ?? '1');
        if (Number.isFinite(total) && total > 0) setPageCount(total);
        setStatus('ok');
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message =
          (err as { response?: { status?: number } })?.response?.status
            ? `HTTP ${(err as { response: { status: number } }).response.status}`
            : (err as Error)?.message ?? 'Preview failed';
        setErrMsg(message);
        setStatus('error');
      });

    return () => {
      active = false;
      // Only revoke here if the effect didn't hand the URL over to state
      // (e.g. rapid unmount). state-tracked URLs are revoked in the setter.
      if (createdUrl && createdUrl !== pngUrl) URL.revokeObjectURL(createdUrl);
    };
    // pngUrl intentionally excluded — including it would re-fetch on every
    // successful render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, page]);

  // Revoke the last object URL on unmount.
  useEffect(() => {
    return () => {
      if (pngUrl) URL.revokeObjectURL(pngUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'loading') {
    return <Shell><Loader2 className="h-6 w-6 animate-spin text-brand" /></Shell>;
  }
  if (status === 'error') {
    return (
      <Shell>
        <Hint
          icon={FileWarning}
          text={`Could not render this TIFF${errMsg ? ` (${errMsg})` : ''}.`}
        />
      </Shell>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <div className="flex items-center gap-1">
          {pageCount > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[11px] tabular-nums text-ink-muted">
                Page {page + 1} / {pageCount}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
        <ZoomBar zoom={zoom} setZoom={setZoom} standalone={false} />
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-auto bg-canvas">
        {pngUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={pngUrl}
            alt="Invoice document"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            className="mx-auto block"
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Shared UI helpers ──────────────────────────────────────────────────────

function ZoomBar({
  zoom,
  setZoom,
  standalone = true,
}: {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  standalone?: boolean;
}) {
  const bar = (
    <>
      <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="w-10 text-center text-[11px] tabular-nums text-ink-muted">
        {Math.round(zoom * 100)}%
      </span>
      <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => setZoom(1)}>
        <RotateCw className="h-3.5 w-3.5" />
      </Button>
    </>
  );
  if (!standalone) return <div className="flex items-center gap-1">{bar}</div>;
  return (
    <div className="flex items-center justify-end gap-1 border-b border-line px-2 py-1.5">
      {bar}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[480px] items-center justify-center bg-canvas">
      {children}
    </div>
  );
}

function Hint({ icon: Icon, text }: { icon: typeof FileWarning; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center text-ink-muted">
      <Icon className="h-8 w-8 text-ink-subtle" />
      <p className="max-w-[240px] text-[13px]">{text}</p>
    </div>
  );
}
