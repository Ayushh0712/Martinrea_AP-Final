import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateInvoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  invoiceNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  supplierName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  poNumber?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  totalAmount!: number;

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
