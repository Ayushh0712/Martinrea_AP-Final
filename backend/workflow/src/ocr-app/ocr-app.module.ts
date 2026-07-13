import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { DocumentsModule } from './documents/documents.module';
import { ExtractionsModule } from './extractions/extractions.module';
import { FilesModule } from './files/files.module';
import { InvoicesModule } from './invoices/invoices.module';
import { OciModule } from './oci/oci.module';
import { OcrModule } from './ocr/ocr.module';
import { QueueModule } from './queue/queue.module';
import { SharePointModule } from './sharepoint/sharepoint.module';

/**
 * Aggregates the AI Invoice OCR feature set (formerly a standalone NestJS app)
 * into the workflow-service. All OCR HTTP routes are mounted under /api/ocr/*.
 *
 * - Persistence uses the unified Sequelize schema (same Invoice table the rest
 *   of the workflow uses) - the former Prisma `ocr` schema has been removed.
 * - Authentication is handled by the workflow-service global JwtAuthGuard;
 *   this module brings no auth of its own.
 */
@Module({
  imports: [
    QueueModule,
    FilesModule,
    AuditModule,
    ExtractionsModule,
    OcrModule,
    InvoicesModule,
    OciModule,
    SharePointModule,
    DocumentsModule,
  ],
})
export class OcrAppModule {}
