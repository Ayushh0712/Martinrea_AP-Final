import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Invoice } from '../invoices/entities/invoice.entity';
import { EscalationService } from './escalation.service';
import { EscalationController } from './escalation.controller';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    SequelizeModule.forFeature([Invoice]),
    UsersModule,
    NotificationsModule,
    AuditLogsModule,
  ],
  controllers: [EscalationController],
  providers: [EscalationService],
  exports: [EscalationService],
})
export class EscalationModule {}
