'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ShieldCheck, Stamp, X } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/invoices/StatusBadge';
import {
  approvalSummary,
  LifecycleStepper,
} from '@/components/invoices/LifecycleStepper';
import { invoicesApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useApprove, useReject } from '@/hooks/useInvoiceMutations';
import { useAuth } from '@/auth/useAuth';
import { canApproveAmount, profileFor } from '@/lib/permissions';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { Invoice } from '@/types/invoice';

export default function ApprovalsPage() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: queryKeys.invoicesByStatus('PENDING_APPROVAL'),
    queryFn: () => invoicesApi.list('PENDING_APPROVAL'),
    staleTime: 15_000,
  });
  const approve = useApprove();
  const reject = useReject();

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const invoices = q.data ?? [];
  const profile = profileFor(user?.role);
  const isApprover = profile?.canApprove ?? false;

  const { mine, others } = useMemo(() => {
    const mine: Invoice[] = [];
    const others: Invoice[] = [];
    for (const inv of invoices) {
      if (user && inv.currentApproverId === user.id) mine.push(inv);
      else others.push(inv);
    }
    return { mine, others };
  }, [invoices, user]);

  async function doReject() {
    if (!rejectId || !reason.trim()) return;
    await reject.mutateAsync({ id: rejectId, reason: reason.trim() }).catch(() => null);
    setRejectId(null);
    setReason('');
  }

  const busy = approve.isPending || reject.isPending;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">
          Approvals
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Invoices awaiting authorization. Approvals are sequential and enforce
          segregation of duties.
        </p>
      </div>

      {!isApprover && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          You are signed in as a role without approval rights. This view is
          read-only for you.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stamp className="h-4 w-4 text-brand" />
            Awaiting your approval
            <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand">
              {mine.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <ListSkeleton />
          ) : mine.length === 0 ? (
            <Empty text="Nothing is waiting on you right now." />
          ) : (
            <div className="space-y-2">
              {mine.map((inv) => {
                // PRD WF-01 + WF-03: a Plant_Manager's $50k cap only applies
                // when they are the FINAL approver. As an intermediate step in
                // a Tier-3 (PM -> FD -> VP) chain their plant-level sign-off is
                // always allowed; FD/VP carry the higher dollar authority.
                const chain = inv.approvalChain ?? [];
                const isFinalApprover =
                  chain.length === 0 ||
                  inv.currentApproverId === chain[chain.length - 1];
                const withinCap =
                  !isFinalApprover ||
                  canApproveAmount(user?.role, Number(inv.totalAmount));
                return (
                  <Row key={inv.id} invoice={inv}>
                    {isApprover && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="success"
                          disabled={busy || !withinCap}
                          title={withinCap ? undefined : 'Above your approval cap'}
                          onClick={() => approve.mutate(inv.id)}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => setRejectId(inv.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </Row>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-ink-subtle" />
            Pending with other approvers
            <span className="ml-1 rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
              {others.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <ListSkeleton />
          ) : others.length === 0 ? (
            <Empty text="No other invoices in the approval chain." />
          ) : (
            <div className="space-y-2">
              {others.map((inv) => (
                <Row key={inv.id} invoice={inv} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectId} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject invoice</DialogTitle>
            <DialogDescription>
              It returns to PENDING_REVIEW for rework. The reason is recorded in
              the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Amount exceeds approved PO total"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || reject.isPending}
              onClick={doReject}
            >
              {reject.isPending ? 'Rejecting…' : 'Confirm rejection'}
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
  const summary = approvalSummary(invoice);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // Only toggle when the row itself is focused, not when keys bubble
          // up from the inner link or Approve/Reject buttons.
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="flex cursor-pointer flex-col gap-3 px-4 py-3 transition-colors hover:bg-canvas sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/invoices/${invoice.id}`}
              onClick={(e) => e.stopPropagation()}
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
          {summary && (
            <p className="mt-0.5 text-[12px] font-medium text-brand">{summary}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[16px] font-semibold tabular-nums text-ink">
            {formatCurrency(Number(invoice.totalAmount), invoice.currency)}
          </span>
          {children && (
            <div onClick={(e) => e.stopPropagation()}>{children}</div>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-ink-subtle transition-transform',
              open && 'rotate-180',
            )}
          />
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
  return (
    <p className="py-10 text-center text-[13px] text-ink-muted">{text}</p>
  );
}
