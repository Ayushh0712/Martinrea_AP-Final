import { Module } from '@nestjs/common';
import { OciModule } from '../ocr-app/oci/oci.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { PoDocumentsController } from './po-documents.controller';
import { PoIngestController } from './po-ingest.controller';
import { PoJsonAutoIngestService } from './po-json-autoingest.service';
import { PoJsonLocalIngestService } from './po-json-local-ingest.service';
import { PoPdfLocalSyncService } from './po-pdf-local-sync.service';

/**
 * Purchase-order ingestion:
 *   - PoJsonAutoIngestService polls the bucket's PO-JSON/ folder and upserts
 *     uploaded PO data into the DB.
 *   - PoJsonLocalIngestService reads .json files dropped in the local project
 *     PO-Data/ folder straight into the DB (mtime-based change detection).
 *   - PoPdfLocalSyncService pushes PDFs dropped in the local project PO-PDFs/
 *     folder up to the bucket.
 *   - PoDocumentsController resolves PO source documents from the bucket's
 *     PO-PDFs/ folder by filename.
 *
 * Lives outside PurchaseOrdersModule so that module stays free of the
 * OciModule -> InvoicesModule import chain (which itself depends on
 * PurchaseOrdersModule for match allocation).
 */
@Module({
  imports: [OciModule, PurchaseOrdersModule],
  controllers: [PoIngestController, PoDocumentsController],
  providers: [PoJsonAutoIngestService, PoJsonLocalIngestService, PoPdfLocalSyncService],
})
export class PoIngestModule {}
