import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } } | null)?.response
          ?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const queryKeys = {
  me: ['auth', 'me'] as const,
  invoice: (id: string) => ['invoices', id] as const,
  invoiceTransitions: (id: string) =>
    ['invoices', id, 'allowed-transitions'] as const,
  invoiceList: (ids: string[]) => ['invoices', 'list', ids.join(',')] as const,
  invoicesByStatus: (status: string) => ['invoices', 'by-status', status] as const,
  approvedInvoicesByPo: (po: string) =>
    ['invoices', 'approved-by-po', po] as const,
  approvedInvoicesAll: ['invoices', 'approved', 'all'] as const,
  auditLogs: ['audit-logs'] as const,
  ocrReviewQueue: ['ocr', 'review-queue'] as const,
  ocrInvoice: (id: string) => ['ocr', 'invoice', id] as const,
  documentView: (id: string) => ['documents', id, 'view'] as const,
  purchaseOrder: (po: string) => ['workflow', 'po', po] as const,
  purchaseOrders: ['workflow', 'po', 'list'] as const,
  poDocument: (po: string) => ['workflow', 'po', po, 'document'] as const,
};
