import { Global, Module } from '@nestjs/common';
import { ExtractionStoreService } from './extraction-store.service';

/**
 * Provides the in-memory OCR extraction store globally so both the OCI
 * auto-ingest poller and the extractions controller share one instance.
 * The controller itself lives in OciModule (it needs OciAutoIngestService).
 */
@Global()
@Module({
  providers: [ExtractionStoreService],
  exports: [ExtractionStoreService],
})
export class ExtractionsModule {}
