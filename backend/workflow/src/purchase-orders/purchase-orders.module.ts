import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { InvoicePoLineReservation } from '../invoices/entities/invoice-po-line-reservation.entity';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderAllocationService } from './purchase-order-allocation.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      PurchaseOrder,
      PurchaseOrderLine,
      InvoicePoLineReservation,
    ]),
    AuditLogsModule,
  ],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, PurchaseOrderAllocationService],
  exports: [PurchaseOrdersService, PurchaseOrderAllocationService],
})
export class PurchaseOrdersModule {}
