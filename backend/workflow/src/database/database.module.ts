import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { InvoicePoLineReservation } from '../invoices/entities/invoice-po-line-reservation.entity';
import { PurchaseOrder } from '../purchase-orders/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchase-orders/entities/purchase-order-line.entity';
import { GoodsReceipt } from '../goods-receipts/entities/goods-receipt.entity';
import { GoodsReceiptLine } from '../goods-receipts/entities/goods-receipt-line.entity';
import { OcrResult } from '../ocr-results/entities/ocr-result.entity';
import { MatchRecord } from '../match-records/entities/match-record.entity';
import { MatchDiscrepancy } from '../match-records/entities/match-discrepancy.entity';
import { ApprovalRule } from '../rules-engine/entities/approval-rule.entity';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dialect: 'postgres',
        host: config.get<string>('db.host'),
        port: config.get<number>('db.port'),
        username: config.get<string>('db.username'),
        password: config.get<string>('db.password'),
        database: config.get<string>('db.name'),
        models: [
          User,
          AuditLog,
          Invoice,
          InvoiceLineItem,
          InvoicePoLineReservation,
          PurchaseOrder,
          PurchaseOrderLine,
          GoodsReceipt,
          GoodsReceiptLine,
          OcrResult,
          MatchRecord,
          MatchDiscrepancy,
          ApprovalRule,
        ],
        autoLoadModels: true,
        // synchronize() is fine for local dev; production schema is owned
        // by Roshni's Flyway migrations (DAT-01) and this must be false.
        synchronize: config.get<string>('nodeEnv') !== 'production',
        logging: console.log,
        // Headroom so the background pollers (OCI auto-ingest, escalation cron,
        // registry sync) plus concurrent user actions can't starve the pool and
        // intermittently fail state-changing requests.
        pool: { max: 20, min: 2, acquire: 30000, idle: 10000 },
      }),
    }),
  ],
})
export class DatabaseModule {}
