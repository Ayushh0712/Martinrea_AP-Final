import { Global, Module } from '@nestjs/common';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [AuditLogsModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
