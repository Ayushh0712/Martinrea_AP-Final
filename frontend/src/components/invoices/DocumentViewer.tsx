'use client';

import { useCallback, useEffect, useState } from 'react';
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
import UTIF, { type IFD as UtifIFD } from 'utif';
import { api, documentsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { Button } from '@/components/ui/button';

/**
 * Renders the original invoice document (PRD UI-A-03 / DAT-02). Fetches a
 * short-lived view URL from GET /api/documents/:id/view and shows it inline.
 *
 * - PDFs render in an iframe (browser's built-in viewer).
 * - PNG/JPG render in an <img> with CSS-zoom.
 * - TIFF is decoded client-side into a <canvas> via UTIF (true pixels, no
 *   server re-encode). If UTIF can't decode a specific TIFF variant, the
 *   viewer falls back to a lossless server-rendered PNG page.
 *
 * `invoiceId` is used for persisted invoices; `extractionId` for in-memory OCR
 * extractions (OcrValidationPage). Exactly one identifier is expected, or a
 * `directUrl` for non-TIFF documents whose bytes live off-origin.
 */
export function DocumentViewer({
  invoiceId,
  extractionId,
  filename,
  directUrl,
}: {
  invoiceId?: string | null;
  extractionId?: string | null;
  filename?: string | null;
  /**
   * Render this URL directly (e.g. an OCI pre-authenticated view URL). Used
   * by callers that already have a browser-openable URL and no id (e.g. the
   * side-by-side PO document panel). Not used for TIFF fetches — TIFFs need
   * same-origin bytes to satisfy CORS + UTIF.
   */
  directUrl?: string | null;
}) {
  const [zoom, setZoom] = useState(1);

  // Resolve the /view URL only for persisted invoices; extraction and direct
  // modes skip this call entirely.
  const q = useQuery({
    queryKey: invoiceId ? queryKeys.documentView(invoiceId) : ['documents', 'noop'],
    queryFn: () => documentsApi.view(invoiceId as string),
    enabled: !!invoiceId && !directUrl && !extractionId,
  });

  // Filename first, then fall back to view URL for extension sniffing.
  const nameForType =
    filename ?? q.data?.originalFilename ?? directUrl ?? q.data?.url ?? '';
  const looksTiff = /\.tiff?(?:$|[?#])/i.test(nameForType);
  const looksPdf = nameForType.toLowerCase().includes('.pdf');

  // TIFF path: identical for invoice / extraction / direct — always fetches
  // authed bytes from a same-origin backend endpoint.
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

// ─── TIFF renderer (client canvas + server PNG fallback) ────────────────────

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
  const [status, setStatus] = useState<'loading' | 'canvas' | 'fallback' | 'error'>('loading');
  const [canvasImg, setCanvasImg] = useState<{ url: string; width: number; height: number } | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);

  const revokeAll = useCallback(() => {
    if (canvasImg?.url) URL.revokeObjectURL(canvasImg.url);
    if (pngUrl) URL.revokeObjectURL(pngUrl);
  }, [canvasImg, pngUrl]);

  // Reset when the target changes.
  useEffect(() => {
    setPage(0);
    setPageCount(1);
    setStatus('loading');
  }, [base]);

  // Client-side render (tries UTIF; on failure falls back to server PNG).
  useEffect(() => {
    let active = true;
    setStatus('loading');

    const renderFallback = async () => {
      try {
        const res = await api.get(`${base}/preview`, {
          params: { page },
          responseType: 'blob',
        });
        if (!active) return;
        const url = URL.createObjectURL(res.data);
        setPngUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        const total = Number(res.headers['x-page-count'] ?? '1');
        if (Number.isFinite(total) && total > 0) setPageCount(total);
        setStatus('fallback');
      } catch {
        if (active) setStatus('error');
      }
    };

    const run = async () => {
      try {
        const res = await api.get(`${base}/bytes`, { responseType: 'arraybuffer' });
        if (!active) return;
        const buf: ArrayBuffer = res.data;
        let ifds: UtifIFD[] = [];
        try {
          ifds = UTIF.decode(buf);
        } catch {
          await renderFallback();
          return;
        }
        if (!ifds.length) {
          await renderFallback();
          return;
        }
        setPageCount(ifds.length);
        const safePage = Math.min(Math.max(page, 0), ifds.length - 1);
        const ifd = ifds[safePage];
        try {
          UTIF.decodeImage(buf, ifd, ifds);
          const rgba = UTIF.toRGBA8(ifd);
          const width = ifd.width;
          const height = ifd.height;
          if (!width || !height || !rgba.length) throw new Error('empty tiff');
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d ctx');
          const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
          ctx.putImageData(imageData, 0, 0);
          canvas.toBlob((blob) => {
            if (!active || !blob) return;
            const url = URL.createObjectURL(blob);
            setCanvasImg((prev) => {
              if (prev?.url) URL.revokeObjectURL(prev.url);
              return { url, width, height };
            });
            setStatus('canvas');
          }, 'image/png');
        } catch {
          await renderFallback();
        }
      } catch {
        if (active) setStatus('error');
      }
    };
    void run();

    return () => { active = false; };
  }, [base, page]);

  // Revoke any object URLs on unmount.
  useEffect(() => {
    return () => revokeAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'loading') {
    return <Shell><Loader2 className="h-6 w-6 animate-spin text-brand" /></Shell>;
  }
  if (status === 'error') {
    return <Shell><Hint icon={FileWarning} text="Could not render this TIFF." /></Shell>;
  }

  const src = status === 'canvas' ? canvasImg?.url ?? '' : pngUrl ?? '';

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
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
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
