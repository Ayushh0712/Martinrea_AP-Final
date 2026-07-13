import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';

/**
 * Query params for GET /api/invoices (list view).
 *
 * All filters are optional and combine with AND. Pagination defaults to
 * page 1, 20 rows. The global ValidationPipe runs with
 * forbidNonWhitelisted, so unknown query params return 400 - keep the
 * frontend's query keys aligned with the fields below.
 */
export class QueryInvoicesDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  plantId?: string;

  @IsOptional()
  @IsUUID()
  currentApproverId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  supplierId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;
}
