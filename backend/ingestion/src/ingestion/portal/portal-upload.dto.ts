import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PortalUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorHint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
