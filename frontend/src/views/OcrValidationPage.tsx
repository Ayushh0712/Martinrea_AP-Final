'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Plus, RefreshCw, ScanLine, Send, Trash2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DocumentViewer } from '@/components/invoices/DocumentViewer';
import { LifecycleStepper } from '@/components/invoices/LifecycleStepper';
import {
  extractApiError,
  extractionsApi,
  type ExtractionFields,
  type ExtractionLineItem,
  type SendForMatchingBody,
} from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

const EXTRACTIONS_KEY = ['ocr', 'extractions'] as const;

interface DraftFields {
  invoiceNumber: string;
  poNumber: string;
  supplierName: string;
  supplierTaxId: string;
  invoiceDate: string;
  subtotal: string;
  taxAmount: string;
  discount: string;
  totalAmount: string;
  currency: string;
}

const EMPTY_DRAFT: DraftFields = {
  invoiceNumber: '',
  poNumber: '',
  supplierName: '',
  supplierTaxId: '',
  invoiceDate: '',
  subtotal: '',
  taxAmount: '',
  discount: '',
  totalAmount: '',
  currency: '',
};

function toDraft(f?: ExtractionFields | null): DraftFields {
  if (!f) return { ...EMPTY_DRAFT };
  return {
    invoiceNumber: f.invoiceNumber ?? '',
    poNumber: f.poNumber ?? '',
    supplierName: f.supplierName ?? '',
    supplierTaxId: f.supplierTaxId ?? '',
    invoiceDate: f.invoiceDate ?? '',
    subtotal: f.subtotal != null ? String(f.subtotal) : '',
    taxAmount: f.taxAmount != null ? String(f.taxAmount) : '',
    discount: '',
    totalAmount: f.totalAmount != null ? String(f.totalAmount) : '',
    currency: f.currency ?? '',
  };
}

/**
 * An editable line-item row. Only the quantity and unit price are captured; the
 * line total is always derived as quantity x unitPrice (never entered), so the
 * three figures can never disagree.
 */
interface DraftLine {
  itemCode: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_LINE: DraftLine = {
  itemCode: '',
  description: '',
  quantity: '',
  unitPrice: '',
};

function toDraftLines(f?: ExtractionFields | null): DraftLine[] {
  return (f?.lineItems ?? []).map((l) => ({
    itemCode: l.itemCode ?? '',
    description: l.description ?? '',
    quantity: l.quantity != null ? String(l.quantity) : '',
    unitPrice: l.unitPrice != null ? String(l.unitPrice) : '',
  }));
}

/** Parse a numeric text field: blank -> null, invalid -> null. */
function num(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Derived line total = quantity x unitPrice (null unless both are present). */
function lineTotalOf(l: DraftLine): number | null {
  const q = num(l.quantity);
  const u = num(l.unitPrice);
  return q != null && u != null ? q * u : null;
}

// Money comparison tolerance (half a cent). Mirrors the backend gate and the
// 2-way match engine so the client-side pre-check predicts the same verdict.
const MONEY_EPS = 0.005;

/**
 * Invoice-total consistency check (client mirror of the backend gate). Returns
 * a human-readable message when the totals don't reconcile, else null. The
 * subtotal must equal the sum of line quantity x unitPrice, and the declared
 * total must equal subtotal - discount + tax.
 */
function validateInvoiceTotals(
  draft: DraftFields,
  lines: DraftLine[],
): string | null {
  const priced = lines.filter(
    (l) => num(l.quantity) != null && num(l.unitPrice) != null,
  );
  if (priced.length === 0) return null;
  const computedSubtotal = priced.reduce(
    (sum, l) => sum + num(l.quantity)! * num(l.unitPrice)!,
    0,
  );
  const subtotal = num(draft.subtotal) ?? computedSubtotal;
  const discount = num(draft.discount) ?? 0;
  const tax = num(draft.taxAmount) ?? 0;
  const total = num(draft.totalAmount) ?? 0;
  const expectedTotal = subtotal - discount + tax;
  const linesVsSubtotal = Math.abs(computedSubtotal - subtotal) > MONEY_EPS;
  const headerMath = Math.abs(total - expectedTotal) > MONEY_EPS;
  if (!linesVsSubtotal && !headerMath) return null;
  return (
    `Line items sum to ${computedSubtotal.toFixed(2)}, subtotal is ` +
    `${subtotal.toFixed(2)}, and the declared total ${total.toFixed(2)} ` +
    `should equal subtotal - discount + tax (${expectedTotal.toFixed(2)}). ` +
    'Fix the amounts and try again.'
  );
}

export default function OcrValidationPage() {
  const qc = useQueryClient();
  const router = useRouter();

  // In-memory OCR extractions produced by the OCI auto-ingest poller. Poll the
  // list so results from the backend scan appear without a reload.
  const listQ = useQuery({
    queryKey: EXTRACTIONS_KEY,
    queryFn: () => extractionsApi.list(),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
  const extractions = listQ.data ?? [];

  const scan = useMutation({
    mutationFn: () => extractionsApi.scan(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: EXTRACTIONS_KEY });
      toast.success(
        `Scan complete — ${r.ingested} new, ${r.skipped} already extracted (${r.scanned} scanned)`,
      );
    },
    onError: (err) => toast.error(extractApiError(err, 'Scan failed')),
  });

  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? extractions[0]?.id ?? null;
  const active = useMemo(
    () => extractions.find((e) => e.id === activeId) ?? null,
    [extractions, activeId],
  );
  const fields = active?.fields;
  const lowConfidence =
    !!fields && (fields.requiresReview || (fields.confidenceScore ?? 100) < 80);

  // Editable draft, reset whenever the selected extraction changes. Polling of
  // the list does not clobber in-progress edits because activeId stays stable.
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  // Message shown in the "Invalid invoice" warning dialog (null = closed).
  const [totalError, setTotalError] = useState<string | null>(null);
  useEffect(() => {
    const current = extractions.find((e) => e.id === activeId) ?? null;
    setDraft(toDraft(current?.fields));
    setDraftLines(toDraftLines(current?.fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const setField = (key: keyof DraftFields) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const setLineField = (idx: number, key: keyof DraftLine) => (value: string) =>
    setDraftLines((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
    );
  const addLine = () => setDraftLines((rows) => [...rows, { ...EMPTY_LINE }]);
  const removeLine = (idx: number) =>
    setDraftLines((rows) => rows.filter((_, i) => i !== idx));

  // Only send rows that carry at least one meaningful value.
  const buildLineItems = (): ExtractionLineItem[] =>
    draftLines
      .filter(
        (l) =>
          l.itemCode.trim() ||
          l.description.trim() ||
          l.quantity.trim() ||
          l.unitPrice.trim(),
      )
      .map((l) => ({
        itemCode: l.itemCode.trim() || null,
        description: l.description.trim() || null,
        quantity: num(l.quantity),
        unitPrice: num(l.unitPrice),
        // Always derived from quantity x unitPrice, never hand-entered.
        lineTotal: lineTotalOf(l),
      }));

  const buildBody = (): SendForMatchingBody => ({
    invoiceNumber: draft.invoiceNumber.trim() || null,
    poNumber: draft.poNumber.trim() || null,
    supplierName: draft.supplierName.trim() || null,
    supplierTaxId: draft.supplierTaxId.trim() || null,
    invoiceDate: draft.invoiceDate.trim() || null,
    subtotal: num(draft.subtotal),
    taxAmount: num(draft.taxAmount),
    discount: num(draft.discount),
    totalAmount: num(draft.totalAmount),
    currency: draft.currency.trim() || null,
    confidenceScore: fields?.confidenceScore ?? null,
    documentType: fields?.documentType,
    language: fields?.language ?? null,
    lineItems: buildLineItems(),
  });

  const send = useMutation({
    mutationFn: () => {
      if (!activeId) throw new Error('No extraction selected');
      return extractionsApi.sendForMatching(activeId, buildBody());
    },
    onSuccess: (invoice) => {
      qc.invalidateQueries({ queryKey: EXTRACTIONS_KEY });
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_MATCH') });
      setSelected(null);
      toast.success('Sent for matching');
      router.push(`/match?invoice=${invoice.id}`);
    },
    onError: (err) => {
      const msg = extractApiError(err, 'Send for matching failed');
      // The backend gate rejects an internally inconsistent invoice with this
      // message; surface it in the warning dialog (extraction stays in OCR
      // Processing) rather than a transient toast.
      if (/total price is not correct/i.test(msg)) setTotalError(msg);
      else toast.error(msg);
    },
  });

  // Send stays clickable; run the consistency pre-check first. On failure open
  // the warning dialog and keep the invoice on the OCR screen (no API call).
  const handleSend = () => {
    const msg = validateInvoiceTotals(draft, draftLines);
    if (msg) {
      setTotalError(msg);
      return;
    }
    send.mutate();
  };

  const reject = useMutation({
    mutationFn: () => {
      if (!activeId) throw new Error('No extraction selected');
      return extractionsApi.reject(activeId, buildBody());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EXTRACTIONS_KEY });
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('EXCEPTION') });
      setSelected(null);
      toast.success('Invoice rejected — sent to exceptions');
      router.push('/invoices?status=EXCEPTION');
    },
    onError: (err) => toast.error(extractApiError(err, 'Reject failed')),
  });

  const busy = send.isPending || reject.isPending;

  // 2-way matching keys on PO + supplier + total; require them before sending.
  const canSend =
    !!active &&
    draft.poNumber.trim() !== '' &&
    draft.supplierName.trim() !== '' &&
    num(draft.totalAmount) != null &&
    !busy;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">
            OCR Validation
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            OCR results auto-ingested from OCI (AP-Accepted_Correct). Review and
            edit the extracted fields, then send the invoice for 2-way matching.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
        >
          <RefreshCw className={`h-4 w-4 ${scan.isPending ? 'animate-spin' : ''}`} />
          {scan.isPending ? 'Scanning…' : 'Scan now'}
        </Button>
      </div>

      {/* Lifecycle preview: extractions aren't persisted invoices yet, so the
          roadmap always shows Review as the live stage. */}
      {active && (
        <Card>
          <CardContent className="px-4 py-3.5">
            <LifecycleStepper preview />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Extractions list */}
        <Card>
          <CardContent className="p-3">
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              Extractions ({extractions.length})
            </p>
            <div className="max-h-[64vh] space-y-1 overflow-y-auto">
              {listQ.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))
              ) : extractions.length === 0 ? (
                <p className="px-1 py-8 text-center text-[13px] text-ink-muted">
                  No extractions yet. Drop invoices into the OCI folder or click
                  “Scan now”.
                </p>
              ) : (
                extractions.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setSelected(e.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      e.id === activeId
                        ? 'border-brand-200 bg-brand-50'
                        : 'border-transparent hover:bg-canvas'
                    }`}
                  >
                    <p className="truncate text-[13px] font-medium text-ink">
                      {e.fields.invoiceNumber ?? e.originalFilename}
                    </p>
                    <p className="truncate text-[11.5px] text-ink-muted">
                      {e.fields.supplierName ?? e.originalFilename}
                    </p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Split-screen: document + fields */}
        {!active ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-20 text-center">
              <ScanLine className="h-8 w-8 text-ink-subtle" />
              <p className="text-[13px] text-ink-muted">
                Select an extraction to review its fields.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {/* Left: document */}
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="h-[64vh]">
                  <DocumentViewer
                    extractionId={active.id}
                    directUrl={active.viewUrl}
                    filename={active.originalFilename}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Right: extracted fields (editable) */}
            <Card>
              <CardContent className="space-y-4 py-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-ink">
                    Extracted fields
                  </h2>
                  <span className="text-[11.5px] text-ink-muted">
                    {fields?.documentType}
                    {fields?.language ? ` · ${fields.language}` : ''}
                  </span>
                </div>

                {lowConfidence && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      OCR confidence low
                      {fields?.confidenceScore != null
                        ? ` (${Math.round(fields.confidenceScore)}%)`
                        : ''}
                      {fields?.reviewReason ? ` — ${fields.reviewReason}` : ''}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <EditableField
                    label="Invoice number"
                    value={draft.invoiceNumber}
                    onChange={setField('invoiceNumber')}
                  />
                  <EditableField
                    label="PO number"
                    value={draft.poNumber}
                    onChange={setField('poNumber')}
                  />
                  <div className="col-span-2">
                    <EditableField
                      label="Supplier"
                      value={draft.supplierName}
                      onChange={setField('supplierName')}
                    />
                  </div>
                  <EditableField
                    label="Supplier tax ID"
                    value={draft.supplierTaxId}
                    onChange={setField('supplierTaxId')}
                  />
                  <EditableField
                    label="Invoice date"
                    value={draft.invoiceDate}
                    onChange={setField('invoiceDate')}
                    placeholder="YYYY-MM-DD"
                  />
                  <EditableField
                    label="Subtotal"
                    value={draft.subtotal}
                    onChange={setField('subtotal')}
                    type="number"
                  />
                  <EditableField
                    label="Tax"
                    value={draft.taxAmount}
                    onChange={setField('taxAmount')}
                    type="number"
                  />
                  <EditableField
                    label="Discount"
                    value={draft.discount}
                    onChange={setField('discount')}
                    type="number"
                  />
                  <EditableField
                    label="Total amount"
                    value={draft.totalAmount}
                    onChange={setField('totalAmount')}
                    type="number"
                  />
                  <EditableField
                    label="Currency"
                    value={draft.currency}
                    onChange={setField('currency')}
                  />
                </div>

                {/* Line items (editable — Item Code drives the 2-way match) */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                      Line items ({draftLines.length})
                    </p>
                    <Button variant="secondary" size="sm" onClick={addLine}>
                      <Plus className="h-3.5 w-3.5" />
                      Add line
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-line">
                    <table className="w-full min-w-[560px] text-left text-[12px]">
                      <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-ink-subtle">
                        <tr>
                          <th className="px-2 py-1.5">Item Code</th>
                          <th className="px-2 py-1.5">Description</th>
                          <th className="px-2 py-1.5 text-right">Qty</th>
                          <th className="px-2 py-1.5 text-right">Unit</th>
                          <th className="px-2 py-1.5 text-right">Total</th>
                          <th className="w-8 px-2 py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {draftLines.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-2 py-4 text-center text-[11.5px] text-ink-subtle"
                            >
                              No line items extracted. Add rows manually — the
                              Item Code must match the PO to pass 2-way matching.
                            </td>
                          </tr>
                        ) : (
                          draftLines.map((l, i) => (
                            <tr key={i} className="border-t border-line/60">
                              <td className="px-1 py-1">
                                <LineInput
                                  value={l.itemCode}
                                  onChange={setLineField(i, 'itemCode')}
                                  placeholder="e.g. STL-CR-0.18x36"
                                />
                              </td>
                              <td className="px-1 py-1">
                                <LineInput
                                  value={l.description}
                                  onChange={setLineField(i, 'description')}
                                />
                              </td>
                              <td className="px-1 py-1">
                                <LineInput
                                  value={l.quantity}
                                  onChange={setLineField(i, 'quantity')}
                                  type="number"
                                  align="right"
                                />
                              </td>
                              <td className="px-1 py-1">
                                <LineInput
                                  value={l.unitPrice}
                                  onChange={setLineField(i, 'unitPrice')}
                                  type="number"
                                  align="right"
                                />
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-[12px] text-ink">
                                {lineTotalOf(l) != null
                                  ? lineTotalOf(l)!.toFixed(2)
                                  : '—'}
                              </td>
                              <td className="px-1 py-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeLine(i)}
                                  className="rounded p-1 text-ink-subtle transition-colors hover:text-red-600"
                                  aria-label="Remove line"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-line pt-4 text-[11.5px] text-ink-muted">
                  <span>{active.originalFilename}</span>
                  <span>
                    Extracted {new Date(active.extractedAt).toLocaleString()}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={() => reject.mutate()}
                      disabled={busy}
                      className="flex-1"
                    >
                      <XCircle className="h-4 w-4" />
                      {reject.isPending ? 'Rejecting…' : 'Reject Invoice'}
                    </Button>
                    <Button
                      onClick={handleSend}
                      disabled={!canSend}
                      className="flex-1"
                    >
                      <Send className="h-4 w-4" />
                      {send.isPending ? 'Sending…' : 'Send for Matching'}
                    </Button>
                  </div>
                  {!busy && !canSend && (
                    <p className="text-center text-[11.5px] text-ink-subtle">
                      Supplier, PO number and total amount are required to send
                      for matching.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog
        open={!!totalError}
        onOpenChange={(open) => !open && setTotalError(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Invalid invoice — total price is not correct
            </DialogTitle>
            <DialogDescription>{totalError}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTotalError(null)}>
              Back to review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] uppercase tracking-wide text-ink-subtle">
        {label}
      </Label>
      <Input
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 text-[13px]"
      />
    </div>
  );
}

/** Compact borderless input used inside the editable line-items table. */
function LineInput({
  value,
  onChange,
  type = 'text',
  align = 'left',
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  align?: 'left' | 'right';
  placeholder?: string;
}) {
  return (
    <Input
      value={value}
      type={type}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 border-transparent bg-transparent px-1.5 text-[12px] shadow-none focus-visible:border-input ${
        align === 'right' ? 'text-right tabular-nums' : ''
      }`}
    />
  );
}
