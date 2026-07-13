import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { SequelizeModule } from '@nestjs/sequelize';
import { memoryStorage } from 'multer';
import { AuditLog } from '../../audit-logs/entities/audit-log.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../../invoices/entities/invoice-line-item.entity';
import { OcrResult } from '../../ocr-results/entities/ocr-result.entity';
import { QUEUES } from '../common/constants';
import { InvoiceProcessorService } from './invoice-processor.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { OcrProcessor } from './processors/ocr.processor';
import { UploadProcessor } from './processors/upload.processor';

@Module({
  imports: [
    SequelizeModule.forFeature([Invoice, InvoiceLineItem, OcrResult, AuditLog]),
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // Multer hard cap (real check is in service)
    }),
    BullModule.registerQueue({ name: QUEUES.UPLOAD }, { name: QUEUES.OCR }),
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceProcessorService, UploadProcessor, OcrProcessor],
  exports: [InvoicesService],
})
export class InvoicesModule {}
