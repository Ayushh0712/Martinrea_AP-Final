export const InvoiceStatus = {
  RECEIVED: 'RECEIVED',
  OCR_PROCESSING: 'OCR_PROCESSING',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PENDING_MATCH: 'PENDING_MATCH',
  MATCHED: 'MATCHED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXCEPTION: 'EXCEPTION',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export interface ApprovalRecord {
  approverId: string;
  decision: 'APPROVED' | 'REJECTED';
  timestamp: string;
  notes?: string;
}

/**
 * Display identity of one approver in the chain, resolved server-side so the
 * lifecycle stepper can label approver stages ("Plant Manager") instead of
 * UUIDs. `name`/`role` are null when the chained id no longer matches a live
 * user (e.g. re-seeded users frozen into an old chain).
 */
export interface ApproverDetails {
  userId: string;
  name: string | null;
  role: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  supplierId: string | null;
  poNumber: string | null;
  totalAmount: number;
  currency: string;
  status: InvoiceStatus;
  /**
   * Status held immediately before the current one. Null for invoices created
   * directly at their status (OCR paths) or predating the column.
   */
  previousStatus?: InvoiceStatus | null;
  /**
   * Stage held when the invoice last entered EXCEPTION. Survives retrieval
   * (unlike previousStatus) and is overwritten by each new exception cycle —
   * anchors the stepper's exception lane. Null for exceptions created
   * directly (OCR-validation rejects) or rows predating the column.
   */
  exceptionFrom?: InvoiceStatus | null;
  ingestionChannel: string | null;
  plantId: string | null;
  currentApproverId: string | null;
  approvalChain: string[] | null;
  approvalChainDetails?: ApproverDetails[];
  approvalsCompleted: ApprovalRecord[] | null;
  /**
   * Display identity for each approvalsCompleted record (same order). Names
   * the rejecting approver after a rejection clears the approval chain.
   */
  approvalsCompletedDetails?: ApproverDetails[];
  /**
   * Role chain the amount-based routing rules would send this invoice
   * through (e.g. ["Plant_Manager", "Finance_Director"] for > $10k).
   * Display-only projection; the real chain is computed at submit-approval.
   */
  predictedRoleChain?: string[];
  rejectionReason: string | null;
  pendingApprovalSince: string | null;
  lastEscalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Human-readable labels for backend Role enum values. */
export const ROLE_LABELS: Record<string, string> = {
  AP_Clerk: 'AP Clerk',
  Plant_Manager: 'Plant Manager',
  Finance_Director: 'Finance Director',
  VP_Finance: 'VP Finance',
};

/** "Plant_Manager" -> "Plant Manager"; unknown roles fall back to the raw value. */
export function roleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ');
}

export interface AllowedTransitionsResponse {
  id: string;
  currentStatus: InvoiceStatus;
  allowedTransitions: InvoiceStatus[];
}

export interface CreateInvoicePayload {
  invoiceNumber: string;
  supplierName: string;
  supplierId?: string;
  poNumber?: string;
  totalAmount: number;
  currency?: string;
  ingestionChannel?: string;
  plantId?: string;
}

export interface ApproveResult extends Invoice {
  chainComplete?: boolean;
  nextApproverId?: string | null;
}
