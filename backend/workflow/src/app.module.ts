import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import ocrConfiguration from './ocr-app/config/configuration';
import { OcrAppModule } from './ocr-app/ocr-app.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { PoIngestModule } from './po-ingest/po-ingest.module';
import { RulesEngineModule } from './rules-engine/rules-engine.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EscalationModule } from './escalation/escalation.module';
import { AppController } from './app.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration, ocrConfiguration],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    UsersModule,
    AuditLogsModule,
    NotificationsModule,
    RulesEngineModule,
    InvoicesModule,
    PurchaseOrdersModule,
    PoIngestModule,
    EscalationModule,
    OcrAppModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
