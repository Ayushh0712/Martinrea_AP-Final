import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MatchRecord } from './entities/match-record.entity';
import { MatchDiscrepancy } from './entities/match-discrepancy.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchase-orders/entities/purchase-order-line.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { MatchService } from './match.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      MatchRecord,
      MatchDiscrepancy,
      PurchaseOrder,
      PurchaseOrderLine,
      InvoiceLineItem,
    ]),
    AuditLogsModule,
  ],
  providers: [MatchService],
  exports: [MatchService],
})
export class MatchRecordsModule {}
