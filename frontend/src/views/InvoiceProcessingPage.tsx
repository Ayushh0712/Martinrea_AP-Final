'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Ban,
  ChevronDown,
  GitMerge,
  Loader2,
  RotateCcw,
  RotateCw,
  Search as SearchIcon,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/invoices/StatusBadge';
import {
  approvalSummary,
  LifecycleStepper,
} from '@/components/invoices/LifecycleStepper';
import { EmptyInvoicesState } from '@/components/invoices/EmptyInvoicesState';
import { useAuth } from '@/auth/useAuth';
import { canAccessPath } from '@/components/layout/nav-items';
import { useInvoicesSearch } from '@/hooks/useInvoices';
import {
  useRejectException,
  useRetrieveFromException,
} from '@/hooks/useInvoiceMutations';
import type { InvoiceSearchParams } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { INGESTION_CHANNELS, PIPELINE_ORDER, STATUS_META } from '@/lib/constants';
import type { Invoice, InvoiceStatus } from '@/types/invoice';

type StatusFilter = 'all' | 'open' | 'closed' | InvoiceStatus;

/**
 * Read a status filter from the URL, treating the hidden REJECTED status as
 * "all" (rejected invoices are kept in the database only, never in the UI).
 */
function statusFromUrl(raw: string | null | undefined): StatusFilter {
  if (!raw || raw === 'REJECTED') return 'all';
  return raw as StatusFilter;
}
type SortKey = 'invoiceNumber' | 'createdAt' | 'totalAmount';
const PAGE_SIZES = [25, 50, 100] as const;

/**
 * Fixed params for the standalone Exceptions panel. Kept at module scope so the
 * React Query key (`['invoices','search', params]`) is referentially stable and
 * doesn't re-trigger on every render. Intentionally independent of the page's
 * search/filter/pagination state so the panel always shows every exception.
 */
const EXCEPTIONS_PARAMS: InvoiceSearchParams = {
  page: 1,
  limit: 200,
  status: 'EXCEPTION',
  sortBy: 'createdAt',
  sortDir: 'DESC',
};

/** Debounce a changing value (used so the keyword search doesn't churn URL/render). */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Route to the page that fits the invoice's stage. Used by the exception
 * panel's row click and by the lifecycle dropdown's action button. Terminal /
 * early states fall back to the status-aware, read-safe detail page.
 */
function stageRoute(inv: Invoice): string {
  switch (inv.status) {
    case 'PENDING_REVIEW':
      return `/invoices/${inv.id}/review`;
    case 'PENDING_MATCH':
      return `/match?invoice=${inv.id}`;
    case 'MATCHED':
      return '/ready-to-submit';
    case 'PENDING_APPROVAL':
      return '/approvals';
    default:
      return `/invoices/${inv.id}`;
  }
}

/**
 * "Redirect to the pending operation" button for the lifecycle dropdown.
 * PENDING_APPROVAL deliberately has none — the invoice is with the approvers
 * and the stepper itself shows who signed and who is next.
 */
function stageAction(inv: Invoice): { label: string; route: string } | null {
  switch (inv.status) {
    case 'PENDING_REVIEW':
      return { label: 'Go to Review', route: `/invoices/${inv.id}/review` };
    case 'PENDING_MATCH':
      return { label: 'Go to Match', route: `/match?invoice=${inv.id}` };
    case 'MATCHED':
      return { label: 'Go to Submit', route: '/ready-to-submit' };
    case 'PENDING_APPROVAL':
      return null;
    default:
      return { label: 'Open details', route: `/invoices/${inv.id}` };
  }
}

export default function InvoiceProcessingPage() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const qc = useQueryClient();
  const params = useSearchParams();
  const { user } = useAuth();

  // ── Filter state (initialised from URL) ───────────────────────────────────
  const [q, setQ] = useState(params?.get('q') ?? '');
  const [status, setStatus] = useState<StatusFilter>(
    statusFromUrl(params?.get('status')),
  );
  const [supplier, setSupplier] = useState(params?.get('supplier') ?? '');
  const [channel, setChannel] = useState(params?.get('channel') ?? 'all');
  const [dateFrom, setDateFrom] = useState(params?.get('from') ?? '');
  const [dateTo, setDateTo] = useState(params?.get('to') ?? '');

  const [sort, setSort] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const debouncedQ = useDebounced(q, 300);
  const debouncedSupplier = useDebounced(supplier, 300);

  // Ingestion channels for the sidebar filter. With server-side paging we can't
  // derive these from the current page, so use the known channel set.
  const channels = INGESTION_CHANNELS;

  // ── Keep filters in the URL so reloads + shared links preserve them ───────
  useEffect(() => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set('q', debouncedQ);
    if (status !== 'all') p.set('status', status);
    if (debouncedSupplier) p.set('supplier', debouncedSupplier);
    if (channel !== 'all') p.set('channel', channel);
    if (dateFrom) p.set('from', dateFrom);
    if (dateTo) p.set('to', dateTo);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [debouncedQ, status, debouncedSupplier, channel, dateFrom, dateTo, pathname, router]);

  // Re-apply the status filter when the URL changes via client-side navigation
  // (e.g. clicking a notification while already on this page). The status
  // useState initialiser only runs on first mount, so without this a query-only
  // navigation would be ignored and reverted by the URL write-back effect above.
  // The functional compare makes it a no-op when the URL already matches, so it
  // does not fight the write-back effect or clobber dropdown-driven changes.
  useEffect(() => {
    const urlStatus = statusFromUrl(params?.get('status'));
    setStatus((prev) => (prev === urlStatus ? prev : urlStatus));
  }, [params]);

  // Any filter/sort change resets pagination to the first page.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, debouncedSupplier, channel, dateFrom, dateTo, pageSize, sort, sortDir]);

  // ── Server-side search params (PRD DAT-05 / UI-A-02) ──────────────────────
  const searchParams = useMemo<InvoiceSearchParams>(() => {
    const p: InvoiceSearchParams = {
      page,
      limit: pageSize,
      sortBy: sort,
      sortDir: sortDir === 'asc' ? 'ASC' : 'DESC',
    };
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (status === 'open' || status === 'closed') p.statusGroup = status;
    else if (status !== 'all') p.status = status as InvoiceStatus;
    if (debouncedSupplier.trim()) p.supplierName = debouncedSupplier.trim();
    if (channel !== 'all') p.ingestionChannel = channel;
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    return p;
  }, [page, pageSize, sort, sortDir, debouncedQ, status, debouncedSupplier, channel, dateFrom, dateTo]);

  const { invoices, pagination, isLoading, isFetching, error } =
    useInvoicesSearch(searchParams);

  // Standalone exceptions feed (all exceptions, independent of the filters).
  const { invoices: exceptionInvoices } = useInvoicesSearch(EXCEPTIONS_PARAMS);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);

  const retrieve = useRetrieveFromException();
  const rejectException = useRejectException();

  // Which non-exception row currently has its lifecycle dropdown open.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Reject-exception dialog state: which invoice is being rejected + reason.
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function doRejectException() {
    if (!rejectId || !rejectReason.trim()) return;
    await rejectException
      .mutateAsync({ id: rejectId, reason: rejectReason.trim() })
      .catch(() => null);
    setRejectId(null);
    setRejectReason('');
  }

  // REJECTED invoices stay in the database as a record but are never surfaced
  // in the UI (no table rows, no filter option).
  const visibleInvoices = invoices.filter((i) => i.status !== 'REJECTED');

  // When the user explicitly filters to Exception, show them in the main table
  // and hide the standalone panel; otherwise pull exceptions out into the panel.
  const showExceptionsPanel = status !== 'EXCEPTION';
  const pageRows = showExceptionsPanel
    ? visibleInvoices.filter((i) => i.status !== 'EXCEPTION')
    : visibleInvoices;
  const total = pagination?.total ?? 0;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const safePage = Math.min(page, totalPages);

  const hasActiveFilters =
    !!q || status !== 'all' || !!supplier || channel !== 'all' || !!dateFrom || !!dateTo;
  // Count only the popover-driven filters (search is separate, lives in its own input).
  const activeFilterCount =
    (status !== 'all' ? 1 : 0) +
    (supplier ? 1 : 0) +
    (channel !== 'all' ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);
  const isEmpty = !isLoading && !hasActiveFilters && total === 0;
  const errors = error ? [error] : [];

  function toggleSort(key: SortKey) {
    if (sort === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setSortDir('desc');
    }
  }

  function clearFilters() {
    setQ('');
    setStatus('all');
    setSupplier('');
    setChannel('all');
    setDateFrom('');
    setDateTo('');
  }

  /** Shared row renderer so the main table and the exceptions panel behave identically. */
  const renderRow = (inv: Invoice) => {
    // Exception rows keep the original behaviour: no lifecycle dropdown,
    // Retrieve/Reject actions, click-through to the stage route when allowed.
    if (inv.status === 'EXCEPTION') {
      const route = stageRoute(inv);
      const clickable = canAccessPath(route.split('?')[0], user?.role);
      return (
        <Row
          key={inv.id}
          invoice={inv}
          retrievePending={retrieve.isPending}
          rejectPending={rejectException.isPending}
          onClick={clickable ? () => router.push(route) : undefined}
          onMatch={() => router.push(`/match?invoice=${inv.id}`)}
          onRetrieve={() =>
            retrieve.mutate(inv.id, {
              onSuccess: () => router.push(`/invoices/${inv.id}/review`),
            })
          }
          onReject={() => setRejectId(inv.id)}
        />
      );
    }

    // Non-exception rows: clicking toggles the lifecycle dropdown; navigation
    // moved to the "Go to <operation>" button inside it (role-gated).
    const expanded = expandedId === inv.id;
    const action = stageAction(inv);
    const actionAllowed =
      !!action && canAccessPath(action.route.split('?')[0], user?.role);

    return (
      <Fragment key={inv.id}>
        <Row
          invoice={inv}
          expandable
          expanded={expanded}
          retrievePending={retrieve.isPending}
          rejectPending={rejectException.isPending}
          onClick={() => setExpandedId(expanded ? null : inv.id)}
          onMatch={() => router.push(`/match?invoice=${inv.id}`)}
          onRetrieve={() => undefined}
          onReject={() => undefined}
        />
        {expanded && (
          <tr className="border-b border-line bg-canvas/50">
            <td colSpan={8} className="px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <LifecycleStepper invoice={inv} size="sm" className="flex-1" />
                <div className="flex shrink-0 items-center lg:pl-4">
                  {inv.status === 'PENDING_APPROVAL' ? (
                    <p className="max-w-[260px] text-right text-[12px] font-medium text-brand">
                      {approvalSummary(inv) ?? 'With the approval chain'}
                    </p>
                  ) : (
                    action &&
                    actionAllowed && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(action.route);
                        }}
                      >
                        {action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    )
                  )}
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">
            Command Center
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every incoming invoice and its live status. Auto-refreshes each minute.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ['invoices'] })}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {isEmpty ? (
        <EmptyInvoicesState />
      ) : (
        <div className="space-y-3">
          {/* Search + Filter trigger */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by invoice #, PO, or supplier…"
                className="pl-9 pr-9"
              />
              {q && (
                <button
                  onClick={() => setQ('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="sm" className="shrink-0">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                    Filters
                  </p>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="text-[11px] font-medium text-brand hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-[11.5px]">Status</Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as StatusFilter)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="open">Open (in pipeline)</SelectItem>
                      <SelectItem value="closed">Closed (terminal)</SelectItem>
                      {PIPELINE_ORDER.concat(['EXCEPTION']).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_META[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-[11.5px]">Supplier</Label>
                  <Input
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Name or ID"
                    className="h-9"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-[11.5px]">Ingestion channel</Label>
                  <Select value={channel} onValueChange={setChannel}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All channels</SelectItem>
                      {channels.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label className="text-[11.5px]">Date from</Label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-[11.5px]">Date to</Label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {errors.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12.5px] text-amber-800">
              Couldn&apos;t load {errors.length} invoice
              {errors.length === 1 ? '' : 's'}. They&apos;ve been left out of the list.
            </div>
          )}

          <Card className="overflow-hidden">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-canvas text-left text-[11.5px] font-semibold uppercase tracking-wider text-ink-muted">
                      <Th sortable sorted={sort === 'invoiceNumber'} dir={sortDir} onClick={() => toggleSort('invoiceNumber')}>
                        Invoice #
                      </Th>
                      <Th sortable sorted={sort === 'createdAt'} dir={sortDir} onClick={() => toggleSort('createdAt')}>
                        Invoice Date
                      </Th>
                      <Th>Supplier</Th>
                      <Th>PO #</Th>
                      <Th>Status</Th>
                      <Th>Ingestion Source</Th>
                      <Th sortable sorted={sort === 'totalAmount'} dir={sortDir} onClick={() => toggleSort('totalAmount')} align="right">
                        Amount
                      </Th>
                      <Th align="right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading
                      ? Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="border-b border-line">
                            {Array.from({ length: 8 }).map((_, j) => (
                              <td key={j} className="px-4 py-3.5">
                                <Skeleton className="h-3 w-full" />
                              </td>
                            ))}
                          </tr>
                        ))
                      : pageRows.map((inv) => renderRow(inv))}
                  </tbody>
                </table>

                {!isLoading && total === 0 && (
                  <div className="px-6 py-14 text-center">
                    <p className="text-sm font-medium text-ink">
                      No invoices match these filters
                    </p>
                    <Button variant="secondary" size="sm" className="mt-4" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex flex-col gap-2 text-[12px] text-ink-muted sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>
                {total === 0
                  ? '0'
                  : `${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, total)}`}{' '}
                of {total}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="tabular-nums">
                Page {safePage} / {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>

          {showExceptionsPanel && exceptionInvoices.length > 0 && (
            <Card className="overflow-hidden border-rose-200">
              <button
                type="button"
                aria-expanded={exceptionsOpen}
                onClick={() => setExceptionsOpen((o) => !o)}
                className="flex w-full items-center gap-3 bg-rose-50/60 px-4 py-3 text-left transition-colors hover:bg-rose-50"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span className="text-[13px] font-semibold text-ink">Exceptions</span>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-1.5 text-[11px] font-semibold leading-none text-rose-700">
                  {exceptionInvoices.length}
                </span>
                <span className="text-[12px] text-ink-muted">Need review</span>
                <ChevronDown
                  className={cn(
                    'ml-auto h-4 w-4 shrink-0 text-ink-muted transition-transform',
                    exceptionsOpen && 'rotate-180',
                  )}
                />
              </button>

              {exceptionsOpen && (
                <CardContent className="border-t border-line px-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[960px] border-collapse">
                      <thead>
                        <tr className="border-b border-line bg-canvas text-left text-[11.5px] font-semibold uppercase tracking-wider text-ink-muted">
                          <Th>Invoice #</Th>
                          <Th>Invoice Date</Th>
                          <Th>Supplier</Th>
                          <Th>PO #</Th>
                          <Th>Status</Th>
                          <Th>Ingestion Source</Th>
                          <Th align="right">Amount</Th>
                          <Th align="right">Actions</Th>
                        </tr>
                      </thead>
                      <tbody>{exceptionInvoices.map((inv) => renderRow(inv))}</tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          )}
        </div>
      )}

      <Dialog
        open={!!rejectId}
        onOpenChange={(o) => {
          if (!o) {
            setRejectId(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject invoice</DialogTitle>
            <DialogDescription>
              The invoice leaves the exception queue and is marked REJECTED. It
              stays in the database and the reason is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Duplicate submission — original already processed"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectException.isPending}
              onClick={doRejectException}
            >
              {rejectException.isPending ? 'Rejecting…' : 'Reject invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Th({
  children,
  sortable,
  sorted,
  dir,
  onClick,
  align = 'left',
}: {
  children: React.ReactNode;
  sortable?: boolean;
  sorted?: boolean;
  dir?: 'asc' | 'desc';
  onClick?: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {sortable ? (
        <button
          onClick={onClick}
          className={`inline-flex items-center gap-1 transition-colors hover:text-ink ${sorted ? 'text-ink' : ''}`}
        >
          {children}
          <ArrowUpDown
            className={`h-3 w-3 ${sorted ? 'opacity-100' : 'opacity-40'} ${sorted && dir === 'asc' ? 'rotate-180' : ''}`}
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Row({
  invoice,
  onClick,
  onMatch,
  onRetrieve,
  onReject,
  retrievePending,
  rejectPending,
  expandable,
  expanded,
}: {
  invoice: Invoice;
  /** Toggles the lifecycle dropdown (or navigates, for exception rows). */
  onClick?: () => void;
  onMatch: () => void;
  onRetrieve: () => void;
  onReject: () => void;
  retrievePending: boolean;
  rejectPending: boolean;
  /** Row opens a lifecycle dropdown on click (non-exception rows). */
  expandable?: boolean;
  expanded?: boolean;
}) {
  return (
    <tr
      onClick={onClick}
      aria-expanded={expandable ? expanded : undefined}
      className={cn(
        'border-b border-line text-[13px] transition-colors',
        onClick && 'cursor-pointer hover:bg-canvas',
        expanded && 'bg-canvas/60',
      )}
    >
      <td className="px-4 py-3.5 font-semibold text-ink">
        <div className="flex items-center gap-1.5">
          {expandable && (
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform',
                expanded && 'rotate-180',
              )}
            />
          )}
          {invoice.invoiceNumber}
        </div>
      </td>
      <td className="px-4 py-3.5 text-ink-muted">{formatDate(invoice.createdAt)}</td>
      <td className="px-4 py-3.5">
        <div className="flex flex-col">
          <span className="font-medium text-ink">{invoice.supplierName}</span>
          {invoice.supplierId && (
            <span className="text-[11px] text-ink-subtle">{invoice.supplierId}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3.5 text-ink-muted">{invoice.poNumber ?? '—'}</td>
      <td className="px-4 py-3.5">
        <StatusBadge status={invoice.status} size="sm" />
      </td>
      <td className="px-4 py-3.5 text-ink-muted">{invoice.ingestionChannel ?? 'MANUAL'}</td>
      <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-ink">
        {formatCurrency(Number(invoice.totalAmount), invoice.currency)}
      </td>
      <td className="px-4 py-3.5 text-right">
        {/* PRD UI-B-01: 'Match' action, enabled only for Pending_Match. */}
        {invoice.status === 'PENDING_MATCH' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onMatch();
            }}
          >
            <GitMerge className="h-3.5 w-3.5" />
            Match
          </Button>
        )}
        {/* Exception actions: Retrieve (back to review) or Reject (terminal). */}
        {invoice.status === 'EXCEPTION' && (
          <div className="inline-flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={retrievePending || rejectPending}
              onClick={(e) => {
                e.stopPropagation();
                onRetrieve();
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retrieve
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={retrievePending || rejectPending}
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
            >
              <Ban className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
