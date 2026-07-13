import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { extractApiError, invoicesApi } from '@/lib/api';
import { invoiceRegistry } from '@/lib/invoice-registry';
import { queryKeys } from '@/lib/query-client';
import type { CreateInvoicePayload, Invoice } from '@/types/invoice';

function refreshInvoice(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: queryKeys.invoice(id) });
  qc.invalidateQueries({ queryKey: queryKeys.invoiceTransitions(id) });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateInvoicePayload) => invoicesApi.create(payload),
    onSuccess: (invoice: Invoice) => {
      invoiceRegistry.add(invoice.id);
      qc.setQueryData(queryKeys.invoice(invoice.id), invoice);
      toast.success(`Invoice ${invoice.invoiceNumber} created`);
    },
    onError: (err) => {
      toast.error(extractApiError(err, 'Failed to create invoice'));
    },
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoicesApi.submitReview(id),
    onSuccess: (invoice) => {
      qc.setQueryData(queryKeys.invoice(invoice.id), invoice);
      refreshInvoice(qc, invoice.id);
      toast.success('Submitted for matching');
    },
    onError: (err) => toast.error(extractApiError(err, 'Submit failed')),
  });
}

export function useRetrieveFromException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoicesApi.retrieveFromException(id),
    onSuccess: (invoice) => {
      qc.setQueryData(queryKeys.invoice(invoice.id), invoice);
      refreshInvoice(qc, invoice.id);
      // The invoice leaves EXCEPTION and re-enters the review queue.
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('EXCEPTION') });
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_REVIEW') });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Retrieved for review');
    },
    onError: (err) => toast.error(extractApiError(err, 'Retrieve failed')),
  });
}

export function useRejectException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      invoicesApi.rejectException(id, reason),
    onSuccess: (invoice) => {
      qc.setQueryData(queryKeys.invoice(invoice.id), invoice);
      refreshInvoice(qc, invoice.id);
      // The invoice leaves the exception queue and rests in REJECTED (kept in
      // the database + audit log only; the UI never lists rejected invoices).
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('EXCEPTION') });
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('REJECTED') });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice rejected');
    },
    onError: (err) => toast.error(extractApiError(err, 'Reject failed')),
  });
}

export function useSubmitMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoicesApi.submitMatch(id),
    onSuccess: (invoice) => {
      qc.setQueryData(queryKeys.invoice(invoice.id), invoice);
      refreshInvoice(qc, invoice.id);
      // Match verified: the invoice leaves PENDING_MATCH and lands in MATCHED
      // (the "Ready to Submit" queue). Refresh both queues.
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_MATCH') });
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('MATCHED') });
      toast.success('Invoice matched · ready to submit for approval');
    },
    onError: (err) => toast.error(extractApiError(err, 'Match failed')),
  });
}

export function useSubmitApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoicesApi.submitApproval(id),
    onSuccess: (invoice) => {
      qc.setQueryData(queryKeys.invoice(invoice.id), invoice);
      refreshInvoice(qc, invoice.id);
      // The invoice leaves MATCHED and enters the approval chain.
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('MATCHED') });
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_APPROVAL') });
      toast.success('Submitted for approval');
    },
    onError: (err) => toast.error(extractApiError(err, 'Submit failed')),
  });
}

export function useApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoicesApi.approve(id),
    onSuccess: (result) => {
      qc.setQueryData(queryKeys.invoice(result.id), result);
      refreshInvoice(qc, result.id);
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_APPROVAL') });
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('APPROVED') });
      toast.success(
        result.chainComplete
          ? 'Invoice fully approved'
          : 'Approval recorded · routed to next approver',
      );
    },
    onError: (err) => toast.error(extractApiError(err, 'Approve failed')),
  });
}

export function useReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      invoicesApi.reject(id, reason),
    onSuccess: (invoice) => {
      qc.setQueryData(queryKeys.invoice(invoice.id), invoice);
      refreshInvoice(qc, invoice.id);
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_APPROVAL') });
      qc.invalidateQueries({ queryKey: queryKeys.invoicesByStatus('PENDING_REVIEW') });
      toast.success('Invoice rejected · returned for review');
    },
    onError: (err) => toast.error(extractApiError(err, 'Reject failed')),
  });
}

export function useFlagException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoicesApi.flagException(id),
    onSuccess: (invoice) => {
      qc.setQueryData(queryKeys.invoice(invoice.id), invoice);
      refreshInvoice(qc, invoice.id);
      toast.success('Flagged as exception');
    },
    onError: (err) => toast.error(extractApiError(err, 'Flag failed')),
  });
}
