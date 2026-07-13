/**
 * Invoice lifecycle states per PRD Section 5.2.
 *
 * The PRD defines the canonical happy-path progression:
 *   RECEIVED -> OCR_PROCESSING -> PENDING_REVIEW -> PENDING_MATCH
 *            -> MATCHED -> PENDING_APPROVAL -> APPROVED
 *
 * Plus two off-ramps:
 *   REJECTED   - from PENDING_APPROVAL (back to PENDING_REVIEW for rework, PRD WF-03)
 *   EXCEPTION  - discrepancy flagged from the 3-way match workbench (PRD UI-B-04)
 *
 * Owners (from PRD Section 5.2):
 *   RECEIVED          -> Ayush  (Ingestion)
 *   OCR_PROCESSING    -> Abhay  (AI/OCR)
 *   PENDING_REVIEW    -> Dhwaj  (UI-A)
 *   PENDING_MATCH     -> Yash   (UI-B)
 *   MATCHED           -> Yash   (UI-B)
 *   PENDING_APPROVAL  -> Mohd Aman (Workflow)
 *   APPROVED          -> Mohd Aman (Workflow)
 *   REJECTED          -> Mohd Aman (Workflow)
 *   EXCEPTION         -> Yash / Mohd Aman
 */
export enum InvoiceStatus {
  RECEIVED = 'RECEIVED',
  OCR_PROCESSING = 'OCR_PROCESSING',
  PENDING_REVIEW = 'PENDING_REVIEW',
  PENDING_MATCH = 'PENDING_MATCH',
  MATCHED = 'MATCHED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXCEPTION = 'EXCEPTION',
  // OCR-pipeline lifecycle states (merged in when OCR persistence moved onto
  // this unified Sequelize enum). COMPLETED = human-verified commit terminal;
  // FAILED = OCR exhausted retries; DUPLICATE_INVOICE = same supplier+number.
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DUPLICATE_INVOICE = 'DUPLICATE_INVOICE',
}

/** Terminal states - no outbound transitions are permitted. */
export const TERMINAL_STATUSES: ReadonlyArray<InvoiceStatus> = [
  InvoiceStatus.APPROVED,
];
