export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/tiff',
  'image/tif',
] as const;

export const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff'] as const;

export const UPLOAD_SUBFOLDERS = {
  RAW: 'raw',
  PROCESSED: 'processed',
  REVIEW: 'review',
  REJECTED: 'rejected',
  // Holds files that have been OCR-extracted but NOT yet committed to the DB.
  // A human verifies the extracted fields first, then commit moves the file out.
  STAGING: 'staging',
} as const;

export const QUEUES = {
  UPLOAD: 'upload-queue',
  OCR: 'ocr-queue',
} as const;

export const JOBS = {
  PROCESS_UPLOAD: 'process-upload',
  PROCESS_OCR: 'process-ocr',
} as const;
