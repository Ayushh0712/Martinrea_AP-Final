'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Flag,
  GitBranch,
  Hash,
  ListChecks,
  MoreHorizontal,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/invoices/StatusBadge';
import { LifecycleStepper } from '@/components/invoices/LifecycleStepper';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAllowedTransitions, useInvoice } from '@/hooks/useInvoices';
import {
  useApprove,
  useFlagException,
  useReject,
  useSubmitApproval,
  useSubmitMatch,
  useSubmitReview,
} from '@/hooks/useInvoiceMutations';
import { useAuth } from '@/auth/useAuth';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  initials,
  relativeFromNow,
} from '@/lib/utils';
import { PLANTS } from '@/lib/constants';
import {
  canApproveAmount,
  formatApprovalCap,
  profileFor,
} from '@/lib/permissions';
import { RolePill } from '@/components/auth/RolePill';
import { canAccessPath } from '@/components/layout/nav-items';
import { roleLabel } from '@/types/invoice';
import type { Invoice } from '@/types/invoice';

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { user } = useAuth();
  const invoiceQ = useInvoice(id);
  const transitionsQ = useAllowedTransitions(id);

  const submitReview = useSubmitReview();
  const submitMatch = useSubmitMatch();
  const submitApproval = useSubmitApproval();
  const approve = useApprove();
  const reject = useReject();
  const flagException = useFlagException();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Approve-only roles can't open the Invoice Processing list, so route
  // their back links to the approval queue instead.
  const canViewInvoiceList = canAccessPath('/invoices', user?.role);
  const backHref = canViewInvoiceList ? '/invoices' : '/approvals';
  const backLabel = canViewInvoiceList ? 'All invoices' : 'Approval workflow';

  if (!id) {
    return (
      <div className="p-8 text-center text-ink-muted">No invoice id provided.</div>
    );
  }

  if (invoiceQ.isLoading) {
    return <InvoiceDetailSkeleton />;
  }

  if (invoiceQ.isError || !invoiceQ.data) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <XCircle className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-lg font-semibold text-ink">
          Couldn't load this invoice
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          The backend returned an error, or the invoice no longer exists.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4" />
            {canViewInvoiceList ? 'Back to processing' : 'Back to approvals'}
          </Link>
        </Button>
      </div>
    );
  }

  const invoice = invoiceQ.data;
  const allowed = transitionsQ.data?.allowedTransitions ?? [];
  const plant = PLANTS.find((p) => p.id === invoice.plantId);

  // ─── Action availability based on status, role, and current approver ────
  const profile = profileFor(user?.role);
  const isCurrentApprover =
    !!user && !!invoice.currentApproverId && invoice.currentApproverId === user.id;
  const isApprover = profile?.canApprove ?? false;
  // PRD WF-01 + WF-03 (mirrors ApprovalsPage): a Plant_Manager's cap only
  // applies when they are the FINAL approver. As an intermediate step in a
  // multi-tier chain their plant-level sign-off is always allowed, so we must
  // NOT hide Approve for a legitimate intermediate approver on a large invoice.
  const chain = invoice.approvalChain ?? [];
  const isFinalApprover =
    chain.length === 0 || invoice.currentApproverId === chain[chain.length - 1];
  const amountWithinCap =
    !isFinalApprover || canApproveAmount(user?.role, Number(invoice.totalAmount));

  // Phase 1: AP_Clerk drives review + exception flagging; only approvers see
  // approval actions, and only when they are the routed current approver AND
  // the amount falls within their personal cap (PM $50k, FD/VP unlimited).
  const showSubmitReview =
    invoice.status === 'PENDING_REVIEW' &&
    (profile?.canEdit ?? false);
  const showSubmitMatch =
    invoice.status === 'PENDING_MATCH' &&
    (profile?.canEdit ?? false);
  // Step 2 of the match flow: a MATCHED invoice can be submitted for approval.
  const showSubmitApproval =
    invoice.status === 'MATCHED' &&
    (profile?.canEdit ?? false);
  const showFlagException =
    invoice.status === 'PENDING_MATCH' &&
    (profile?.canEdit ?? false);
  const showApprove =
    invoice.status === 'PENDING_APPROVAL' &&
    isApprover &&
    isCurrentApprover &&
    amountWithinCap;
  const showReject =
    invoice.status === 'PENDING_APPROVAL' &&
    isApprover &&
    isCurrentApprover;

  // Educational hint: Plant Manager looking at an invoice above their cap.
  const overCapForViewer =
    invoice.status === 'PENDING_APPROVAL' &&
    isApprover &&
    !amountWithinCap;

  const isBusy =
    submitReview.isPending ||
    submitMatch.isPending ||
    submitApproval.isPending ||
    approve.isPending ||
    reject.isPending ||
    flagException.isPending;

  async function handleReject() {
    if (!rejectReason.trim() || !id) return;
    await reject
      .mutateAsync({ id, reason: rejectReason.trim() })
      .catch(() => null);
    setRejectOpen(false);
    setRejectReason('');
  }

  return (
    <div className="space-y-5">
      {/* Back link + breadcrumb-ish + role pill */}
      <div className="flex items-center gap-2 text-[13px] text-ink-muted">
        <Link
          href={backHref}
          className="flex items-center gap-1 font-medium hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-ink-subtle" />
        <span className="text-ink">{invoice.invoiceNumber}</span>
        {user && (
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-subtle">
            Viewing as
            <RolePill role={user.role} size="sm" showCap />
          </span>
        )}
      </div>

      {/* Header card */}
      <Card>
        <CardContent className="px-6 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="truncate text-[22px] font-semibold tracking-tight text-ink">
                  {invoice.invoiceNumber}
                </h1>
                <StatusBadge status={invoice.status} />
              </div>
              <p className="mt-1 text-[14px] text-ink-muted">
                {invoice.supplierName}
                {invoice.supplierId && (
                  <span className="text-ink-subtle"> · {invoice.supplierId}</span>
                )}
                {invoice.poNumber && (
                  <>
                    {' · '}
                    <span className="font-medium text-ink">
                      PO {invoice.poNumber}
                    </span>
                  </>
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  {plant?.name ?? invoice.plantId ?? '—'}
                </span>
                <span className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Channel · {invoice.ingestionChannel ?? 'MANUAL'}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Created {formatDate(invoice.createdAt)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Updated {relativeFromNow(invoice.updatedAt)}
                </span>
              </div>
            </div>

            <div className="text-right">
              <p className="text-[11.5px] font-medium uppercase tracking-wider text-ink-muted">
                Total amount
              </p>
              <p className="mt-0.5 text-[28px] font-semibold tracking-tight text-ink tabular-nums">
                {formatCurrency(Number(invoice.totalAmount), invoice.currency)}
              </p>
              <p className="text-[11.5px] text-ink-muted">
                {invoice.currency}
              </p>
            </div>
          </div>

          {/* Approval-cap notice (Plant Manager looking at an invoice over $50K) */}
          {overCapForViewer && profile && (
            <div className="mt-4 flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">
                  Above your {formatApprovalCap(profile.approvalCap)} approval cap
                </p>
                <p className="mt-0.5 text-amber-800">
                  This invoice's total of{' '}
                  <span className="font-semibold">
                    {formatCurrency(Number(invoice.totalAmount), invoice.currency)}
                  </span>{' '}
                  exceeds the Plant Manager limit. The Finance Director is the
                  designated approver for this amount tier.
                </p>
              </div>
            </div>
          )}

          {/* Action row */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {showSubmitReview && (
              <Button
                onClick={() => submitReview.mutate(invoice.id)}
                disabled={isBusy}
                className="gap-1.5"
              >
                <Send className="h-4 w-4" />
                Submit for matching
              </Button>
            )}
            {showSubmitMatch && (
              // PRD UI-B: matching must go through the 3-way match workbench
              // (tri-panel + discrepancy detection), not a direct submit here.
              <Button
                onClick={() => router.push(`/match?invoice=${invoice.id}`)}
                disabled={isBusy}
                className="gap-1.5"
              >
                <GitBranch className="h-4 w-4" />
                Open match workbench
              </Button>
            )}
            {showSubmitApproval && (
              <Button
                onClick={() => submitApproval.mutate(invoice.id)}
                disabled={isBusy}
                className="gap-1.5"
              >
                <Send className="h-4 w-4" />
                Submit for approval
              </Button>
            )}
            {showApprove && (
              <Button
                variant="success"
                onClick={() => approve.mutate(invoice.id)}
                disabled={isBusy}
                className="gap-1.5"
              >
                <Check className="h-4 w-4" />
                Approve
              </Button>
            )}
            {showReject && (
              <Button
                variant="destructive"
                onClick={() => setRejectOpen(true)}
                disabled={isBusy}
                className="gap-1.5"
              >
                <X className="h-4 w-4" />
                Reject
              </Button>
            )}
            {showFlagException && (
              <Button
                variant="secondary"
                onClick={() => flagException.mutate(invoice.id)}
                disabled={isBusy}
                className="gap-1.5"
              >
                <Flag className="h-4 w-4" />
                Flag as exception
              </Button>
            )}
            {!showSubmitReview &&
              !showSubmitMatch &&
              !showSubmitApproval &&
              !showApprove &&
              !showReject &&
              !showFlagException && (
                <div className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {overCapForViewer
                    ? `This invoice exceeds your ${formatApprovalCap(profile?.approvalCap ?? 0)} cap — awaiting Finance Director.`
                    : invoice.status === 'PENDING_APPROVAL' && isApprover && !isCurrentApprover
                    ? 'Awaiting a different approver in the chain.'
                    : 'No actions available for your role at this stage.'}
                </div>
              )}

            <div className="ml-auto flex items-center gap-2 text-[12px] text-ink-muted">
              <span className="font-medium">Next allowed:</span>
              {allowed.length === 0 ? (
                <span className="rounded-md border border-line bg-canvas px-2 py-0.5 text-[11.5px]">
                  Terminal
                </span>
              ) : (
                allowed.map((t) => <StatusBadge key={t} status={t} size="sm" />)
              )}
              <Button variant="ghost" size="icon-sm" disabled>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {invoice.rejectionReason && (
            <div className="mt-4 flex items-start gap-2.5 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-3 text-[13px] text-rose-800">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Rejection reason</p>
                <p className="mt-0.5 text-rose-700">{invoice.rejectionReason}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lifecycle roadmap (shared stepper, same as the operation pages) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-brand" />
            Lifecycle
          </CardTitle>
          <p className="mt-1 text-sm text-ink-muted">
            Status progression through the workflow state machine.
          </p>
        </CardHeader>
        <CardContent>
          <LifecycleStepper invoice={invoice} />
        </CardContent>
      </Card>

      {/* Approval chain */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand" />
            Approval chain
          </CardTitle>
          <p className="mt-1 text-sm text-ink-muted">
            Routing computed by the rules engine.
          </p>
        </CardHeader>
        <CardContent>
          <ApprovalChain invoice={invoice} />
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-brand" />
            Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Invoice ID" value={invoice.id} mono />
            <Field label="Supplier ID" value={invoice.supplierId ?? '—'} />
            <Field label="Plant" value={plant?.name ?? invoice.plantId ?? '—'} />
            <Field
              label="Pending approval since"
              value={
                invoice.pendingApprovalSince
                  ? formatDateTime(invoice.pendingApprovalSince)
                  : '—'
              }
            />
            <Field
              label="Last escalated"
              value={
                invoice.lastEscalatedAt
                  ? formatDateTime(invoice.lastEscalatedAt)
                  : '—'
              }
            />
            <Field label="Created" value={formatDateTime(invoice.createdAt)} />
            <Field label="Updated" value={formatDateTime(invoice.updatedAt)} />
            <Field label="Ingestion channel" value={invoice.ingestionChannel ?? '—'} />
          </dl>
        </CardContent>
      </Card>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject invoice</DialogTitle>
            <DialogDescription>
              The invoice returns to PENDING_REVIEW. Your reason is recorded in
              the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. PO does not match supplier statement"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || reject.isPending}
            >
              {reject.isPending ? 'Rejecting…' : 'Confirm rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Approval chain visualisation
// ──────────────────────────────────────────────────────────────────────────
function ApprovalChain({ invoice }: { invoice: Invoice }) {
  const chain = invoice.approvalChain ?? [];
  const details = invoice.approvalChainDetails ?? [];
  const completed = invoice.approvalsCompleted ?? [];

  if (chain.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <ShieldCheck className="h-8 w-8 text-ink-subtle" />
        <p className="text-[13px] font-medium text-ink">No chain yet</p>
        <p className="text-[12px] text-ink-muted">
          The routing engine builds the chain on submit-match.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-2.5">
      {chain.map((approverId, idx) => {
        const done = completed.find((c) => c.approverId === approverId);
        const isCurrent =
          !done && invoice.currentApproverId === approverId;
        const detail = details.find((d) => d.userId === approverId);
        // Truncated UUID is the last-resort fallback when the id no longer
        // matches a live user (e.g. re-seeded users frozen into an old chain).
        const displayName =
          detail?.name ?? `${approverId.slice(0, 8)}…${approverId.slice(-4)}`;
        const roleText = roleLabel(detail?.role);
        return (
          <li
            key={`${approverId}-${idx}`}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
              isCurrent
                ? 'border-brand-200 bg-brand-50/50'
                : done?.decision === 'APPROVED'
                ? 'border-emerald-200 bg-emerald-50/40'
                : done?.decision === 'REJECTED'
                ? 'border-rose-200 bg-rose-50/40'
                : 'border-line bg-white'
            }`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                done?.decision === 'APPROVED'
                  ? 'bg-emerald-500 text-white'
                  : done?.decision === 'REJECTED'
                  ? 'bg-rose-500 text-white'
                  : isCurrent
                  ? 'bg-brand text-white'
                  : 'bg-slate-100 text-ink-muted'
              }`}
            >
              {done?.decision === 'APPROVED' ? (
                <Check className="h-3.5 w-3.5" />
              ) : done?.decision === 'REJECTED' ? (
                <X className="h-3.5 w-3.5" />
              ) : (
                initials(detail?.name ?? `Step ${idx + 1}`)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11.5px] font-medium text-ink-muted">
                  Step {idx + 1}
                  {roleText ? ` · ${roleText}` : ''}
                </p>
                {isCurrent && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
                    Current
                  </span>
                )}
              </div>
              <p className="truncate text-[13px] font-semibold text-ink">
                {displayName}
                {done && (
                  <span
                    className={`ml-1.5 text-[12px] font-medium ${
                      done.decision === 'APPROVED'
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    }`}
                  >
                    · {done.decision.toLowerCase()}
                  </span>
                )}
              </p>
              {done?.timestamp && (
                <p className="text-[11.5px] text-ink-muted">
                  {formatDateTime(done.timestamp)}
                </p>
              )}
              {done?.notes && (
                <p className="mt-1 text-[12px] italic text-ink-muted">
                  "{done.notes}"
                </p>
              )}
            </div>
          </li>
        );
      })}

      {invoice.status === 'APPROVED' && (
        <li className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Chain complete — invoice approved
        </li>
      )}
    </ol>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        {label}
      </dt>
      <dd
        className={`text-[13px] text-ink ${
          mono ? 'font-mono text-[12px] break-all' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function InvoiceDetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-4 w-40" />
      <Card>
        <CardContent className="px-6 py-5">
          <div className="flex justify-between">
            <div className="space-y-2">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-4 w-80" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-12 w-32" />
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
