'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Boxes,
  Columns3,
  FileText,
  FileWarning,
  Lock,
  ShoppingCart,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/invoices/StatusBadge';
import { DocumentViewer } from '@/components/invoices/DocumentViewer';
import { invoicesApi, purchaseOrdersApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useInvoice } from '@/hooks/useInvoices';
import { formatCurrency } from '@/lib/utils';

/**
 * Side-by-side document REVIEW for one invoice in the 2-way match flow — a
 * full-screen workspace (painted over the sidebar/topbar shell): the invoice
 * PDF and its purchase order's PDF (fetched from OCI by filename,
 * PO-PDFs/<poNumber>.pdf) side by side at full height, with a reserved GRN
 * column (Phase 2).
 *
 * Opened from the "Side by Side view" button on the Match workbench via
 * `/side-by-side?invoice=<id>` — scoped strictly to that invoice, its PO and
 * the APPROVED invoices already drawn against the same PO (switchable via the
 * "Approved invoices" dropdown at the bottom of the invoice pane). No general
 * browsing here.
 */
export default function SideBySidePage() {
  const searchParams = useSearchParams();
  const invoiceId = searchParams?.get('invoice') ?? null;

  const invoiceQ = useInvoice(invoiceId);
  const invoice = invoiceQ.data;
  const po = invoice?.poNumber ?? null;

  // APPROVED invoices already drawn against the same PO (exact-PO filter,
  // mirroring the Match page's context section).
  const approvedQ = useQuery({
    queryKey: po ? queryKeys.approvedInvoicesByPo(po) : ['invoices', 'approved-by-po', 'none'],
    queryFn: () =>
      invoicesApi.search({ status: 'APPROVED', poNumber: po as string, limit: 100 }),
    enabled: !!po,
    retry: false,
  });
  const approved = useMemo(
    () =>
      (approvedQ.data?.data ?? []).filter(
        (i) => i.poNumber === po && i.id !== invoiceId,
      ),
    [approvedQ.data, po, invoiceId],
  );

  // Every APPROVED invoice (any PO), so the switcher can open any approved
  // invoice's PDF — not just the ones drawn against the current PO.
  const allApprovedQ = useQuery({
    queryKey: queryKeys.approvedInvoicesAll,
    queryFn: () =>
      invoicesApi.search({
        status: 'APPROVED',
        limit: 100,
        sortBy: 'createdAt',
        sortDir: 'DESC',
      }),
    retry: false,
  });
  // Approved invoices on OTHER POs (excludes the same-PO group and current).
  const otherApproved = useMemo(
    () =>
      (allApprovedQ.data?.data ?? []).filter(
        (i) => i.id !== invoiceId && !(po && i.poNumber === po),
      ),
    [allApprovedQ.data, invoiceId, po],
  );
  const allApproved = useMemo(
    () => [...approved, ...otherApproved],
    [approved, otherApproved],
  );

  // Which invoice's document the left pane shows: the current invoice by
  // default, or an approved invoice picked from the switcher. Self-heals if
  // the picked id is no longer in the approved list (e.g. deep-link change).
  const [pickedId, setPickedId] = useState<string | null>(null);
  const viewedId =
    pickedId && allApproved.some((a) => a.id === pickedId) ? pickedId : invoiceId;
  const viewedApproved = allApproved.find((a) => a.id === viewedId) ?? null;
  const viewedAmount = viewedApproved
    ? formatCurrency(Number(viewedApproved.totalAmount), viewedApproved.currency)
    : invoice
    ? formatCurrency(Number(invoice.totalAmount), invoice.currency)
    : null;

  // The PO pane follows the VIEWED invoice, so picking an approved invoice
  // from another PO swaps in that PO's document (both panes stay paired).
  const viewedPo = viewedApproved ? viewedApproved.poNumber : po;

  // PO document resolved by filename convention (PO-PDFs/<poNumber>.pdf).
  const poDocQ = useQuery({
    queryKey: viewedPo
      ? queryKeys.poDocument(viewedPo)
      : ['workflow', 'po', 'none', 'document'],
    queryFn: () => purchaseOrdersApi.document(viewedPo as string),
    enabled: !!viewedPo,
    retry: false,
  });

  // ── No deep link: this page is only reachable from the Match workbench ────
  if (!invoiceId) {
    return (
      <EmptyScreen text="This review opens for a specific invoice. Pick one on the 2-Way / 3-Way Match tab and hit “Side by Side view”." />
    );
  }
  if (invoiceQ.isError) {
    return <EmptyScreen text="Invoice not found — it may have been removed." />;
  }

  return (
    /* Full-screen overlay: covers the app shell (mobile drawer is z-50) so the
       whole viewport belongs to the review. Below lg it scrolls internally. */
    <div className="no-scrollbar fixed inset-0 z-[60] flex flex-col gap-3 overflow-y-auto bg-canvas p-3 lg:overflow-hidden">
      {/* Compact one-row header — 1fr:auto:1fr tracks keep the button at the
          true center of the bar regardless of the left cluster's width. */}
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">
            Side by Side Review
          </h1>
          {invoice ? (
            <>
              <span className="text-ink-subtle">·</span>
              <span className="text-[15px] font-semibold text-ink">
                {invoice.invoiceNumber}
              </span>
              <StatusBadge status={invoice.status} size="sm" />
              {po && (
                <span className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[11.5px] font-semibold text-ink-muted">
                  {po}
                </span>
              )}
            </>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/match?invoice=${invoiceId}`}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to match
          </Link>
        </Button>
        {/* Right spacer balances the left cluster so the button stays centered. */}
        <div />
      </div>

      {/* One-screen workspace: Invoice | PO | GRN at 5:5:2.5 */}
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[5fr_5fr_2.5fr]">
        {/* ── Invoice document ─────────────────────────────────────────── */}
        <Card className="flex h-[70vh] min-w-0 flex-col overflow-hidden lg:h-full">
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas/60 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-brand" />
              <h3 className="truncate text-[13px] font-semibold text-ink">
                {viewedApproved
                  ? `Invoice ${viewedApproved.invoiceNumber}`
                  : invoice
                  ? `Invoice ${invoice.invoiceNumber}`
                  : 'Invoice'}
              </h3>
              {viewedApproved && (
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">
                  Approved
                </span>
              )}
            </div>
            {viewedAmount && (
              <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink">
                {viewedAmount}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {invoiceQ.isLoading ? (
              <PaneSkeleton />
            ) : (
              <DocumentViewer key={viewedId} invoiceId={viewedId} />
            )}
          </div>
          {/* Approved-invoice switcher: pick an approved invoice to view its
              PDF in this pane; the "— current" entry switches back. */}
          {allApproved.length > 0 && (
            <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line bg-canvas/60 px-3">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                Approved invoices
              </span>
              <Select
                value={viewedId ?? undefined}
                onValueChange={(v) => setPickedId(v === invoiceId ? null : v)}
              >
                <SelectTrigger className="h-7 w-auto min-w-[180px] max-w-[280px] border-line bg-white text-[12.5px] font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={invoiceId}>
                    {invoice ? `${invoice.invoiceNumber} — current` : 'Current invoice'}
                  </SelectItem>
                  {approved.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Approved · this PO</SelectLabel>
                      {approved.map((ai) => (
                        <SelectItem key={ai.id} value={ai.id}>
                          {`${ai.invoiceNumber} · ${formatCurrency(
                            Number(ai.totalAmount),
                            ai.currency,
                          )} · approved ${new Date(ai.updatedAt).toLocaleDateString()}`}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {otherApproved.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Approved · other POs</SelectLabel>
                      {otherApproved.map((ai) => (
                        <SelectItem key={ai.id} value={ai.id}>
                          {`${ai.invoiceNumber} · ${formatCurrency(
                            Number(ai.totalAmount),
                            ai.currency,
                          )} · ${ai.poNumber ? `PO ${ai.poNumber}` : 'no PO'}`}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
        </Card>

        {/* ── Purchase order document ──────────────────────────────────── */}
        <Card className="flex h-[70vh] min-w-0 flex-col overflow-hidden lg:h-full">
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas/60 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <ShoppingCart className="h-4 w-4 shrink-0 text-brand" />
              <h3 className="truncate text-[13px] font-semibold text-ink">
                {viewedPo ? `Purchase Order ${viewedPo}` : 'Purchase Order'}
              </h3>
            </div>
            {poDocQ.data?.available && (
              <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand">
                PDF
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {!viewedPo ? (
              <PaneEmpty text="Invoice has no PO number — nothing to fetch." />
            ) : poDocQ.isLoading ? (
              <PaneSkeleton />
            ) : poDocQ.data?.available && poDocQ.data.url ? (
              <DocumentViewer
                key={viewedPo}
                directUrl={poDocQ.data.url}
                filename={poDocQ.data.objectName}
              />
            ) : (
              <PaneEmpty
                text={`No PDF found in OCI (expected PO-PDFs/${viewedPo}.pdf). Drop it in the project's PO-PDFs folder to sync it.`}
              />
            )}
          </div>
        </Card>

        {/* ── GRN — slim reserved column (Phase 2) ─────────────────────── */}
        <Card className="flex h-40 min-w-0 flex-col items-center justify-center gap-2.5 border-dashed bg-canvas/50 px-3 text-center shadow-none lg:h-full">
          <Boxes className="h-6 w-6 text-ink-subtle" />
          <div className="flex flex-col items-center gap-1.5">
            <h3 className="text-[13px] font-semibold text-ink-muted">GRN</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              <Lock className="h-3 w-3" />
              Phase 2
            </span>
          </div>
          <p className="max-w-[210px] text-[11px] leading-relaxed text-ink-subtle">
            Goods Receipt documents will appear here when 3-way matching goes
            live.
          </p>
        </Card>
      </div>
    </div>
  );
}

function PaneSkeleton() {
  return (
    <div className="h-full space-y-2 overflow-hidden p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function PaneEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-canvas px-6 text-center">
      <FileWarning className="h-8 w-8 text-ink-subtle" />
      <p className="max-w-[260px] text-[12.5px] text-ink-muted">{text}</p>
    </div>
  );
}

function EmptyScreen({ text }: { text: string }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">
          Side by Side Review
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Review an invoice's document next to its purchase order.
        </p>
      </div>
      <Card>
        <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
          <Columns3 className="h-8 w-8 text-ink-subtle" />
          <p className="max-w-[420px] text-[13px] text-ink-muted">{text}</p>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/match">
              <ArrowLeft className="h-3.5 w-3.5" />
              Go to 2-Way / 3-Way Match
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
