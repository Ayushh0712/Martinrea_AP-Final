import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Query params for GET /api/audit-logs (read-only audit trail view).
 *
 * All filters are optional and combine with AND. Pagination defaults to
 * page 1, 50 rows. The global ValidationPipe runs with
 * forbidNonWhitelisted, so unknown query params return 400.
 */
export class QueryAuditLogsDto {
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  actionType?: string;

  @IsOptional()
  @IsUUID()
  performedBy?: string;

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
  limit?: number = 50;
}
