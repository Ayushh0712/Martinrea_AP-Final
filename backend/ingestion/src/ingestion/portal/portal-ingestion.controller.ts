import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { PreProcessingService } from '../pre-processing/pre-processing.service';
import { KeycloakAuthGuard } from '../auth/keycloak-auth.guard';
import { PortalUploadDto } from './portal-upload.dto';
import { EmptyFileError } from '../shared';

/**
 * Hard safety ceiling for Multer (memory guard against pathological multi-GB
 * uploads). The *business* size rule (MAX_FILE_BYTES, default 10 MB) is enforced
 * inside PreProcessingService so that oversize files still reach the handler and
 * get QUARANTINED + rejected with a descriptive 400 (PRD ING-01), rather than
 * being dropped by Multer with a bare 413 before any audit record is written.
 */
const portalHardCeilingBytes = (() => {
  const parsed = Number(
    process.env.PORTAL_HARD_CEILING_BYTES ?? String(50 * 1024 * 1024),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50 * 1024 * 1024;
})();

/**
 * ING-04: Web Portal Upload.
 *
 * POST /api/ingestion/upload  (multipart/form-data, field: file)
 *
 * Synchronous: validate -> hand to PreProcessingService -> 201 with
 * documentId so Dhwaj's UI can show "Uploaded" immediately. We don't
 * block on OCR -- that runs asynchronously after Roshni's queue trigger.
 *
 * Auth: KeycloakAuthGuard verifies the bearer JWT against the Keycloak
 * JWKS endpoint and maps the role claim to AuthUser.role.
 */
@Controller('api/ingestion')
@UseGuards(KeycloakAuthGuard)
export class PortalIngestionController {
  constructor(private readonly preProcessing: PreProcessingService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      // Only a hard memory-safety ceiling here (well above the 10 MB business
      // rule). The business size check + quarantine live in PreProcessingService
      // so oversize files are audited and rejected with a 400, not silently 413'd.
      limits: { fileSize: portalHardCeilingBytes },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: PortalUploadDto,
    @Req() req: Request,
  ) {
    if (!file) throw new EmptyFileError();

    const result = await this.preProcessing.validateAndHandoff(file.buffer, {
      sourceChannel: 'portal',
      originalName: file.originalname,
      sourceMeta: {
        uploadedBy: req.user?.email ?? 'unknown',
        userId: req.user?.id ?? 'unknown',
        clientMimeType: file.mimetype,
        vendorHint: body.vendorHint ?? null,
        notes: body.notes ?? null,
      },
    });

    return {
      success: true,
      data: {
        documentId: result.documentId,
        status: result.isDuplicate ? 'DUPLICATE' : 'STAGED',
        estimatedOcrTimeSec: 120,
      },
    };
  }
}
