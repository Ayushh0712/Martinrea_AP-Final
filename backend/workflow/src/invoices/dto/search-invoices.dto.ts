import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';

/**
 * Query params for GET /api/invoices/search (PRD DAT-05).
 *
 * Supports filtering by date range, supplier (name/id), PO number, invoice
 * number, status, amount range and ingestion channel; plus sorting,
 * pagination and CSV export (`format=csv` or `Accept: text/csv`).
 */
export const SEARCH_SORT_FIELDS = [
  'createdAt',
  'invoiceNumber',
  'supplierName',
  'poNumber',
  'totalAmount',
  'status',
] as const;

export class SearchInvoicesDto {
  /**
   * Global keyword (UI-A-02 "global keyword search"). Matches (case-insensitive,
   * partial) across invoice number, supplier name, supplier id and PO number.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;

  /**
   * Convenience status grouping for the dashboard:
   *   'open'   -> still in the pipeline (not a terminal status)
   *   'closed' -> terminal (APPROVED / REJECTED)
   * Ignored when an explicit `status` is supplied.
   */
  @IsOptional()
  @IsIn(['open', 'closed'])
  statusGroup?: 'open' | 'closed';

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

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
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMax?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ingestionChannel?: string;

  @IsOptional()
  @IsIn(SEARCH_SORT_FIELDS as unknown as string[])
  sortBy?: (typeof SEARCH_SORT_FIELDS)[number] = 'createdAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  sortDir?: 'ASC' | 'DESC' | 'asc' | 'desc' = 'DESC';

  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 25;
}
