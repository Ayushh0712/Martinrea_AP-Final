import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PoJsonAutoIngestService } from './po-json-autoingest.service';
import { PoJsonLocalIngestService } from './po-json-local-ingest.service';
import { PoPdfLocalSyncService } from './po-pdf-local-sync.service';

/**
 * On-demand trigger for the PO ingest pipeline, so freshly-added PO files can
 * be processed immediately instead of waiting for the next cron tick (mirrors
 * POST /ocr/extractions/scan for invoice documents). Order: local PDF drop
 * folder sync (pushes PDFs up to the bucket), local PO-Data JSON ingest
 * (straight into the DB), then the OCI PO-JSON bucket scan.
 */
@ApiTags('PO Ingest')
@ApiBearerAuth()
@Controller('po-ingest')
export class PoIngestController {
  constructor(
    private readonly ingest: PoJsonAutoIngestService,
    private readonly jsonLocal: PoJsonLocalIngestService,
    private readonly pdfSync: PoPdfLocalSyncService,
  ) {}

  @Post('scan')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Upload PDFs from the local PO-PDFs drop folder, ingest JSONs from the local PO-Data drop folder, then scan the OCI PO-JSON folder',
  })
  async scan() {
    const pdfs = await this.pdfSync.runSync();
    const jsons = await this.jsonLocal.runIngest();
    const result = await this.ingest.runScan();
    return { success: true, ...result, pdfs, jsons };
  }
}
