import { InvoiceStatus } from '../../common/enums/invoice-status.enum';

/**
 * Permitted state transitions for the invoice lifecycle.
 *
 * PRD WF-02 (Section 4.7) acceptance criterion:
 *   "State machine strictly governs transitions ...
 *    Any transition not in the permitted list returns a 409 Conflict."
 *
 * Happy path (PRD Section 5.2):
 *   RECEIVED -> OCR_PROCESSING -> PENDING_REVIEW -> PENDING_MATCH
 *            -> MATCHED -> PENDING_APPROVAL -> APPROVED
 *
 * Off-ramps:
 *   - EXCEPTION can be raised from PENDING_MATCH (PRD UI-B-04)
 *     and can be resolved either back to PENDING_MATCH or to REJECTED.
 *   - REJECTED returns to PENDING_REVIEW (PRD WF-03) so the clerk can fix
 *     the issue and resubmit through the chain.
 *
 * APPROVED is terminal (a paid voucher cannot re-enter the workflow).
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<InvoiceStatus, ReadonlyArray<InvoiceStatus>>> =
  Object.freeze({
    [InvoiceStatus.RECEIVED]: [InvoiceStatus.OCR_PROCESSING],
    [InvoiceStatus.OCR_PROCESSING]: [
      InvoiceStatus.PENDING_REVIEW,
      InvoiceStatus.EXCEPTION,
    ],
    [InvoiceStatus.PENDING_REVIEW]: [
      InvoiceStatus.PENDING_MATCH,
      InvoiceStatus.EXCEPTION,
    ],
    [InvoiceStatus.PENDING_MATCH]: [
      InvoiceStatus.MATCHED,
      InvoiceStatus.EXCEPTION,
    ],
    [InvoiceStatus.MATCHED]: [InvoiceStatus.PENDING_APPROVAL],
    [InvoiceStatus.PENDING_APPROVAL]: [
      InvoiceStatus.APPROVED,
      InvoiceStatus.REJECTED,
    ],
    [InvoiceStatus.APPROVED]: [],
    [InvoiceStatus.REJECTED]: [InvoiceStatus.PENDING_REVIEW],
    [InvoiceStatus.EXCEPTION]: [
      InvoiceStatus.PENDING_MATCH,
      InvoiceStatus.PENDING_REVIEW,
      InvoiceStatus.REJECTED,
    ],
    // OCR-pipeline lifecycle states (merged from the former Prisma OCR schema).
    // COMPLETED = human-verified commit; FAILED = OCR exhausted retries (may be
    // re-queued back to RECEIVED); DUPLICATE_INVOICE = flagged for review.
    [InvoiceStatus.COMPLETED]: [InvoiceStatus.PENDING_MATCH],
    [InvoiceStatus.FAILED]: [InvoiceStatus.RECEIVED],
    [InvoiceStatus.DUPLICATE_INVOICE]: [
      InvoiceStatus.PENDING_REVIEW,
      InvoiceStatus.REJECTED,
    ],
  });
