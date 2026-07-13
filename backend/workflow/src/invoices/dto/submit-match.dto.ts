import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * PRD UI-B-05 contract for POST /api/workflow/submit-match.
 *
 * Only invoiceId is required server-side (the invoice is the source of truth
 * for amount/PO/supplier); the extra fields are accepted for traceability and
 * forwarded into the match audit entry.
 */
export class SubmitMatchDto {
  @IsUUID()
  invoiceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  poNumber?: string;

  @IsOptional()
  matchSummary?: Record<string, unknown>;
}
