/**
 * Document type classification produced by the OCR DocumentTypeDetector.
 *
 * Replaces the former `@prisma/client` `DocumentType` enum after OCR
 * persistence moved onto Sequelize. Values are unchanged so persisted rows
 * and the `/api/ocr/*` response contract stay identical.
 */
export enum DocumentType {
  INVOICE = 'INVOICE',
  RECEIPT = 'RECEIPT',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
}
