import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { OciModule } from '../oci/oci.module';
import { DocumentsController } from './documents.controller';
import { TiffPreviewService } from './tiff-preview.service';

/**
 * PRD DAT-02 document-view endpoint. Relies on OciService (from OciModule) for
 * the PAR view URL and the Sequelize Invoice model for invoice lookup.
 */
@Module({
  imports: [OciModule, SequelizeModule.forFeature([Invoice])],
  controllers: [DocumentsController],
  providers: [TiffPreviewService],
  exports: [TiffPreviewService],
})
export class DocumentsModule {}
