import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApproverDetails, InvoicesService } from './invoices.service';
import { Invoice } from './entities/invoice.entity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { SearchInvoicesDto } from './dto/search-invoices.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { FlagExceptionDto } from './dto/flag-exception.dto';
import {
  RejectInvoiceDto,
  TransitionInvoiceDto,
} from './dto/transition-invoice.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { InvoiceStatus } from '../common/enums/invoice-status.enum';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Phase 1 / WF-02 endpoints.
 *
 * - POST   /api/invoices                          create (AP_Clerk only; OCR pipeline creates via internal service calls)
 * - GET    /api/invoices/:id                      fetch
 * - GET    /api/invoices/:id/allowed-transitions  for UI button enablement
 * - POST   /api/invoices/:id/transitions          generic transition (used by tests + ops; FD only)
 * - POST   /api/invoices/:id/submit-review        Aditya UI hook (PENDING_REVIEW -> PENDING_MATCH)
 * - POST   /api/invoices/:id/submit-match         Yash UI hook, step 1 (PENDING_MATCH -> MATCHED)
 * - POST   /api/invoices/:id/submit-approval      Yash UI hook, step 2 (MATCHED -> PENDING_APPROVAL; WF-03 routing engine)
 * - POST   /api/invoices/:id/approve              approver action (PENDING_APPROVAL -> APPROVED)
 * - POST   /api/invoices/:id/reject               current approver only (PENDING_APPROVAL -> PENDING_REVIEW via REJECTED)
 * - POST   /api/invoices/:id/reject-exception     AP_Clerk action (EXCEPTION -> REJECTED, terminal)
 * - POST   /api/invoices/:id/flag-exception       AP_Clerk action (PENDING_MATCH -> EXCEPTION)
 */
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @Roles(Role.AP_CLERK)
  async create(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const invoice = await this.invoices.create(dto, user.id);
    return { success: true, data: await this.toEnrichedDto(invoice) };
  }

  /**
   * Paginated list for the dashboard / workbench grids. Any authenticated
   * user may list; filter via ?status=&plantId=&currentApproverId=&supplierId=
   * and page through with ?page=&limit=.
   */
  @Get()
  async findAll(@Query() query: QueryInvoicesDto) {
    const result = await this.invoices.findAll(query);
    const [approvers, predicted] = await Promise.all([
      this.invoices.approverDetails(result.data),
      this.invoices.predictedRoleChains(result.data),
    ]);
    return {
      success: true,
      data: result.data.map((invoice) => this.toDto(invoice, approvers, predicted)),
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    };
  }

  /**
   * PRD DAT-05 advanced search. Filters: dateFrom/dateTo, supplierName,
   * supplierId, poNumber, invoiceNumber, status, amountMin/amountMax,
   * ingestionChannel; plus sortBy/sortDir + pagination. CSV export via
   * ?format=csv or the `Accept: text/csv` header.
   *
   * NOTE: declared before `:id` so the literal path wins the route match.
   */
  @Get('search')
  async search(
    @Query() dto: SearchInvoicesDto,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.invoices.search(dto);
    const wantsCsv =
      dto.format === 'csv' || (accept ?? '').includes('text/csv');

    if (wantsCsv) {
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="invoices.csv"',
      });
      return this.toCsv(result.data);
    }

    const [approvers, predicted] = await Promise.all([
      this.invoices.approverDetails(result.data),
      this.invoices.predictedRoleChains(result.data),
    ]);
    return {
      success: true,
      data: result.data.map((invoice) => this.toDto(invoice, approvers, predicted)),
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    };
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const invoice = await this.invoices.findById(id);
    return { success: true, data: await this.toEnrichedDto(invoice) };
  }

  /**
   * PRD DAT-03: edit invoice fields (not status). Returns the updated record.
   */
  @Patch(':id')
  @Roles(Role.AP_CLERK)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const invoice = await this.invoices.update(id, dto, user.id);
    return { success: true, data: await this.toEnrichedDto(invoice) };
  }

  /**
   * PRD DAT-03: soft delete (paranoid). The row is retained for the 7-year
   * audit window; reads exclude it.
   */
  @Delete(':id')
  @Roles(Role.AP_CLERK)
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.invoices.softDelete(id, user.id);
    return { success: true, data: { id, deleted: true } };
  }

  @Get(':id/allowed-transitions')
  async allowedTransitions(@Param('id', new ParseUUIDPipe()) id: string) {
    const invoice = await this.invoices.findById(id);
    return {
      success: true,
      data: {
        id: invoice.id,
        currentStatus: invoice.status,
        allowedTransitions: this.invoices.getAllowedTransitions(invoice.status),
      },
    };
  }

  /**
   * Generic admin / ops transition. Restricted to Finance_Director so
   * arbitrary moves cannot be made by anyone else (this endpoint exists
   * primarily for testing and break-glass scenarios).
   */
  @Post(':id/transitions')
  @Roles(Role.FINANCE_DIRECTOR)
  @HttpCode(HttpStatus.OK)
  async transition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransitionInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.invoices.transition(id, dto.to, {
      performedBy: user.id,
      notes: dto.notes ?? null,
    });
    return { success: true, data: await this.toEnrichedDto(updated) };
  }

  @Post(':id/submit-review')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.OK)
  async submitReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Idempotent: if the invoice has already advanced past review (e.g. a
    // double-click, a stale review list, or the OCR->workflow bridge), return
    // it unchanged instead of attempting an illegal PENDING_MATCH -> PENDING_MATCH
    // transition. Only the genuine PENDING_REVIEW -> PENDING_MATCH step runs the
    // state machine.
    const current = await this.invoices.findById(id);
    if (current.status !== InvoiceStatus.PENDING_REVIEW) {
      return { success: true, data: await this.toEnrichedDto(current) };
    }

    const updated = await this.invoices.transition(
      id,
      InvoiceStatus.PENDING_MATCH,
      { performedBy: user.id, notes: 'OCR review completed by AP Clerk' },
    );
    return { success: true, data: await this.toEnrichedDto(updated) };
  }

  @Post(':id/retrieve')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.OK)
  async retrieve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Pull an invoice back out of the exception queue for another OCR review
    // pass. Idempotent: if it is not currently in EXCEPTION (e.g. a double-click
    // or a stale list), return it unchanged rather than attempting an illegal
    // transition. Only the genuine EXCEPTION -> PENDING_REVIEW step runs.
    const current = await this.invoices.findById(id);
    if (current.status !== InvoiceStatus.EXCEPTION) {
      return { success: true, data: await this.toEnrichedDto(current) };
    }

    const updated = await this.invoices.transition(
      id,
      InvoiceStatus.PENDING_REVIEW,
      { performedBy: user.id, notes: 'Retrieved from exception queue' },
    );
    return { success: true, data: await this.toEnrichedDto(updated) };
  }

  @Post(':id/reject-exception')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.OK)
  async rejectException(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Dead-end an exception invoice (EXCEPTION -> REJECTED). Unlike the
    // approver-only `:id/reject` (which bounces PENDING_APPROVAL back to
    // review), this is a clerk action that terminates the invoice: it leaves
    // the exception queue but the row stays in `invoices` and the transition
    // lands in the append-only audit log. Idempotent on stale lists /
    // double-clicks: only a genuine EXCEPTION -> REJECTED step runs.
    const current = await this.invoices.findById(id);
    if (current.status !== InvoiceStatus.EXCEPTION) {
      return { success: true, data: await this.toEnrichedDto(current) };
    }

    const updated = await this.invoices.transition(id, InvoiceStatus.REJECTED, {
      performedBy: user.id,
      rejectionReason: dto.reason,
      notes: dto.reason,
    });
    return { success: true, data: await this.toEnrichedDto(updated) };
  }

  /**
   * Yash's hook from UI-B-05, step 1: verify the 2-way match. Moves
   * PENDING_MATCH -> MATCHED (409 on blocking discrepancies). The invoice
   * rests in MATCHED until `submit-approval` routes it for approval.
   */
  @Post(':id/submit-match')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.OK)
  async submitMatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const queued = await this.invoices.submitMatch(id, user.id);
    return { success: true, data: await this.toEnrichedDto(queued) };
  }

  /**
   * Yash's hook from UI-B-05, step 2: route a MATCHED invoice for approval.
   * Moves MATCHED -> PENDING_APPROVAL and uses the WF-03 rules engine to
   * compute the approver chain.
   */
  @Post(':id/submit-approval')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.OK)
  async submitForApproval(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const queued = await this.invoices.submitForApproval(id, user.id);
    return { success: true, data: await this.toEnrichedDto(queued) };
  }

  @Post(':id/approve')
  @Roles(Role.PLANT_MANAGER, Role.FINANCE_DIRECTOR, Role.VP_FINANCE)
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.invoices.approve(id, user.id);
    return {
      success: true,
      data: {
        ...(await this.toEnrichedDto(result.invoice)),
        chainComplete: result.chainComplete,
        nextApproverId: result.nextApproverId,
      },
    };
  }

  @Post(':id/reject')
  @Roles(Role.PLANT_MANAGER, Role.FINANCE_DIRECTOR, Role.VP_FINANCE)
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.invoices.reject(id, user.id, dto.reason);
    return { success: true, data: await this.toEnrichedDto(updated) };
  }

  @Post(':id/flag-exception')
  @Roles(Role.AP_CLERK)
  @HttpCode(HttpStatus.OK)
  async flagException(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FlagExceptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.invoices.transition(id, InvoiceStatus.EXCEPTION, {
      performedBy: user.id,
      notes: dto.notes ?? `Exception flagged: ${dto.reasonCode}`,
      metadata: {
        reasonCode: dto.reasonCode,
        attachmentRef: dto.attachmentRef ?? null,
      },
    });
    return { success: true, data: await this.toEnrichedDto(updated) };
  }

  private toDto(
    invoice: Invoice,
    approvers?: Map<string, ApproverDetails>,
    predicted?: Map<string, Role[]>,
  ) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierName: invoice.supplierName,
      supplierId: invoice.supplierId,
      poNumber: invoice.poNumber,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
      status: invoice.status,
      previousStatus: invoice.previousStatus ?? null,
      // Stage the last exception cycle diverted from — anchors the stepper's
      // exception lane, surviving retrieval.
      exceptionFrom: invoice.exceptionFrom ?? null,
      ingestionChannel: invoice.ingestionChannel,
      plantId: invoice.plantId,
      currentApproverId: invoice.currentApproverId,
      approvalChain: invoice.approvalChain,
      // Display identities for the lifecycle stepper. Falls back to a
      // name-less entry when an id in the chain no longer matches a live user
      // (e.g. re-seeded users frozen into an old chain).
      approvalChainDetails: (invoice.approvalChain ?? []).map(
        (userId) =>
          approvers?.get(userId) ?? { userId, name: null, role: null },
      ),
      approvalsCompleted: invoice.approvalsCompleted,
      // Display identities for approvalsCompleted records — this is what
      // names the rejector after reject() nulls approvalChain.
      approvalsCompletedDetails: (invoice.approvalsCompleted ?? []).map(
        (record) =>
          approvers?.get(record.approverId) ?? {
            userId: record.approverId,
            name: null,
            role: null,
          },
      ),
      // Role chain the WF-03 rules would route this amount through — lets
      // the stepper show the full road ahead before submission.
      predictedRoleChain: predicted?.get(invoice.id) ?? [],
      rejectionReason: invoice.rejectionReason,
      pendingApprovalSince: invoice.pendingApprovalSince,
      lastEscalatedAt: invoice.lastEscalatedAt,
      createdAt: invoice.get('createdAt'),
      updatedAt: invoice.get('updatedAt'),
    };
  }

  /** toDto + users/rules lookups so approver stages carry names and roles. */
  private async toEnrichedDto(invoice: Invoice) {
    const [approvers, predicted] = await Promise.all([
      this.invoices.approverDetails([invoice]),
      this.invoices.predictedRoleChains([invoice]),
    ]);
    return this.toDto(invoice, approvers, predicted);
  }

  /** Render search results as CSV (PRD DAT-05 export). */
  private toCsv(invoices: import('./entities/invoice.entity').Invoice[]): string {
    const cols = [
      'id',
      'invoiceNumber',
      'supplierName',
      'supplierId',
      'poNumber',
      'totalAmount',
      'currency',
      'status',
      'ingestionChannel',
      'plantId',
      'createdAt',
    ] as const;
    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.join(',');
    const lines = invoices.map((invoice) => {
      const dto = this.toDto(invoice) as Record<string, unknown>;
      return cols.map((c) => esc(dto[c])).join(',');
    });
    return [header, ...lines].join('\n');
  }
}
