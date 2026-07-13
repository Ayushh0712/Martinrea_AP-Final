import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Editable invoice fields (PRD DAT-03 PATCH). Status is intentionally NOT
 * here - lifecycle changes go through the state-machine transition endpoints.
 */
export class UpdateInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  poNumber?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  totalAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ingestionChannel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  plantId?: string;
}
