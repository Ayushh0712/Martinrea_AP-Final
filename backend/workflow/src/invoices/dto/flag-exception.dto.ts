import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Exception reason codes. The first group is the PRD UI-B-04 match-stage set;
 * the second group covers OCR-validation-stage rejections (a reviewer pulling a
 * bad/non-invoice document out of the review queue).
 */
export enum ExceptionReasonCode {
  // Match-stage (UI-B-04)
  PRICE_VARIANCE = 'PRICE_VARIANCE',
  QUANTITY_MISMATCH = 'QUANTITY_MISMATCH',
  DUPLICATE_INVOICE = 'DUPLICATE_INVOICE',
  MISSING_PO = 'MISSING_PO',
  // OCR-validation-stage rejections
  NOT_AN_INVOICE = 'NOT_AN_INVOICE',
  ILLEGIBLE_SCAN = 'ILLEGIBLE_SCAN',
  WRONG_DOCUMENT = 'WRONG_DOCUMENT',
  OTHER = 'OTHER',
}

/**
 * Body for POST /api/invoices/:id/flag-exception (PRD UI-B-04). Notes are
 * required when the reason code is OTHER; an optional attachment reference can
 * point at a previously-uploaded supporting file.
 */
export class FlagExceptionDto {
  @IsEnum(ExceptionReasonCode)
  reasonCode!: ExceptionReasonCode;

  @ValidateIf((o: FlagExceptionDto) => o.reasonCode === ExceptionReasonCode.OTHER)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentRef?: string;
}
