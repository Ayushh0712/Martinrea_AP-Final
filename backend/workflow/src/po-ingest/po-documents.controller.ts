import { Controller, Get, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as path from 'path';
import { OciService } from '../ocr-app/oci/oci.service';

const SUPPORTED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff']);

/**
 * Fetch a purchase order's source document from the OCI bucket by FILENAME
 * convention: the PDF for PO-001 lives at `PO-PDFs/PO-001.pdf`. No DB linkage
 * is stored — the object name IS the link, so PDFs and JSON data can be
 * uploaded independently and in any order.
 */
@ApiTags('Purchase Orders')
@ApiBearerAuth()
@Controller('purchase-orders')
export class PoDocumentsController {
  private readonly prefix: string;

  constructor(
    private readonly oci: OciService,
    private readonly config: ConfigService,
  ) {
    this.prefix = this.config.get<string>('PO_PDF_PREFIX') ?? 'PO-PDFs/';
  }

  @Get(':poNumber/document')
  @ApiOperation({
    summary:
      'Resolve the PO document in the OCI PO-PDFs folder by filename (<poNumber>.pdf) and return its view URL',
  })
  async getDocument(@Param('poNumber') poNumber: string) {
    const wanted = poNumber.trim().toLowerCase();
    const { objects } = await this.oci.listObjects(this.prefix);

    const match = objects.find((o) => {
      const ext = path.extname(o.name).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) return false;
      const base = path.basename(o.name, path.extname(o.name)).trim().toLowerCase();
      return base === wanted;
    });

    return {
      success: true,
      data: {
        poNumber,
        available: !!match,
        objectName: match?.name ?? null,
        url: match ? this.oci.getViewUrl(match.name) : null,
      },
    };
  }
}
