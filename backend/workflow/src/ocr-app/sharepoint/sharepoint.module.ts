import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { SharePointAutoIngestService } from './sharepoint-autoingest.service';
import { SharePointController } from './sharepoint.controller';
import { SharePointService } from './sharepoint.service';

@Module({
  imports: [InvoicesModule],
  controllers: [SharePointController],
  providers: [SharePointService, SharePointAutoIngestService],
  exports: [SharePointService],
})
export class SharePointModule {}
