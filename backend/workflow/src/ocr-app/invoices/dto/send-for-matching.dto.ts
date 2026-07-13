import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DocumentType } from '../../../common/enums/document-type.enum';
import { CommitLineItemDto } from './commit-invoice.dto';

/**
 * Body for `POST /api/ocr/extractions/:id/send-for-matching`.
 *
 * Carries the human-edited fields from the OCR Validation screen. The
 * extraction to persist is identified by the `:id` path param (an in-memory
 * extraction), so no `stagingId` is needed. Any field omitted falls back to the
 * value captured at extraction time (held in the in-memory store).
 */
export class SendForMatchingDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  supplierName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  supplierTaxId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  invoiceNumber?: string | null;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)', nullable: true })
  @IsOptional()
  @IsString()
  invoiceDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  poNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  currency?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  subtotal?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  taxAmount?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  discount?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  totalAmount?: number | null;

  @ApiPropertyOptional({ description: 'Confidence score 0–100', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  confidenceScore?: number | null;

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  language?: string | null;

  @ApiPropertyOptional({ type: [CommitLineItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitLineItemDto)
  lineItems?: CommitLineItemDto[];
}
