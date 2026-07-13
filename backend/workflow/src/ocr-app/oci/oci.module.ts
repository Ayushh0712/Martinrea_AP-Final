import { Module } from '@nestjs/common';
import { TiffPreviewService } from '../documents/tiff-preview.service';
import { ExtractionsController } from '../extractions/extractions.controller';
import { InvoicesModule } from '../invoices/invoices.module';
import { OciAutoIngestService } from './oci-autoingest.service';
import { OciController } from './oci.controller';
import { OciService } from './oci.service';

/**
 * OCI source integration: lists + downloads bucket objects (OciService) and
 * polls the source folder to OCR-extract new documents into the in-memory
 * store (OciAutoIngestService). The ExtractionsController lives here because it
 * needs the poller for its on-demand scan trigger; the ExtractionStoreService
 * it reads is provided globally by ExtractionsModule. InvoicesModule is imported
 * so the "send for matching" action can persist an extraction as an Invoice.
 *
 * TiffPreviewService is a local provider (not imported from DocumentsModule)
 * to avoid a circular dependency — it's a small stateless sharp wrapper.
 */
@Module({
  imports: [InvoicesModule],
  controllers: [OciController, ExtractionsController],
  providers: [OciService, OciAutoIngestService, TiffPreviewService],
  exports: [OciService],
})
export class OciModule {}
