import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DocumentType } from '../../../common/enums/document-type.enum';

/**
 * One verified line item, as edited by the human reviewer.
 */
export class CommitLineItemDto {
  @ApiPropertyOptional({ description: 'Item code / SKU / part number', nullable: true })
  @IsOptional()
  @IsString()
  itemCode?: string | null;

  @ApiPropertyOptional({ description: 'Line item description', nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ description: 'Quantity', nullable: true })
  @IsOptional()
  @IsNumber()
  quantity?: number | null;

  @ApiPropertyOptional({ description: 'Unit price', nullable: true })
  @IsOptional()
  @IsNumber()
  unitPrice?: number | null;

  @ApiPropertyOptional({ description: 'Line total', nullable: true })
  @IsOptional()
  @IsNumber()
  lineTotal?: number | null;
}

/**
 * Body for `POST /api/invoices/commit`.
 *
 * Carries the human-verified invoice fields plus the `stagingId` returned by
 * the extraction step. Any field omitted falls back to the value captured at
 * extraction time (stored in the staging sidecar). The whole object is what
 * actually gets persisted to the database.
 */
export class CommitInvoiceDto {
  @ApiProperty({ description: 'stagingId returned by the extract step', example: 'staging-1781076148029-uuid.pdf' })
  @IsString()
  @IsNotEmpty()
  stagingId!: string;

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
