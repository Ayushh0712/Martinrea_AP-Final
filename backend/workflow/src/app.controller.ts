import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { Roles } from './common/decorators/roles.decorator';
import { Role } from './common/enums/role.enum';
import {
  AuthenticatedUser,
  CurrentUser,
} from './common/decorators/current-user.decorator';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'workflow-service', ts: new Date().toISOString() };
  }

  /**
   * Smoke-test endpoint demonstrating the RolesGuard.
   *
   * Per PRD WF-01:
   *   "Approval endpoints return 403 Forbidden if called by an AP_Clerk."
   */
  @Get('workflow/approval-test')
  @Roles(Role.PLANT_MANAGER, Role.FINANCE_DIRECTOR)
  approvalTest(@CurrentUser() user: AuthenticatedUser) {
    return {
      message: 'You are authorised to approve invoices.',
      asRole: user.role,
      asUser: user.email,
    };
  }
}
