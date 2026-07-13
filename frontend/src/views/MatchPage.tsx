'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Columns3,
  FileText,
  Flag,
  GitMerge,
  Lock,
  ShoppingCart,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LifecycleStepper } from '@/components/invoices/LifecycleStepper';
import {
  extractApiError,
  invoicesApi,
  ocrApi,
  purchaseOrdersApi,
} from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useInvoice } from '@/hooks/useInvoices';
import { useSubmitMatch } from '@/hooks/useInvoiceMutations';
import { formatCurrency } from '@/lib/utils';

const REASON_CODES = [
  'PRICE_VARIANCE',
  'QUANTITY_MISMATCH',
  'DUPLICATE_INVOICE',
  'MISSING_PO',
  'OTHER',
] as const;

// Mirror the backend match engine's comparison epsilons (match.service.ts) so
// this preview predicts the exact same verdict: money is exact within half a
// cent, quantity within a hair below any real UoM granularity.
const MONEY_EPS = 0.005;
const QTY_EPS = 1e-6;

interface CompareRow {
  itemCode: string | null;
  description: string;
  invoiceQty: number | null;
  orderedQty: number | null;
  remainingQty: number | null;
  /**
   * PO remaining qty minus this invoice's draw. Negative means the invoice
   * overbills the PO line (same condition as `overbilled`, which stays the
   * authoritative epsilon-aware check). Null when the invoice doesn't draw
   * this PO line, or the invoice line has no PO counterpart.
   */
  remainingAfterMatch: number | null;
  poUnit: number | null;
  billedUnit: number | null;
  overbilled: boolean;
  priceMismatch: boolean;
  /** Invoice line whose item code matches no PO line. */
  unmatched: boolean;
  note: string;
}

/** Normalise an item code for matching (mirrors the backend's itemKey). */
function itemKey(code: string | null | undefined): string | null {
  const k = (code ?? '').trim().toUpperCase();
  return k.length > 0 ? k : null;
}

export default function MatchPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const queueQ = useQuery({
    queryKey: queryKeys.invoicesByStatus('PENDING_MATCH'),
    queryFn: () => invoicesApi.list('PENDING_MATCH'),
    staleTime: 10_000,
  });
  const queue = queueQ.data ?? [];

  // Deep-link target from the Command Center "Match" row action (?invoice=<id>).
  const searchParams = useSearchParams();
  const deepLinkId = searchParams?.get('invoice') ?? null;

  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? deepLinkId ?? queue[0]?.id ?? null;
  const invoiceQ = useInvoice(activeId);
  const invoice = invoiceQ.data;
  const po = invoice?.poNumber ?? null;

  const poQ = useQuery({
    queryKey: po ? queryKeys.purchaseOrder(po) : ['workflow', 'po', 'none'],
    queryFn: () => purchaseOrdersApi.get(po as string),
    enabled: !!po,
    retry: false,
  });
  // Goods Receipt (3-way) is a Phase 2 feature — not fetched in Phase 1.
  // Optional invoice line items (present for OCR-ingested invoices).
  const ocrQ = useQuery({
    queryKey: activeId ? queryKeys.ocrInvoice(activeId) : ['ocr', 'noop'],
    queryFn: () => ocrApi.get(activeId as string),
    enabled: !!activeId,
    retry: false,
  });

  // Already-approved invoices drawn against the same PO (context for how much of
  // the PO is already consumed). `poNumber` is a partial iLike match server-side,
  // so we filter to an exact PO match below.
  const approvedInvoicesQ = useQuery({
    queryKey: po ? queryKeys.approvedInvoicesByPo(po) : ['invoices', 'approved-by-po', 'none'],
    queryFn: () =>
      invoicesApi.search({ status: 'APPROVED', poNumber: po as string, limit: 100 }),
    enabled: !!po,
    retry: false,
  });
  const approvedInvoices = useMemo(
    () => (approvedInvoicesQ.data?.data ?? []).filter((i) => i.poNumber === po),
    [approvedInvoicesQ.data, po],
  );
  const [approvedOpen, setApprovedOpen] = useState(false);

  const confirmMatch = useSubmitMatch();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<string>('PRICE_VARIANCE');
  const [notes, setNotes] = useState('');
  const [attachment, setAttachment] = useState<string>('');

  // ── Build the aligned Invoice ↔ PO comparison rows (2-way) ────────────────
  // Mirrors the authoritative backend engine (match.service.ts `evaluate`)
  // EXACTLY so this preview predicts the real verdict: PO lines are indexed by
  // normalised item code (first wins, no description fallback), invoice lines
  // are paired strictly by that code and their quantities aggregated per PO
  // line, quantity is compared against the PO line's REMAINING quantity, and
  // unit price must match within half a cent. Invoice lines whose code hits no
  // PO line surface as their own red rows (this is the case that silently
  // "passed" the old preview but was rejected by the server).
  const rows = useMemo<CompareRow[]>(() => {
    const poLines = poQ.data?.lineItems ?? [];
    const invLines = ocrQ.data?.line_items ?? [];

    // Index PO lines by normalised item code, first wins (backend parity).
    const poByItem = new Map<string, (typeof poLines)[number]>();
    for (const pl of poLines) {
      const key = itemKey(pl.itemCode);
      if (key && !poByItem.has(key)) poByItem.set(key, pl);
    }

    // Aggregate each invoice line's draw onto its matched PO line; collect the
    // invoice lines that match no PO line at all.
    interface Agg {
      qty: number;
      billedUnit: number | null;
      priceMismatch: boolean;
    }
    const aggByKey = new Map<string, Agg>();
    const unmatched: (typeof invLines)[number][] = [];
    for (const il of invLines) {
      const key = itemKey(il.item_code);
      const pl = key ? poByItem.get(key) : undefined;
      if (!key || !pl) {
        unmatched.push(il);
        continue;
      }
      const invPrice = il.unit_price ?? null;
      const poPrice = pl.unitPrice ?? null;
      const mismatch =
        invPrice != null && poPrice != null && Math.abs(invPrice - poPrice) > MONEY_EPS;
      const cur = aggByKey.get(key) ?? { qty: 0, billedUnit: invPrice, priceMismatch: false };
      cur.qty += Number(il.quantity ?? 0);
      if (cur.billedUnit == null) cur.billedUnit = invPrice;
      if (mismatch) cur.priceMismatch = true;
      aggByKey.set(key, cur);
    }

    const out: CompareRow[] = [];

    // One row per PO line, in PO order.
    for (const poLine of poLines) {
      const key = itemKey(poLine.itemCode);
      const agg = key ? aggByKey.get(key) : undefined;
      const orderedQty = poLine.orderedQty ?? null;
      const remainingQty = poLine.remainingQty ?? null;
      const poUnit = poLine.unitPrice ?? null;
      const invoiceQty = agg ? agg.qty : null;
      const billedUnit = agg ? agg.billedUnit : null;

      const remainingAfterMatch =
        agg != null && remainingQty != null ? remainingQty - agg.qty : null;

      const reasons: string[] = [];
      const overbilled =
        agg != null && remainingQty != null && agg.qty > remainingQty + QTY_EPS;
      const priceMismatch = agg != null && agg.priceMismatch;
      if (overbilled) reasons.push(`Qty ${agg!.qty} > remaining ${remainingQty}`);
      if (priceMismatch) {
        reasons.push(`Unit price ${billedUnit ?? '—'} != PO ${poUnit ?? '—'}`);
      }

      out.push({
        itemCode: poLine.itemCode,
        description: poLine.description,
        invoiceQty,
        orderedQty,
        remainingQty,
        remainingAfterMatch,
        poUnit,
        billedUnit,
        overbilled,
        priceMismatch,
        unmatched: false,
        note: reasons.join(' · '),
      });
    }

    // Invoice lines with no PO counterpart (backend: blocking "no matching PO line").
    for (const il of unmatched) {
      out.push({
        itemCode: il.item_code ?? null,
        description: il.description ?? '(no description)',
        invoiceQty: il.quantity ?? null,
        orderedQty: null,
        remainingQty: null,
        remainingAfterMatch: null,
        poUnit: null,
        billedUnit: il.unit_price ?? null,
        overbilled: false,
        priceMismatch: false,
        unmatched: true,
        note: 'No matching PO line',
      });
    }

    return out;
  }, [poQ.data, ocrQ.data]);

  // ── Header-level flags (also surfaced on the Invoice/PO cards) ────────────
  const panelsLoaded = !!poQ.data && !poQ.isLoading;
  const poMissing = !po || (!poQ.isLoading && (poQ.isError || !poQ.data));
  const supplierMismatch =
    !!invoice &&
    !!poQ.data &&
    invoice.supplierName.trim().toLowerCase() !==
      poQ.data.supplierName.trim().toLowerCase();
  // Currency mismatch is a BLOCKING match discrepancy (see the discrepancies
  // memo and match.service.ts). Surface it on the cards the same way supplier
  // mismatch is. Only assert a mismatch when both sides declare a currency.
  const currencyMismatch =
    !!invoice &&
    !!poQ.data &&
    (invoice.currency ?? '').trim().toUpperCase().length > 0 &&
    (poQ.data.currency ?? '').trim().toUpperCase().length > 0 &&
    (invoice.currency ?? '').trim().toUpperCase() !==
      (poQ.data.currency ?? '').trim().toUpperCase();
  // Multiple invoices may draw against one PO, so the invoice total need not
  // equal the PO total. The backend does NOT block on this; flag it only when
  // the invoice would OVERDRAW the PO's remaining amount (a warning, not a
  // blocker) so partial invoices are treated as normal.
  const totalMismatch =
    !!invoice &&
    !!poQ.data &&
    Number(invoice.totalAmount) > Number(poQ.data.remainingAmount) + MONEY_EPS;

  // ── Warnings (non-blocking — mirror the backend's non-blocking flags) ─────
  const warnings = useMemo(() => {
    const list: string[] = [];
    if (totalMismatch && invoice && poQ.data) {
      list.push(
        `Invoice total ${formatCurrency(Number(invoice.totalAmount), invoice.currency)} exceeds PO remaining ${formatCurrency(Number(poQ.data.remainingAmount), poQ.data.currency)}. The 2-way match does not block on this, but review before confirming.`,
      );
    }
    return list;
  }, [totalMismatch, invoice, poQ.data]);

  // ── Discrepancies (mirror the backend's BLOCKING set exactly) ─────────────
  // These gate the Confirm button and must match match.service.ts `evaluate`:
  // no PO / PO not found, supplier mismatch, currency mismatch, PO with no
  // lines, invoice with no lines, and every per-line blocking issue (unmatched
  // item code, qty over remaining, unit-price mismatch).
  const discrepancies = useMemo(() => {
    const list: string[] = [];
    if (!invoice) return list;

    if (!po) {
      list.push('Invoice has no PO number — cannot match.');
      return list;
    }
    if (!poQ.isLoading && (poQ.isError || !poQ.data)) {
      list.push(`Purchase order ${po} not found.`);
      return list;
    }
    if (!poQ.data) return list; // still loading — no verdict yet

    if (supplierMismatch) {
      list.push(
        `Supplier mismatch: invoice '${invoice.supplierName}' vs PO '${poQ.data.supplierName}'.`,
      );
    }
    if (currencyMismatch) {
      const invCur = (invoice.currency ?? '').trim().toUpperCase();
      const poCur = (poQ.data.currency ?? '').trim().toUpperCase();
      list.push(`Currency mismatch: invoice ${invCur} vs PO ${poCur}.`);
    }
    if ((poQ.data.lineItems ?? []).length === 0) {
      list.push(`Purchase order ${po} has no line items to match against.`);
    }
    // Invoice lines come from the OCR record; only assert emptiness once it has
    // loaded (a 404 means we can't preview lines, not that there are none).
    if (ocrQ.data && (ocrQ.data.line_items ?? []).length === 0) {
      list.push('Invoice has no line items — cannot perform a line-level match.');
    }
    // Invoice-total internal consistency (mirror of the backend gate and
    // evaluate()): subtotal must equal the sum of line quantity x unitPrice and
    // total must equal subtotal - discount + tax. Blocking.
    if (ocrQ.data) {
      const priced = (ocrQ.data.line_items ?? []).filter(
        (l) => l.quantity != null && l.unit_price != null,
      );
      if (priced.length > 0) {
        const computedSubtotal = priced.reduce(
          (s, l) => s + Number(l.quantity) * Number(l.unit_price),
          0,
        );
        const subtotal = ocrQ.data.subtotal ?? computedSubtotal;
        const discount = ocrQ.data.discount ?? 0;
        const tax = ocrQ.data.tax_amount ?? 0;
        const total = ocrQ.data.total_amount ?? Number(invoice.totalAmount);
        const expectedTotal = subtotal - discount + tax;
        if (
          Math.abs(computedSubtotal - subtotal) > MONEY_EPS ||
          Math.abs(total - expectedTotal) > MONEY_EPS
        ) {
          list.push(
            `Invoice total is not internally consistent: line items sum to ${computedSubtotal.toFixed(2)}, declared total ${total.toFixed(2)} vs expected subtotal - discount + tax (${expectedTotal.toFixed(2)}).`,
          );
        }
      }
    }
    for (const r of rows) {
      if (r.overbilled || r.priceMismatch || r.unmatched) {
        list.push(`${r.itemCode ?? r.description}: ${r.note}.`);
      }
    }
    return list;
  }, [invoice, po, poQ.data, poQ.isError, poQ.isLoading, ocrQ.data, rows, supplierMismatch, currencyMismatch]);

  // PRD UI-B-05 (Phase 1, 2-way), step 1: "Confirm match" is enabled only when
  // the invoice is PENDING_MATCH, the PO panel has loaded, AND no discrepancies
  // are present. Until then the button stays dark/non-functional. The separate
  // "Ready to Submit" queue handles step 2 (MATCHED -> PENDING_APPROVAL).
  // Goods Receipt (3-way) is deferred to Phase 2.
  const canConfirmMatch =
    !!invoice &&
    invoice.status === 'PENDING_MATCH' &&
    panelsLoaded &&
    discrepancies.length === 0;

  const flag = useMutation({
    mutationFn: (id: string) => {
      const note = attachment
        ? `${notes || ''} [attachment: ${attachment}]`.trim()
        : notes || undefined;
      return invoicesApi.flagException(id, reasonCode, note);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_MATCH') });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Flagged as exception');
      setFlagOpen(false);
      setNotes('');
      setAttachment('');
      setSelected(null);
    },
    onError: (err) => toast.error(extractApiError(err, 'Flag failed')),
  });

  function doConfirmMatch() {
    if (!activeId) return;
    setConfirmOpen(false);
    confirmMatch.mutate(activeId, {
      onSuccess: () => {
        setSelected(null);
        // Forward to step 2 of the flow so the just-matched invoice can be
        // submitted for approval, instead of stranding the user here.
        router.push('/ready-to-submit');
      },
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">
          2-Way / 3-Way Match
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Reconcile each invoice against its purchase order and goods receipts.
        </p>
      </div>

      {/* Lifecycle roadmap for the invoice on the workbench. */}
      {invoice && (
        <Card>
          <CardContent className="px-4 py-3.5">
            <LifecycleStepper invoice={invoice} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Queue */}
        <Card>
          <CardContent className="p-3">
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              Ready to match ({queue.length})
            </p>
            <div className="max-h-[64vh] space-y-1 overflow-y-auto">
              {queueQ.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
              ) : queue.length === 0 ? (
                <p className="px-1 py-8 text-center text-[13px] text-ink-muted">
                  Nothing ready to match.
                </p>
              ) : (
                queue.map((inv) => (
                  <button
                    key={inv.id}
                    onClick={() => setSelected(inv.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      inv.id === activeId ? 'border-brand-200 bg-brand-50' : 'border-transparent hover:bg-canvas'
                    }`}
                  >
                    <p className="truncate text-[13px] font-medium text-ink">{inv.invoiceNumber}</p>
                    <p className="truncate text-[11.5px] text-ink-muted">
                      {inv.poNumber ? `PO ${inv.poNumber}` : 'No PO'}
                    </p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Workbench */}
        {!activeId || !invoice ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-20 text-center">
              <GitMerge className="h-8 w-8 text-ink-subtle" />
              <p className="text-[13px] text-ink-muted">Select an invoice to start matching.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Discrepancy banner */}
            {discrepancies.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                No discrepancies detected — ready to submit for approval.
              </div>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  {discrepancies.length} discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} detected
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-[12.5px] text-amber-800">
                  {discrepancies.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Non-blocking warnings (match still allowed) */}
            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-[13px] text-amber-900">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Warning
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-[12.5px] text-amber-800">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Header tri-panel */}
            <div className="grid gap-3 xl:grid-cols-3">
              <Panel title={invoice.invoiceNumber} icon={FileText} scroll>
                <KV k="PO #" v={invoice.poNumber ?? '—'} danger={poMissing} />
                <KV k="Supplier" v={invoice.supplierName} danger={supplierMismatch} />
                <KV k="Currency" v={invoice.currency ?? '—'} danger={currencyMismatch} />
                <KV
                  k="Total"
                  v={formatCurrency(Number(invoice.totalAmount), invoice.currency)}
                  strong
                  danger={totalMismatch}
                />

                {/* Already-approved invoices for this PO (collapsed by default). */}
                {po && (
                  <div className="mt-3 border-t border-line pt-2">
                    <button
                      type="button"
                      onClick={() => setApprovedOpen((o) => !o)}
                      className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition hover:bg-canvas"
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-ink-subtle transition-transform ${
                          approvedOpen ? 'rotate-90' : ''
                        }`}
                      />
                      <span className="text-[11.5px] font-semibold text-ink">
                        Approved Invoices ({approvedInvoices.length})
                      </span>
                    </button>
                    {approvedOpen && (
                      <div className="mt-1.5 space-y-1.5">
                        {approvedInvoicesQ.isLoading ? (
                          <Skeleton className="h-12 w-full" />
                        ) : approvedInvoices.length === 0 ? (
                          <p className="px-1 py-2 text-center text-[11.5px] text-ink-muted">
                            No approved invoices for this PO.
                          </p>
                        ) : (
                          approvedInvoices.map((ai) => (
                            <div
                              key={ai.id}
                              className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[12px] font-medium text-emerald-900">
                                  {ai.invoiceNumber}
                                </span>
                                <span className="text-[12px] font-semibold tabular-nums text-emerald-900">
                                  {formatCurrency(Number(ai.totalAmount), ai.currency)}
                                </span>
                              </div>
                              <p className="mt-0.5 text-[10.5px] text-emerald-700">
                                Approved {new Date(ai.updatedAt).toLocaleDateString()}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Panel>

              <Panel title={poQ.data?.poNumber ?? 'Purchase Order'} icon={ShoppingCart}>
                {poQ.isLoading ? (
                  <PanelSkeleton />
                ) : poQ.isError || !poQ.data ? (
                  <PanelEmpty text={po ? 'PO not found.' : 'No PO on invoice.'} />
                ) : (
                  <>
                    <KV k="PO #" v={poQ.data.poNumber} />
                    <KV k="Supplier" v={poQ.data.supplierName} danger={supplierMismatch} />
                    <KV k="Currency" v={poQ.data.currency ?? '—'} danger={currencyMismatch} />
                    <KV
                      k="Total"
                      v={formatCurrency(Number(poQ.data.totalAmount), poQ.data.currency)}
                    />
                    <KV
                      k="Remaining"
                      v={formatCurrency(Number(poQ.data.remainingAmount), poQ.data.currency)}
                      strong
                      danger={totalMismatch}
                    />
                  </>
                )}
              </Panel>

              {/* Goods Receipt (3-way) is deferred to Phase 2 — shown blocked. */}
              <div className="pointer-events-none relative select-none opacity-60">
                <span className="absolute right-3 top-3 z-10 rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Phase 2
                </span>
                <Panel title="Goods Receipt (CMS)" icon={Boxes}>
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <Lock className="h-5 w-5 text-ink-subtle" />
                    <p className="text-[12.5px] font-medium text-ink-muted">
                      3-way match — Phase 2
                    </p>
                    <p className="text-[11px] text-ink-subtle">
                      Goods Receipt reconciliation is not enabled in Phase 1.
                    </p>
                  </div>
                </Panel>
              </div>
            </div>

            {/* Aligned line comparison (PRD UI-B-02) */}
            <Card>
              <CardContent className="py-4">
                <h3 className="mb-2 text-[13px] font-semibold text-ink">Line-by-line comparison</h3>
                {poQ.isLoading ? (
                  <PanelSkeleton />
                ) : rows.length === 0 ? (
                  <p className="py-4 text-center text-[12.5px] text-ink-muted">
                    No comparable line items {po ? 'for this PO.' : '— invoice has no PO.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-line">
                    <table className="w-full min-w-[680px] text-left text-[12px]">
                      <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-ink-subtle">
                        <tr>
                          <th className="px-2.5 py-1.5">Item Code</th>
                          <th className="px-2.5 py-1.5">Item Desc.</th>
                          <th className="px-2.5 py-1.5 text-center">Qty. in INV</th>
                          <th className="px-2.5 py-1.5 text-center">PO Available Qty</th>
                          <th className="px-2.5 py-1.5 text-center">PO Remaining Qty after Match</th>
                          <th className="px-2.5 py-1.5 text-center">Price/Unit</th>
                          <th className="px-2.5 py-1.5 text-center">Billed Unit</th>
                          <th className="px-2.5 py-1.5 text-center">Flag</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Discrepancies highlight only the cells they implicate
                            (not the whole row): overbilled -> remaining-after-match,
                            price mismatch -> both unit-price cells, unmatched ->
                            item code; the Flag cell lights up for any of them. */}
                        {rows.map((r, i) => {
                          const bad = r.overbilled || r.priceMismatch || r.unmatched;
                          const badCell = 'bg-rose-100 font-medium text-rose-700';
                          return (
                            <tr key={i} className="border-t border-line/60">
                              <td
                                className={`px-2.5 py-1.5 font-medium ${
                                  r.unmatched ? badCell : 'text-ink'
                                }`}
                              >
                                {r.itemCode ?? '—'}
                              </td>
                              <td className="px-2.5 py-1.5">{r.description}</td>
                              <td className="px-2.5 py-1.5 text-center tabular-nums">{r.invoiceQty ?? '—'}</td>
                              <td className="px-2.5 py-1.5 text-center tabular-nums">{r.remainingQty ?? '—'}</td>
                              <td
                                className={`px-2.5 py-1.5 text-center tabular-nums ${
                                  r.overbilled ? badCell : ''
                                }`}
                              >
                                {r.remainingAfterMatch == null
                                  ? '—'
                                  : // Trim float noise from the subtraction (e.g. 0.30000000000000004)
                                    Number(r.remainingAfterMatch.toFixed(6))}
                              </td>
                              <td
                                className={`px-2.5 py-1.5 text-center tabular-nums ${
                                  r.priceMismatch ? badCell : ''
                                }`}
                              >
                                {r.poUnit ?? '—'}
                              </td>
                              <td
                                className={`px-2.5 py-1.5 text-center tabular-nums ${
                                  r.priceMismatch ? badCell : ''
                                }`}
                              >
                                {r.billedUnit ?? '—'}
                              </td>
                              <td className={`px-2.5 py-1.5 text-center ${bad ? 'bg-rose-100' : ''}`}>
                                {bad ? (
                                  <span className="font-medium text-rose-700">{r.note}</span>
                                ) : (
                                  <span className="text-emerald-600">OK</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => router.push(`/side-by-side?invoice=${activeId}`)}
                title="Review the invoice and PO documents side by side"
              >
                <Columns3 className="h-4 w-4" />
                Side by Side view
              </Button>
              <Button
                variant="secondary"
                onClick={() => setFlagOpen(true)}
                disabled={flag.isPending || invoice.status !== 'PENDING_MATCH'}
                title={
                  invoice.status !== 'PENDING_MATCH'
                    ? 'Only a pending-match invoice can be flagged'
                    : undefined
                }
              >
                <Flag className="h-4 w-4" />
                Flag exception
              </Button>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={!canConfirmMatch || confirmMatch.isPending}
                title={
                  invoice.status !== 'PENDING_MATCH'
                    ? 'Invoice is not pending match'
                    : !panelsLoaded
                    ? 'Waiting for PO data to load'
                    : discrepancies.length > 0
                    ? 'Resolve discrepancies first'
                    : undefined
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                {confirmMatch.isPending ? 'Confirming…' : 'Confirm match'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm match modal (PRD UI-B-05, step 1) */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm match</DialogTitle>
          </DialogHeader>
          {invoice && (
            <div className="space-y-2 text-[13px]">
              <Confirm k="Invoice" v={invoice.invoiceNumber} />
              <Confirm k="Supplier" v={invoice.supplierName} />
              <Confirm k="Amount" v={formatCurrency(Number(invoice.totalAmount), invoice.currency)} />
              <p className="pt-1 text-[12px] text-ink-muted">
                This marks the invoice as matched and moves it to the Ready to
                Submit queue, where it can be submitted for approval.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doConfirmMatch} disabled={confirmMatch.isPending}>
              {confirmMatch.isPending ? 'Confirming…' : 'Confirm match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flag exception modal */}
      <Dialog open={flagOpen} onOpenChange={setFlagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag exception</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Reason code</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CODES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="flag-notes">
                Notes{reasonCode === 'OTHER' ? ' (required)' : ''}
              </Label>
              <Textarea
                id="flag-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe the discrepancy"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="flag-file">Attachment (optional)</Label>
              <Input
                id="flag-file"
                type="file"
                onChange={(e) => setAttachment(e.target.files?.[0]?.name ?? '')}
              />
              {attachment && (
                <span className="text-[11.5px] text-ink-muted">Attached: {attachment}</span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setFlagOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={flag.isPending || (reasonCode === 'OTHER' && !notes.trim())}
              onClick={() => activeId && flag.mutate(activeId)}
            >
              {flag.isPending ? 'Flagging…' : 'Flag exception'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
  scroll,
}: {
  title: string;
  icon: typeof FileText;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
          <Icon className="h-4 w-4 text-brand" />
          <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        </div>
        <div className={`space-y-1.5 ${scroll ? 'max-h-[420px] overflow-y-auto pr-1' : ''}`}>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function KV({
  k,
  v,
  strong,
  danger,
}: {
  k: string;
  v: React.ReactNode;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded ${
        danger ? '-mx-1.5 bg-rose-50 px-1.5 py-0.5' : ''
      }`}
    >
      <span className={`text-[11.5px] ${danger ? 'text-rose-600' : 'text-ink-subtle'}`}>{k}</span>
      <span
        className={`text-[12.5px] ${
          danger
            ? 'font-medium text-rose-700'
            : strong
            ? 'font-semibold text-ink'
            : 'text-ink'
        }`}
      >
        {v}
      </span>
    </div>
  );
}

function Confirm({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-1.5">
      <span className="text-ink-subtle">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

function PanelEmpty({ text }: { text: string }) {
  return <p className="py-6 text-center text-[12px] text-ink-muted">{text}</p>;
}
