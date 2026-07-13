'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, GitMerge, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/invoices/StatusBadge';
import { LifecycleStepper } from '@/components/invoices/LifecycleStepper';
import { invoicesApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useSubmitApproval } from '@/hooks/useInvoiceMutations';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { Invoice } from '@/types/invoice';

/**
 * Step 2 of the match workflow (PRD UI-B-05): invoices that have passed the
 * 2-way match now rest in MATCHED. From here the clerk submits each one for
 * approval (MATCHED -> PENDING_APPROVAL), which computes the WF-03 approval
 * chain and notifies the first approver.
 */
export default function ReadyToSubmitPage() {
  const q = useQuery({
    queryKey: queryKeys.invoicesByStatus('MATCHED'),
    queryFn: () => invoicesApi.list('MATCHED'),
    staleTime: 15_000,
  });
  const submit = useSubmitApproval();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const invoices = q.data ?? [];
  const confirmInvoice = invoices.find((i) => i.id === confirmId) ?? null;

  function doSubmit() {
    if (!confirmId) return;
    submit.mutate(confirmId, { onSuccess: () => setConfirmId(null) });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">
          Ready to Submit
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Matched invoices awaiting submission. Submitting routes an invoice
          into the approval chain and notifies the first approver.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-brand" />
            Matched · ready to submit
            <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand">
              {invoices.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <ListSkeleton />
          ) : invoices.length === 0 ? (
            <Empty text="No matched invoices waiting to be submitted." />
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <Row key={inv.id} invoice={inv}>
                  <Button
                    size="sm"
                    disabled={submit.isPending}
                    onClick={() => setConfirmId(inv.id)}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Submit for approval
                  </Button>
                </Row>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit for approval</DialogTitle>
            <DialogDescription>
              This routes the invoice into the approval chain and notifies the
              first approver. You can&apos;t undo this from here.
            </DialogDescription>
          </DialogHeader>
          {confirmInvoice && (
            <div className="space-y-2 text-[13px]">
              <Confirm k="Invoice" v={confirmInvoice.invoiceNumber} />
              <Confirm k="Supplier" v={confirmInvoice.supplierName} />
              <Confirm
                k="Amount"
                v={formatCurrency(
                  Number(confirmInvoice.totalAmount),
                  confirmInvoice.currency,
                )}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button onClick={doSubmit} disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Confirm & submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  invoice,
  children,
}: {
  invoice: Invoice;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-white">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/invoices/${invoice.id}`}
              className="text-[14px] font-semibold text-ink hover:text-brand"
            >
              {invoice.invoiceNumber}
            </Link>
            <StatusBadge status={invoice.status} size="sm" />
          </div>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {invoice.supplierName}
            {invoice.poNumber ? ` · PO ${invoice.poNumber}` : ''} · Created{' '}
            {formatDate(invoice.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[16px] font-semibold tabular-nums text-ink">
            {formatCurrency(Number(invoice.totalAmount), invoice.currency)}
          </span>
          {children}
          <button
            type="button"
            aria-expanded={open}
            aria-label="Toggle lifecycle"
            onClick={() => setOpen((o) => !o)}
            className="rounded p-1 text-ink-subtle transition-colors hover:bg-canvas hover:text-ink"
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
            />
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <LifecycleStepper invoice={invoice} size="sm" />
        </div>
      )}
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

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-[13px] text-ink-muted">{text}</p>;
}
