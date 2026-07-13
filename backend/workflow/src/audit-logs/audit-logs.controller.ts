import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

/**
 * Read-only audit trail API (DAT-04).
 *
 * Restricted to Finance_Director because the audit log is sensitive
 * compliance data. To widen access (e.g. let approvers view the trail for
 * their own invoices) add more roles to @Roles below or scope the query.
 *
 * The append-only guarantee is preserved: this controller exposes GET only -
 * there is intentionally no create/update/delete route.
 */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @Roles(Role.FINANCE_DIRECTOR, Role.VP_FINANCE)
  async findAll(@Query() query: QueryAuditLogsDto) {
    return this.auditLogs.findAll(query);
  }
}
