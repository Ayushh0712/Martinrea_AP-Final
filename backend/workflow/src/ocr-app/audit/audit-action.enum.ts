/**
 * OCR pipeline audit action types.
 *
 * Replaces the former `@prisma/client` `AuditAction` enum. The Sequelize
 * `AuditLog.actionType` column is a plain string, so these values are written
 * as-is (keeping the historical action names the frontend already knows).
 */
export enum AuditAction {
  FILE_UPLOADED = 'FILE_UPLOADED',
  FILE_REJECTED = 'FILE_REJECTED',
  UPLOAD = 'UPLOAD',
  OCR_STARTED = 'OCR_STARTED',
  OCR_COMPLETED = 'OCR_COMPLETED',
  OCR_FAILED = 'OCR_FAILED',
  OCR_RETRIED = 'OCR_RETRIED',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  DUPLICATE_DETECTED = 'DUPLICATE_DETECTED',
  MOVED_TO_REVIEW = 'MOVED_TO_REVIEW',
  MOVED_TO_PROCESSED = 'MOVED_TO_PROCESSED',
  INVOICE_UPDATED = 'INVOICE_UPDATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
}
