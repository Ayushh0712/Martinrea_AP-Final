import { HttpException, HttpStatus } from '@nestjs/common';
import { QuarantineReason } from './ingestion.types';

export class IngestionError extends HttpException {
  constructor(
    message: string,
    public readonly code: string,
    public readonly reason: QuarantineReason | 'INTERNAL',
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message, reason }, status);
  }
}

export class FileTooLargeError extends IngestionError {
  constructor(actualBytes: number, maxBytes: number) {
    // PRD ING-01: oversize files are rejected with a 400 (not 413).
    super(
      `File size ${actualBytes} bytes exceeds maximum ${maxBytes} bytes`,
      'FILE_TOO_LARGE',
      'FILE_TOO_LARGE',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class InvalidFileTypeError extends IngestionError {
  constructor(detectedType: string | undefined) {
    super(
      `File type "${detectedType ?? 'unknown'}" is not in the allowed list`,
      'INVALID_FILE_TYPE',
      'INVALID_TYPE',
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
}

export class EmptyFileError extends IngestionError {
  constructor() {
    super('File is empty', 'EMPTY_FILE', 'EMPTY_FILE', HttpStatus.BAD_REQUEST);
  }
}

/**
 * The document passed validation but the backing object store (e.g. the OCI
 * PAR bucket) could not be reached or refused the write. This is upstream/
 * transient, NOT the caller's fault -- surfaced as 503 so the client shows a
 * "temporarily unavailable, please retry" message instead of a generic 500.
 */
export class StorageUnavailableError extends IngestionError {
  constructor(detail: string) {
    super(
      `Document storage is temporarily unavailable. ${detail}`,
      'STORAGE_UNAVAILABLE',
      'INTERNAL',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
