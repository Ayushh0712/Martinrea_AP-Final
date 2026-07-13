import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import * as path from 'path';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OciAutoIngestService } from './oci-autoingest.service';
import { OciService } from './oci.service';

const SUPPORTED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff']);

class OciProcessDto {
  @ApiProperty({ description: 'OCI object name to fetch and OCR-extract', example: 'AP-Accepted_Correct/inv-123.pdf' })
  @IsString()
  @IsNotEmpty()
  objectName!: string;
}

@ApiTags('OCI File Manager')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ocr/oci')
export class OciController {
  constructor(
    private readonly oci: OciService,
    private readonly autoIngest: OciAutoIngestService,
  ) {}

  /**
   * Scan the source folder now and OCR-extract any new documents into the
   * in-memory store. Called by the portal upload flow right after a file lands
   * in the bucket so it is extracted immediately instead of waiting for the
   * next auto-ingest poll tick. Dedup keeps it idempotent.
   */
  @Post('scan')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Scan the OCI source folder now and OCR-extract new documents' })
  async scanNow() {
    const result = await this.autoIngest.runScan();
    return { success: true, ...result };
  }

  /**
   * List all files in the OCI bucket.
   * Optionally filter by a prefix (sub-folder).
   */
  @Get('files')
  @ApiOperation({ summary: 'List documents in OCI Object Storage bucket' })
  @ApiQuery({ name: 'prefix', required: false, description: 'OCI object name prefix (folder)' })
  async listFiles(@Query('prefix') prefix?: string) {
    const docs = await this.oci.listDocuments(prefix);
    return {
      success: true,
      count: docs.length,
      files: docs,
    };
  }

  /**
   * Fetch a single OCI object by name, OCR-extract its fields, and store the
   * result in memory (no DB write). Returns the stored extraction.
   */
  @Post('process')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fetch an OCI file and OCR-extract its fields into memory' })
  async processOciFile(@Body() body: OciProcessDto) {
    if (!body.objectName || !body.objectName.trim()) {
      throw new BadRequestException('objectName is required');
    }

    const ext = path.extname(body.objectName).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) {
      throw new BadRequestException(
        `Unsupported file type "${ext}". Allowed: ${[...SUPPORTED_EXT].join(', ')}`,
      );
    }

    const extraction = await this.autoIngest.ingestObject(body.objectName, ext);
    return {
      success: true,
      source: 'OCI',
      objectName: body.objectName,
      extraction,
    };
  }
}
