import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CommitLineItemDto } from './commit-invoice.dto';

/**
 * Body for `PATCH /api/ocr/invoices/:id`.
 *
 * Lets the review screen persist human-corrected header fields AND line items
 * back onto the OCR record before the invoice moves to matching (PRD UI-A-09:
 * "correct any mistakes before the invoice proceeds to matching"). The 3-way
 * match workbench reads line items from the OCR record, so corrected lines must
 * be saved here to flow downstream. Every field is optional; only the provided
 * fields are updated. When `lineItems` is present it fully replaces the
 * existing lines.
 */
export class UpdateOcrInvoiceDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  supplierName?: string | null;

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

  @ApiPropertyOptional({ type: [CommitLineItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitLineItemDto)
  lineItems?: CommitLineItemDto[];
}
