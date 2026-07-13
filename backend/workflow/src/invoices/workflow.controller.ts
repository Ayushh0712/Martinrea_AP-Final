import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { SubmitMatchDto } from './dto/submit-match.dto';
import { InvoicesService } from './invoices.service';

/**
 * PRD UI-B-05 contract surface. The two-step match workflow lives here:
 *   - POST /api/workflow/submit-match     verify the 2-way match (PENDING_MATCH -> MATCHED)
 *   - POST /api/workflow/submit-approval  route a MATCHED invoice (MATCHED -> PENDING_APPROVAL)
 *
 * Each mirrors the per-id route on InvoicesController (kept for compatibility).
 */
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post('submit-match')
  @HttpCode(HttpStatus.OK)
  async submitMatch(
    @Body() dto: SubmitMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const invoice = await this.invoices.submitMatch(dto.invoiceId, user.id);
    return {
      success: true,
      data: {
        id: invoice.id,
        status: invoice.status,
        approvalChain: invoice.approvalChain,
        currentApproverId: invoice.currentApproverId,
        approvalsCompleted: invoice.approvalsCompleted,
      },
    };
  }

  @Post('submit-approval')
  @HttpCode(HttpStatus.OK)
  async submitForApproval(
    @Body() dto: SubmitMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const invoice = await this.invoices.submitForApproval(
      dto.invoiceId,
      user.id,
    );
    return {
      success: true,
      data: {
        id: invoice.id,
        status: invoice.status,
        approvalChain: invoice.approvalChain,
        currentApproverId: invoice.currentApproverId,
        approvalsCompleted: invoice.approvalsCompleted,
      },
    };
  }
}
