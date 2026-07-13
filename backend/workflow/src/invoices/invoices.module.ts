import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { InvoicePoLineReservation } from './entities/invoice-po-line-reservation.entity';
import { OcrResult } from '../ocr-results/entities/ocr-result.entity';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { WorkflowController } from './workflow.controller';
import { InvoiceStateMachineService } from './state-machine/invoice-state-machine.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RulesEngineModule } from '../rules-engine/rules-engine.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { MatchRecordsModule } from '../match-records/match-records.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';

@Module({
  imports: [
    SequelizeModule.forFeature([Invoice, InvoiceLineItem, InvoicePoLineReservation, OcrResult]),
    AuditLogsModule,
    RulesEngineModule,
    NotificationsModule,
    UsersModule,
    MatchRecordsModule,
    PurchaseOrdersModule,
  ],
  controllers: [InvoicesController, WorkflowController],
  providers: [InvoicesService, InvoiceStateMachineService],
  exports: [InvoicesService, InvoiceStateMachineService],
})
export class InvoicesModule {}
