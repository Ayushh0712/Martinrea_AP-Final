import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';

export class TransitionInvoiceDto {
  @IsEnum(InvoiceStatus)
  to!: InvoiceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class RejectInvoiceDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}
