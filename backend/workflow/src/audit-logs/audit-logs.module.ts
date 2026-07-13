import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuditLog } from './entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogsController } from './audit-logs.controller';

@Module({
  // User is registered here so findAll can resolve performedBy ids to names.
  imports: [SequelizeModule.forFeature([AuditLog, User])],
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
