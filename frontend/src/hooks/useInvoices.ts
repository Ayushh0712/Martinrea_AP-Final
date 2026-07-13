import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { invoicesApi, type InvoiceSearchParams } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { invoiceRegistry } from '@/lib/invoice-registry';
import type { Invoice } from '@/types/invoice';

/** True if the error is an Axios 404/410 (i.e. invoice no longer exists). */
function isGoneError(err: unknown): boolean {
  if (!(err instanceof AxiosError)) return false;
  const status = err.response?.status;
  return status === 404 || status === 410;
}

/**
 * Stable references passed to `useSyncExternalStore`.
 *
 * - `subscribe` and `getSnapshot` must have stable identity across renders
 *   (subscribe identity churn forces re-subscriptions; snapshot churn causes
 *   the dreaded "Maximum update depth exceeded" loop).
 * - `EMPTY_IDS` is the SSR/initial snapshot — must be the same reference
 *   each call, otherwise the same loop occurs during hydration.
 */
const EMPTY_IDS: readonly string[] = Object.freeze([]);
const subscribeIds = invoiceRegistry.subscribe;
const getSnapshotIds = invoiceRegistry.list;
const getServerSnapshotIds = (): readonly string[] => EMPTY_IDS;

/** Reactively read the known invoice IDs from the registry. */
export function useKnownInvoiceIds(): readonly string[] {
  return useSyncExternalStore(
    subscribeIds,
    getSnapshotIds,
    getServerSnapshotIds,
  );
}

export function useInvoice(id: string | undefined | null) {
  const query = useQuery({
    queryKey: id ? queryKeys.invoice(id) : ['invoice', 'noop'],
    queryFn: () => invoicesApi.get(id!),
    enabled: !!id,
  });

  // Self-register any invoice we successfully fetched (covers deep-links).
  useEffect(() => {
    if (id && query.data) invoiceRegistry.add(id);
  }, [id, query.data]);

  // Self-prune any stale ID — if the backend says 404/410, drop it from the
  // client registry so list pages stop trying to refetch it.
  useEffect(() => {
    if (id && isGoneError(query.error)) invoiceRegistry.remove(id);
  }, [id, query.error]);

  return query;
}

export function useAllowedTransitions(id: string | undefined | null) {
  return useQuery({
    queryKey: id ? queryKeys.invoiceTransitions(id) : ['transitions', 'noop'],
    queryFn: () => invoicesApi.allowedTransitions(id!),
    enabled: !!id,
  });
}

/**
 * Fetch every invoice from the backend list endpoint (`GET /invoices`).
 *
 * On success we also warm the per-id React Query cache and the client registry
 * so opening an invoice detail page (or deep-linking) is instant and doesn't
 * trigger a redundant `GET /invoices/:id`.
 */
/**
 * Server-side invoice search (PRD DAT-05 / UI-A-02). Filtering, sorting and
 * pagination all happen in the database via `GET /api/invoices/search`, so the
 * Command Center never bulk-fetches the whole table. Auto-refreshes every 60s
 * and keeps the previous page visible while the next one loads.
 */
export function useInvoicesSearch(params: InvoiceSearchParams) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['invoices', 'search', params],
    queryFn: () => invoicesApi.search(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Warm per-id caches + registry from the current page.
  useEffect(() => {
    const rows = query.data?.data;
    if (!rows || rows.length === 0) return;
    invoiceRegistry.addMany(rows.map((i) => i.id));
    for (const inv of rows) {
      qc.setQueryData(queryKeys.invoice(inv.id), inv);
    }
  }, [query.data, qc]);

  return {
    invoices: query.data?.data ?? [],
    pagination: query.data?.pagination,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function useInvoicesList() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['invoices', 'list'],
    queryFn: () => invoicesApi.list(),
    staleTime: 30_000,
    // PRD UI-A-02: dashboard auto-refreshes every 60s without a full reload.
    refetchInterval: 60_000,
  });

  // Warm individual caches + registry from the freshly-fetched collection.
  useEffect(() => {
    if (!query.data || query.data.length === 0) return;
    invoiceRegistry.addMany(query.data.map((i) => i.id));
    for (const inv of query.data) {
      qc.setQueryData(queryKeys.invoice(inv.id), inv);
    }
  }, [query.data, qc]);

  const invoices = useMemo<Invoice[]>(() => {
    const list = query.data ? [...query.data] : [];
    list.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return list;
  }, [query.data]);

  const errors = useMemo<Error[]>(
    () => (query.error instanceof Error ? [query.error] : []),
    [query.error],
  );

  return {
    invoices,
    ids: invoices.map((i) => i.id),
    isEmpty: !query.isLoading && !query.isError && invoices.length === 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    errors,
  };
}
