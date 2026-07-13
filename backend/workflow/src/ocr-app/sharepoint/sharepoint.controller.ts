import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SharePointAutoIngestService } from './sharepoint-autoingest.service';
import { SharePointService } from './sharepoint.service';

/**
 * SharePoint source manager for the OCR pipeline (BLOB_TRANSPORT=sharepoint).
 *
 * Mirrors the OCI controller: the portal upload flow calls `scan` right after a
 * file lands in the SharePoint drive so it enters OCR immediately instead of
 * waiting for the next auto-ingest poll tick.
 */
@ApiTags('SharePoint File Manager')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ocr/sharepoint')
export class SharePointController {
  constructor(
    private readonly sharePoint: SharePointService,
    private readonly autoIngest: SharePointAutoIngestService,
  ) {}

  @Post('scan')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Scan the SharePoint raw/ folder now and enqueue new documents for OCR',
  })
  async scanNow() {
    const result = await this.autoIngest.runScan();
    return { success: true, ...result };
  }

  @Get('files')
  @ApiOperation({ summary: 'List documents in the configured SharePoint raw/ folder' })
  @ApiQuery({ name: 'prefix', required: false, description: 'Folder prefix under the root (default raw/)' })
  async listFiles(@Query('prefix') prefix?: string) {
    const docs = await this.sharePoint.listDocuments(prefix ?? 'raw/');
    return { success: true, count: docs.length, files: docs };
  }
}
