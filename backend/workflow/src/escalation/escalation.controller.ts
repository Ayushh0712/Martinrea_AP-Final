import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

/**
 * Ops endpoint to trigger the WF-05 escalation pass on demand.
 * Useful for testing without waiting an hour for the cron tick.
 * Restricted to Finance_Director.
 */
@Controller('escalation')
export class EscalationController {
  constructor(private readonly escalation: EscalationService) {}

  @Post('run-now')
  @Roles(Role.FINANCE_DIRECTOR)
  @HttpCode(HttpStatus.OK)
  runNow() {
    return this.escalation.runOnce();
  }
}
