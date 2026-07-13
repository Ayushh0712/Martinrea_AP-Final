'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Flag,
  Plus,
  Send,
  Trash2,
  XCircle,
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/invoices/StatusBadge';
import { DocumentViewer } from '@/components/invoices/DocumentViewer';
import { LifecycleStepper } from '@/components/invoices/LifecycleStepper';
import { extractApiError, invoicesApi, ocrApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useInvoice } from '@/hooks/useInvoices';
import { formatCurrency } from '@/lib/utils';

interface HeaderForm {
  invoiceNumber: string;
  supplierName: string;
  supplierId: string;
  poNumber: string;
  totalAmount: string;
  currency: string;
}

interface LineRow {
  itemCode: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

const PO_FORMAT = /^[A-Za-z0-9-]+$/;

export default function InvoiceReviewPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = (Array.isArray(params?.id) ? params?.id[0] : params?.id) ?? '';

  const invoiceQ = useInvoice(id);
  const ocrQ = useQuery({
    queryKey: id ? queryKeys.ocrInvoice(id) : ['ocr', 'noop'],
    queryFn: () => ocrApi.get(id),
    enabled: !!id,
    retry: false,
  });

  const invoice = invoiceQ.data;
  const ocr = ocrQ.data;

  const [form, setForm] = useState<HeaderForm>({
    invoiceNumber: '',
    supplierName: '',
    supplierId: '',
    poNumber: '',
    totalAmount: '',
    currency: 'USD',
  });
  const [lines, setLines] = useState<LineRow[]>([]);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNotes, setFlagNotes] = useState('');
  const [flagReason, setFlagReason] = useState<string>('OTHER');

  // Hydrate header from the workflow invoice.
  useEffect(() => {
    if (!invoice) return;
    setForm({
      invoiceNumber: invoice.invoiceNumber ?? '',
      supplierName: invoice.supplierName ?? '',
      supplierId: invoice.supplierId ?? '',
      poNumber: invoice.poNumber ?? '',
      totalAmount: String(invoice.totalAmount ?? ''),
      currency: invoice.currency ?? 'USD',
    });
  }, [invoice]);

  // Seed the editable line grid from OCR extraction (if any).
  useEffect(() => {
    if (!ocr?.line_items) return;
    setLines(
      ocr.line_items.map((l) => ({
        itemCode: l.item_code ?? '',
        description: l.description ?? '',
        quantity: l.quantity != null ? String(l.quantity) : '',
        unitPrice: l.unit_price != null ? String(l.unit_price) : '',
      })),
    );
  }, [ocr]);

  const lowConfidence =
    !!ocr && (ocr.requires_review || (ocr.confidence_score ?? 100) < 80);

  // ── Validation (PRD UI-A-04) ──────────────────────────────────────────────
  const errors = useMemo(() => {
    const e: Partial<Record<keyof HeaderForm | 'lines', string>> = {};
    if (!form.invoiceNumber.trim()) e.invoiceNumber = 'Required';
    const amt = Number(form.totalAmount);
    if (!form.totalAmount.trim() || !Number.isFinite(amt) || amt <= 0) {
      e.totalAmount = 'Must be a positive number';
    }
    if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) {
      e.currency = '3-letter code';
    }
    if (form.poNumber.trim() && !PO_FORMAT.test(form.poNumber.trim())) {
      e.poNumber = 'Letters, numbers, hyphens only';
    }
    const badLine = lines.some(
      (l) =>
        (l.quantity.trim() && !Number.isFinite(Number(l.quantity))) ||
        (l.unitPrice.trim() && !Number.isFinite(Number(l.unitPrice))),
    );
    if (badLine) e.lines = 'Quantity and unit price must be numeric';
    return e;
  }, [form, lines]);

  const isValid = Object.keys(errors).length === 0;

  // Flagging as an exception is only legal (backend ALLOWED_TRANSITIONS) from
  // OCR_PROCESSING, PENDING_REVIEW, or PENDING_MATCH. Gate the button so an
  // already-matched/approved invoice can't fire a 409.
  const canFlag =
    !!invoice &&
    ['OCR_PROCESSING', 'PENDING_REVIEW', 'PENDING_MATCH'].includes(invoice.status);

  const save = useMutation({
    mutationFn: async () => {
      // PRD UI-A-09: persist corrected line items (and header) onto the OCR
      // record so they flow into 3-way matching. Only attempt when an OCR
      // record exists for this invoice (manually-created invoices have none).
      if (ocr) {
        await ocrApi.update(id, {
          invoiceNumber: form.invoiceNumber.trim() || undefined,
          supplierName: form.supplierName.trim() || undefined,
          poNumber: form.poNumber.trim() || undefined,
          currency: form.currency.trim().toUpperCase() || undefined,
          lineItems: lines
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
              quantity: l.quantity.trim() ? Number(l.quantity) : null,
              unitPrice: l.unitPrice.trim() ? Number(l.unitPrice) : null,
            })),
        });
      }

      await invoicesApi.update(id, {
        invoiceNumber: form.invoiceNumber.trim(),
        supplierName: form.supplierName.trim(),
        supplierId: form.supplierId.trim() || undefined,
        poNumber: form.poNumber.trim() || undefined,
        totalAmount: Number(form.totalAmount) || 0,
        currency: form.currency.trim().toUpperCase() || 'USD',
      });
      return invoicesApi.submitReview(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_REVIEW') });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: queryKeys.invoice(id) });
      qc.invalidateQueries({ queryKey: queryKeys.ocrInvoice(id) });
      toast.success('Saved & sent for matching');
      router.push(`/match?invoice=${id}`);
    },
    onError: (err) => toast.error(extractApiError(err, 'Save failed')),
  });

  const flag = useMutation({
    mutationFn: () => invoicesApi.flagException(id, flagReason, flagNotes.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: queryKeys.invoice(id) });
      toast.success('Flagged for manual review');
      setFlagOpen(false);
      router.push('/invoices?status=EXCEPTION');
    },
    onError: (err) => toast.error(extractApiError(err, 'Flag failed')),
  });

  function updateLine(idx: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/invoices')}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink">
              Review invoice
            </h1>
            <p className="text-[12.5px] text-ink-muted">
              Verify the extracted data against the original document, then send it to matching.
            </p>
          </div>
        </div>
        {invoice && <StatusBadge status={invoice.status} />}
      </div>

      {/* Lifecycle roadmap for this invoice. */}
      {invoice && (
        <Card>
          <CardContent className="px-4 py-3.5">
            <LifecycleStepper invoice={invoice} />
          </CardContent>
        </Card>
      )}

      {lowConfidence && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[13px] font-medium text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          REQUIRES_REVIEW — OCR Confidence Low
          {ocr?.confidence_score != null ? ` (${Math.round(ocr.confidence_score)}%)` : ''} — Please
          Verify All Fields
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Left: original document */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="h-[72vh]">
              <DocumentViewer
                invoiceId={id}
                filename={ocr?.original_filename ?? invoice?.invoiceNumber}
              />
            </div>
          </CardContent>
        </Card>

        {/* Right: editable fields + line items */}
        <Card className="overflow-hidden">
          <CardContent className="max-h-[72vh] space-y-4 overflow-y-auto py-5">
            {invoiceQ.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : !invoice ? (
              <p className="py-10 text-center text-[13px] text-ink-muted">
                Invoice not found.
              </p>
            ) : (
              <>
                {invoice.rejectionReason && (
                  <div className="flex items-start gap-2.5 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-3 text-[13px] text-rose-800">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Rejection reason</p>
                      <p className="mt-0.5 text-rose-700">{invoice.rejectionReason}</p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Invoice number" value={form.invoiceNumber} error={errors.invoiceNumber} onChange={(v) => setForm((f) => ({ ...f, invoiceNumber: v }))} />
                  <Field label="PO number" value={form.poNumber} error={errors.poNumber} onChange={(v) => setForm((f) => ({ ...f, poNumber: v }))} />
                  <div className="col-span-2">
                    <Field label="Supplier" value={form.supplierName} onChange={(v) => setForm((f) => ({ ...f, supplierName: v }))} />
                  </div>
                  <Field label="Supplier ID" value={form.supplierId} onChange={(v) => setForm((f) => ({ ...f, supplierId: v }))} />
                  {ocr?.invoice_date && (
                    <Field label="Invoice date (OCR)" value={ocr.invoice_date} onChange={() => {}} readOnly />
                  )}
                  <Field label="Total amount" type="number" value={form.totalAmount} error={errors.totalAmount} onChange={(v) => setForm((f) => ({ ...f, totalAmount: v }))} />
                  <Field label="Currency" value={form.currency} error={errors.currency} onChange={(v) => setForm((f) => ({ ...f, currency: v }))} />
                </div>

                {/* Editable line items */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                      Line items
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLines((p) => [...p, { itemCode: '', description: '', quantity: '', unitPrice: '' }])}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add line
                    </Button>
                  </div>
                  {errors.lines && (
                    <p className="mb-1.5 text-[11.5px] text-rose-600">{errors.lines}</p>
                  )}
                  <div className="overflow-hidden rounded-md border border-line">
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-ink-subtle">
                        <tr>
                          <th className="px-2 py-1.5">Item Code</th>
                          <th className="px-2 py-1.5">Description</th>
                          <th className="px-2 py-1.5 text-right">Qty</th>
                          <th className="px-2 py-1.5 text-right">Unit</th>
                          <th className="px-2 py-1.5 text-right">Total</th>
                          <th className="px-2 py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-2 py-4 text-center text-ink-muted">
                              No line items extracted. Add one if needed.
                            </td>
                          </tr>
                        ) : (
                          lines.map((l, i) => {
                            const total = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
                            return (
                              <tr key={i} className="border-t border-line/60">
                                <td className="px-1.5 py-1">
                                  <Input
                                    value={l.itemCode}
                                    onChange={(e) => updateLine(i, { itemCode: e.target.value })}
                                    className="h-8 w-32 text-[12px]"
                                  />
                                </td>
                                <td className="px-1.5 py-1">
                                  <Input
                                    value={l.description}
                                    onChange={(e) => updateLine(i, { description: e.target.value })}
                                    className="h-8 text-[12px]"
                                  />
                                </td>
                                <td className="px-1.5 py-1">
                                  <Input
                                    value={l.quantity}
                                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                                    className="h-8 w-16 text-right text-[12px] tabular-nums"
                                  />
                                </td>
                                <td className="px-1.5 py-1">
                                  <Input
                                    value={l.unitPrice}
                                    onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                                    className="h-8 w-20 text-right text-[12px] tabular-nums"
                                  />
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums text-ink-muted">
                                  {total ? total.toFixed(2) : '—'}
                                </td>
                                <td className="px-1 py-1 text-right">
                                  <button
                                    onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                                    className="rounded p-1 text-ink-subtle hover:text-rose-600"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between border-t border-line pt-4">
                  <span className="text-[12.5px] font-medium text-ink">
                    {form.totalAmount
                      ? formatCurrency(Number(form.totalAmount), form.currency)
                      : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    {invoice && invoice.status !== 'PENDING_REVIEW' && (
                      <span className="text-[11.5px] text-ink-muted">
                        Already sent for matching.
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => setFlagOpen(true)}
                      disabled={flag.isPending || !canFlag}
                      title={
                        !canFlag
                          ? 'This invoice can no longer be flagged for manual review at its current stage'
                          : undefined
                      }
                    >
                      <Flag className="h-4 w-4" />
                      Flag for manual review
                    </Button>
                    <Button
                      onClick={() => save.mutate()}
                      disabled={
                        !isValid || save.isPending || invoice?.status !== 'PENDING_REVIEW'
                      }
                    >
                      <Send className="h-4 w-4" />
                      {save.isPending ? 'Saving…' : 'Save & proceed'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Flag for manual review modal */}
      <Dialog open={flagOpen} onOpenChange={setFlagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag for manual review</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Reason code</Label>
              <Select value={flagReason} onValueChange={setFlagReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRICE_VARIANCE">Price Variance</SelectItem>
                  <SelectItem value="QUANTITY_MISMATCH">Quantity Mismatch</SelectItem>
                  <SelectItem value="DUPLICATE_INVOICE">Duplicate Invoice</SelectItem>
                  <SelectItem value="MISSING_PO">Missing PO</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="review-notes">
                Reason {flagReason === 'OTHER' ? '(required)' : '(optional)'}
              </Label>
              <Textarea
                id="review-notes"
                rows={3}
                value={flagNotes}
                onChange={(e) => setFlagNotes(e.target.value)}
                placeholder="Why does this invoice need a supervisor?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setFlagOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                flag.isPending || (flagReason === 'OTHER' && !flagNotes.trim())
              }
              onClick={() => flag.mutate()}
            >
              {flag.isPending ? 'Flagging…' : 'Flag exception'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  error,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  error?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] uppercase tracking-wide text-ink-subtle">
        {label}
      </Label>
      <Input
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={error ? 'border-rose-300 focus-visible:ring-rose-200' : ''}
      />
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </div>
  );
}
