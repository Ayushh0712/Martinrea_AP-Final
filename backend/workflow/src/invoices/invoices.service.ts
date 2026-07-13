import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, Sequelize, Transaction } from 'sequelize';
import { Invoice } from './entities/invoice.entity';
import { SearchInvoicesDto } from './dto/search-invoices.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceStateMachineService } from './state-machine/invoice-state-machine.service';
import { InvoiceStatus } from '../common/enums/invoice-status.enum';
import { PLANT_MANAGER_LIMIT_USD, Role } from '../common/enums/role.enum';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RulesEngineService } from '../rules-engine/rules-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { MatchService } from '../match-records/match.service';
import { MatchStatus } from '../match-records/entities/match-record.entity';
import { PurchaseOrderAllocationService } from '../purchase-orders/purchase-order-allocation.service';

export interface TransitionOptions {
  performedBy: string;
  notes?: string | null;
  rejectionReason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApproveResult {
  invoice: Invoice;
  chainComplete: boolean;
  nextApproverId: string | null;
}

/** Display identity of one approver in the chain (lifecycle stepper UI). */
export interface ApproverDetails {
  userId: string;
  name: string | null;
  role: Role | null;
}

@Injectable()
export class InvoicesService implements OnModuleInit {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectModel(Invoice) private readonly invoiceModel: typeof Invoice,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly stateMachine: InvoiceStateMachineService,
    private readonly audit: AuditLogsService,
    private readonly rules: RulesEngineService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly match: MatchService,
    private readonly allocation: PurchaseOrderAllocationService,
  ) {}

  /**
   * Dev-only schema self-heal: sequelize.sync() (no alter) only creates
   * missing tables — it never adds new columns to an existing one, so a dev
   * database created before the lifecycle columns (`previous_status`,
   * `exception_from`) existed would break every invoice SELECT. Adding them
   * idempotently here keeps old dev DBs working. Production schema is owned
   * by the Flyway migrations (DAT-01), so skip.
   */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'production') return;
    try {
      await this.sequelize.query(
        'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS previous_status VARCHAR(40);',
      );
      await this.sequelize.query(
        'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exception_from VARCHAR(40);',
      );
    } catch (err) {
      this.logger.warn(
        `lifecycle-columns self-heal skipped: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Batch-resolve the display identity (name + role) of every approver
   * referenced by the given invoices — approvalChain, approvalsCompleted and
   * currentApproverId — with a single users query. Used by the controller to
   * enrich DTOs so the lifecycle stepper can label approver stages
   * ("Plant Manager", "Finance Director") instead of raw UUIDs.
   */
  async approverDetails(
    invoices: Invoice[],
  ): Promise<Map<string, ApproverDetails>> {
    const ids = new Set<string>();
    for (const invoice of invoices) {
      for (const id of invoice.approvalChain ?? []) ids.add(id);
      for (const record of invoice.approvalsCompleted ?? []) {
        ids.add(record.approverId);
      }
      if (invoice.currentApproverId) ids.add(invoice.currentApproverId);
    }
    if (ids.size === 0) return new Map();

    const users = await this.users.findManyByIds([...ids]);
    const map = new Map<string, ApproverDetails>();
    for (const user of users) {
      map.set(user.id, { userId: user.id, name: user.fullName, role: user.role });
    }
    return map;
  }

  /**
   * Batch projection of the approval role chain each invoice's amount would
   * route through (WF-03 rules, display-only — no user resolution, no
   * routing). Keyed by invoice id; invoices whose amount matches no rule are
   * omitted. Lets the lifecycle stepper draw the full road ahead before
   * submit-approval freezes the real chain.
   */
  async predictedRoleChains(invoices: Invoice[]): Promise<Map<string, Role[]>> {
    if (invoices.length === 0) return new Map();
    const chains = await this.rules.predictRoleChains(
      invoices.map((invoice) => Number(invoice.totalAmount)),
    );
    const map = new Map<string, Role[]>();
    invoices.forEach((invoice, i) => {
      const chain = chains[i];
      if (chain && chain.length > 0) map.set(invoice.id, chain);
    });
    return map;
  }

  async create(dto: CreateInvoiceDto, performedBy: string): Promise<Invoice> {
    const invoice = await this.sequelize.transaction(async (tx) => {
      const created = await this.invoiceModel.create(
        {
          invoiceNumber: dto.invoiceNumber,
          supplierName: dto.supplierName,
          supplierId: dto.supplierId ?? null,
          poNumber: dto.poNumber ?? null,
          totalAmount: dto.totalAmount,
          currency: dto.currency ?? 'USD',
          ingestionChannel: dto.ingestionChannel ?? null,
          plantId: dto.plantId ?? null,
          status: InvoiceStatus.RECEIVED,
        } as Invoice,
        { transaction: tx },
      );

      await this.audit.record(
        {
          actionType: 'INVOICE_CREATED',
          invoiceId: created.id,
          performedBy,
          newValue: { status: created.status, invoiceNumber: created.invoiceNumber },
        },
        tx,
      );

      return created;
    });

    this.logger.log(
      `Invoice ${invoice.invoiceNumber} created (${invoice.id}) in status ${invoice.status}`,
    );
    return invoice;
  }

  async findById(id: string): Promise<Invoice> {
    const invoice = await this.invoiceModel.findByPk(id);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }

  /**
   * Paginated list of invoices for the workbench / dashboard grids.
   * Optional filters (status, plantId, currentApproverId, supplierId)
   * combine with AND. Newest first.
   */
  async findAll(query: QueryInvoicesDto): Promise<PaginatedResult<Invoice>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.plantId) where.plantId = query.plantId;
    if (query.currentApproverId) where.currentApproverId = query.currentApproverId;
    if (query.supplierId) where.supplierId = query.supplierId;

    const { rows, count } = await this.invoiceModel.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    // Correct-on-read (DISPLAY ONLY): when listing the approvals queue, resolve
    // any stranded approver chains to the live designated users so the UI
    // buckets ("Awaiting your approval" vs "Pending with other approvers") are
    // always correct. This mutates the DTO in memory but NEVER writes - a GET
    // must have no side-effects. approve/reject persist the same fix inside
    // their locked transaction (via reconcileApprover). Per-row try/catch so one
    // unresolvable invoice never breaks the whole list.
    if (query.status === InvoiceStatus.PENDING_APPROVAL && rows.length) {
      for (const row of rows) {
        try {
          const resolved = await this.resolveDesiredApprover(row);
          if (resolved) {
            row.approvalChain = resolved.userChain;
            row.currentApproverId = resolved.desiredApproverId;
          }
        } catch (err) {
          this.logger.warn(
            `Approver display-reconcile failed for invoice ${row.id}: ${(err as Error).message}`,
          );
        }
      }
    }

    return {
      data: rows,
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    };
  }

  getAllowedTransitions(from: InvoiceStatus): InvoiceStatus[] {
    return this.stateMachine.getAllowedTransitions(from);
  }

  /**
   * PRD DAT-05 advanced search. Filters combine with AND across: date range
   * (created_at), supplier name/id, PO number, invoice number, status, amount
   * range and ingestion channel. Supports sorting + pagination. The caller
   * (controller) handles CSV vs JSON rendering.
   */
  async search(dto: SearchInvoicesDto): Promise<PaginatedResult<Invoice>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const and: any[] = [];

    if (dto.status) {
      and.push({ status: dto.status });
    } else if (dto.statusGroup) {
      // UI-A-02 dashboard grouping: open = still in pipeline, closed = terminal.
      const terminal = [InvoiceStatus.APPROVED, InvoiceStatus.REJECTED];
      and.push({
        status: dto.statusGroup === 'closed' ? { [Op.in]: terminal } : { [Op.notIn]: terminal },
      });
    }
    // UI-A-02 global keyword: OR across the human-searchable identifiers.
    if (dto.q && dto.q.trim()) {
      const term = `%${dto.q.trim()}%`;
      and.push({
        [Op.or]: [
          { invoiceNumber: { [Op.iLike]: term } },
          { supplierName: { [Op.iLike]: term } },
          { poNumber: { [Op.iLike]: term } },
          { supplierId: { [Op.iLike]: term } },
        ],
      });
    }
    if (dto.supplierId) and.push({ supplierId: dto.supplierId });
    if (dto.poNumber) and.push({ poNumber: { [Op.iLike]: `%${dto.poNumber}%` } });
    if (dto.invoiceNumber) {
      and.push({ invoiceNumber: { [Op.iLike]: `%${dto.invoiceNumber}%` } });
    }
    if (dto.supplierName) {
      and.push({ supplierName: { [Op.iLike]: `%${dto.supplierName}%` } });
    }
    if (dto.ingestionChannel) {
      and.push({ ingestionChannel: dto.ingestionChannel });
    }

    if (dto.dateFrom || dto.dateTo) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const range: any = {};
      if (dto.dateFrom) range[Op.gte] = new Date(dto.dateFrom);
      if (dto.dateTo) range[Op.lte] = new Date(`${dto.dateTo}T23:59:59.999Z`);
      and.push({ createdAt: range });
    }
    if (dto.amountMin !== undefined || dto.amountMax !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const range: any = {};
      if (dto.amountMin !== undefined) range[Op.gte] = dto.amountMin;
      if (dto.amountMax !== undefined) range[Op.lte] = dto.amountMax;
      and.push({ totalAmount: range });
    }

    const sortBy = dto.sortBy ?? 'createdAt';
    const sortDir = (dto.sortDir ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const { rows, count } = await this.invoiceModel.findAndCountAll({
      where: and.length ? { [Op.and]: and } : {},
      order: [[sortBy, sortDir]],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      data: rows,
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    };
  }

  /**
   * PRD DAT-03: edit invoice fields (status excluded - that goes through the
   * state machine). Audited as INVOICE_UPDATED with old/new values.
   */
  async update(
    id: string,
    dto: UpdateInvoiceDto,
    performedBy: string,
  ): Promise<Invoice> {
    return this.sequelize.transaction(async (tx) => {
      const invoice = await this.invoiceModel.findByPk(id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }

      const before = {
        invoiceNumber: invoice.invoiceNumber,
        supplierName: invoice.supplierName,
        supplierId: invoice.supplierId,
        poNumber: invoice.poNumber,
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
        ingestionChannel: invoice.ingestionChannel,
        plantId: invoice.plantId,
      };

      if (dto.invoiceNumber !== undefined) invoice.invoiceNumber = dto.invoiceNumber;
      if (dto.supplierName !== undefined) invoice.supplierName = dto.supplierName;
      if (dto.supplierId !== undefined) invoice.supplierId = dto.supplierId;
      if (dto.poNumber !== undefined) invoice.poNumber = dto.poNumber;
      if (dto.totalAmount !== undefined) invoice.totalAmount = dto.totalAmount;
      if (dto.currency !== undefined) invoice.currency = dto.currency;
      if (dto.ingestionChannel !== undefined) {
        invoice.ingestionChannel = dto.ingestionChannel;
      }
      if (dto.plantId !== undefined) invoice.plantId = dto.plantId;

      await invoice.save({ transaction: tx });

      await this.audit.record(
        {
          actionType: 'INVOICE_UPDATED',
          invoiceId: invoice.id,
          performedBy,
          oldValue: before,
          newValue: { ...dto },
        },
        tx,
      );

      return invoice;
    });
  }

  /**
   * PRD DAT-03: soft delete (paranoid). The row stays for the audit window;
   * normal reads exclude it. Audited as INVOICE_DELETED.
   */
  async softDelete(id: string, performedBy: string): Promise<void> {
    const invoice = await this.invoiceModel.findByPk(id);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    await invoice.destroy();
    await this.audit.record({
      actionType: 'INVOICE_DELETED',
      invoiceId: id,
      performedBy,
      oldValue: { status: invoice.status, invoiceNumber: invoice.invoiceNumber },
    });
  }

  /**
   * Direct state transition (used by ops, tests, and the /transitions
   * endpoint). Does not compute an approval chain; for that use
   * `submitForApproval`.
   */
  async transition(
    id: string,
    to: InvoiceStatus,
    opts: TransitionOptions,
  ): Promise<Invoice> {
    return this.sequelize.transaction(async (tx: Transaction) => {
      const invoice = await this.invoiceModel.findByPk(id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }

      const from = invoice.status;

      this.stateMachine.assertTransition(from, to);

      invoice.previousStatus = from;
      // Remember where this exception cycle diverted from (kept after
      // retrieval so the stepper's exception lane stays anchored; overwritten
      // by the next cycle).
      if (to === InvoiceStatus.EXCEPTION) {
        invoice.exceptionFrom = from;
      }
      invoice.status = to;

      if (to === InvoiceStatus.REJECTED) {
        if (!opts.rejectionReason) {
          throw new ConflictException(
            'A rejectionReason is required when moving to REJECTED',
          );
        }
        invoice.rejectionReason = opts.rejectionReason;
      } else if (
        from === InvoiceStatus.REJECTED &&
        to === InvoiceStatus.PENDING_REVIEW
      ) {
        invoice.rejectionReason = null;
      }

      // Break-glass parity with the normal approve/reject paths: a forced
      // transition out of PENDING_APPROVAL must settle the PO draw-down and
      // clear the live-approver pointer, otherwise the reservation is stranded
      // in RESERVED forever. consume/release act only on RESERVED rows, so
      // invoices without a reservation (e.g. no PO) safely no-op.
      if (to === InvoiceStatus.APPROVED) {
        await this.allocation.consume(invoice.id, tx);
        invoice.currentApproverId = null;
        invoice.pendingApprovalSince = null;
      } else if (to === InvoiceStatus.REJECTED) {
        await this.allocation.release(invoice.id, tx);
        invoice.currentApproverId = null;
        invoice.pendingApprovalSince = null;
        invoice.approvalChain = null;
      }

      await invoice.save({ transaction: tx });

      await this.audit.record(
        {
          actionType: 'INVOICE_STATE_TRANSITION',
          invoiceId: invoice.id,
          performedBy: opts.performedBy,
          oldValue: { status: from },
          newValue: {
            status: to,
            ...(opts.metadata ?? {}),
            ...(opts.rejectionReason ? { rejectionReason: opts.rejectionReason } : {}),
          },
          notes: opts.notes ?? null,
        },
        tx,
      );

      this.logger.log(
        `Invoice ${invoice.invoiceNumber} (${invoice.id}): ${from} -> ${to} by ${opts.performedBy}`,
      );

      return invoice;
    });
  }

  /**
   * Yash's UI-B-05 hook, step 1 of 2: the authoritative 2-way match.
   *
   * Runs the server-side match gate and, when it passes, transitions
   * PENDING_MATCH -> MATCHED. The invoice RESTS in MATCHED; routing into the
   * approval chain is a separate, explicit action (`submitForApproval`) so the
   * lifecycle visibly passes through MATCHED.
   *
   * Blocking discrepancies return 409 and the invoice stays in PENDING_MATCH so
   * the clerk can fix the issue or flag an exception. (Other states fall through
   * to transition() below, which raises the canonical state-machine 409.)
   */
  async submitMatch(id: string, performedBy: string): Promise<Invoice> {
    // The match verdict, the PO draw-down reservation, and the MATCHED
    // transition all run in ONE transaction: the PO lines are read FOR UPDATE
    // inside verifyAndRecord, so the availability check and the reserve that
    // acts on it cannot be raced by a concurrent invoice on the same PO.
    const outcome = await this.sequelize.transaction(async (tx) => {
      const invoice = await this.invoiceModel.findByPk(id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      // Only PENDING_MATCH is matchable. For any other state, raise the
      // canonical state-machine 409 (MATCHED is only reachable from
      // PENDING_MATCH, so this always throws for other states).
      if (invoice.status !== InvoiceStatus.PENDING_MATCH) {
        this.stateMachine.assertTransition(
          invoice.status,
          InvoiceStatus.MATCHED,
        );
      }

      const matchResult = await this.match.verifyAndRecord(
        invoice,
        performedBy,
        tx,
      );

      if (matchResult.matchStatus !== MatchStatus.MATCHED) {
        // Do NOT throw inside the transaction - that would roll back the
        // recorded verdict + discrepancies + audit entry. Commit them and
        // signal the caller to raise the 409 after the transaction closes.
        return { matched: false as const, matchResult, invoice };
      }

      // Validate the transition BEFORE mutating any PO state.
      this.stateMachine.assertTransition(invoice.status, InvoiceStatus.MATCHED);

      // Reserve the PO draw-down for the matched lines, then advance to MATCHED.
      await this.allocation.reserve(
        invoice.id,
        matchResult.lineAllocations,
        tx,
      );

      invoice.previousStatus = invoice.status;
      invoice.status = InvoiceStatus.MATCHED;
      await invoice.save({ transaction: tx });

      await this.audit.record(
        {
          actionType: 'INVOICE_STATE_TRANSITION',
          invoiceId: invoice.id,
          performedBy,
          oldValue: { status: InvoiceStatus.PENDING_MATCH },
          newValue: {
            status: InvoiceStatus.MATCHED,
            reservedLines: matchResult.lineAllocations.length,
          },
          notes: '2-way line-level match verified - PO draw-down reserved',
        },
        tx,
      );

      return { matched: true as const, matchResult, invoice };
    });

    if (!outcome.matched) {
      const count = outcome.matchResult.blockingDiscrepancies.length;
      const reasons = outcome.matchResult.blockingDiscrepancies
        .map((d) => d.message)
        .join(' ');
      throw new ConflictException(
        `Invoice cannot be matched: 2-way match failed with ` +
          `${count} blocking discrepanc${count === 1 ? 'y' : 'ies'}. ${reasons} ` +
          `Resolve the discrepancies or flag an exception.`,
      );
    }

    this.logger.log(
      `Invoice ${outcome.invoice.invoiceNumber} (${outcome.invoice.id}) ` +
        `2-way matched -> MATCHED (PO draw-down reserved)`,
    );
    return outcome.invoice;
  }

  /**
   * Yash's UI-B-05 hook, step 2 of 2: route a MATCHED invoice for approval.
   * PRD WF-03 routing logic happens here.
   *
   * 1. Compute approval chain from Rules_Engine (amount + plantId).
   * 2. Transition MATCHED -> PENDING_APPROVAL and assign currentApproverId.
   * 3. Notify the first approver (WF-04).
   *
   * The invoice must already be in MATCHED; any other state raises the
   * canonical state-machine 409 via assertTransition below.
   */
  async submitForApproval(id: string, performedBy: string): Promise<Invoice> {
    const invoiceForChain = await this.findById(id);
    const chain = await this.rules.computeApprovalChain(
      invoiceForChain.totalAmount,
      invoiceForChain.plantId,
    );

    const updated = await this.sequelize.transaction(async (tx) => {
      const invoice = await this.invoiceModel.findByPk(id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }

      this.stateMachine.assertTransition(
        invoice.status,
        InvoiceStatus.PENDING_APPROVAL,
      );

      invoice.previousStatus = invoice.status;
      invoice.status = InvoiceStatus.PENDING_APPROVAL;
      invoice.approvalChain = chain.userChain;
      invoice.currentApproverId = chain.userChain[0];
      invoice.approvalsCompleted = [];
      invoice.pendingApprovalSince = new Date();
      invoice.lastEscalatedAt = null;
      invoice.escalationLevel = 0;

      await invoice.save({ transaction: tx });

      await this.audit.record(
        {
          actionType: 'INVOICE_STATE_TRANSITION',
          invoiceId: invoice.id,
          performedBy,
          oldValue: { status: InvoiceStatus.MATCHED },
          newValue: {
            status: InvoiceStatus.PENDING_APPROVAL,
            rule: chain.rule.name,
            roleChain: chain.roleChain,
            userChain: chain.userChain,
          },
          notes: `Routed via rule '${chain.rule.name}'`,
        },
        tx,
      );

      return invoice;
    });

    // Post-commit side effect: fire-and-forget so a slow/failing SMTP can never
    // turn a committed routing into a 500 (notifyApprover handles its own errors).
    void this.notifyApprover(updated, /* isEscalation */ false);
    return updated;
  }

  /**
   * Read-only computation of the CURRENT designated approver for a
   * PENDING_APPROVAL invoice, re-resolved against the LIVE rules + users. This
   * performs NO writes - it is shared by the persisting `reconcileApprover`
   * (which saves + audits any drift) and by the list path (which applies the
   * result to the DTO in memory only, so a GET never mutates the database).
   *
   * @returns the live chain + designated approver for the current step, or
   *   null when the invoice is not PENDING_APPROVAL, the routing rules cannot
   *   be resolved, or every step is already complete.
   */
  private async resolveDesiredApprover(invoice: Invoice): Promise<{
    userChain: string[];
    roleChain: Role[];
    ruleName: string;
    stepIndex: number;
    desiredApproverId: string;
  } | null> {
    if (invoice.status !== InvoiceStatus.PENDING_APPROVAL) {
      return null;
    }

    let userChain: string[];
    let roleChain: Role[];
    let ruleName: string;
    try {
      const chain = await this.rules.computeApprovalChain(
        invoice.totalAmount,
        invoice.plantId,
      );
      userChain = chain.userChain;
      roleChain = chain.roleChain;
      ruleName = chain.rule.name;
    } catch (err) {
      this.logger.warn(
        `Approver reconcile skipped for invoice ${invoice.id}: ${(err as Error).message}`,
      );
      return null;
    }

    // The current step is however many approvals are already recorded. Guard
    // against a chain that somehow has fewer steps than completed approvals.
    const stepIndex = invoice.approvalsCompleted?.length ?? 0;
    if (stepIndex >= userChain.length) {
      return null;
    }

    return {
      userChain,
      roleChain,
      ruleName,
      stepIndex,
      desiredApproverId: userChain[stepIndex],
    };
  }

  /**
   * Re-resolve a PENDING_APPROVAL invoice's stored approver chain against the
   * LIVE rules + users so it can never get stranded on a stale user id, and
   * PERSIST the correction (save + audit) when it has drifted.
   *
   * Background: submitForApproval freezes concrete user ids into
   * current_approver_id / approval_chain. If a user row is later replaced
   * (re-seed with a new UUID, soft-delete, etc.) the invoice points at an id
   * that no live login matches - it falls into "other approvers" for everyone
   * and can be neither approved nor rejected. This recomputes the designated
   * approver for the CURRENT step (preserving completed approvals) and corrects
   * the stored ids in place when they have drifted.
   *
   * Best-effort and non-throwing: a resolution failure (e.g. no active user for
   * a required role) is logged and leaves the invoice untouched so callers
   * surface their own normal errors.
   *
   * @returns true when the invoice's approver chain was corrected.
   */
  async reconcileApprover(
    invoice: Invoice,
    tx: Transaction,
    performedBy?: string | null,
  ): Promise<boolean> {
    const resolved = await this.resolveDesiredApprover(invoice);
    if (!resolved) {
      return false;
    }
    const { userChain, roleChain, ruleName, stepIndex } = resolved;
    const desired = resolved.desiredApproverId;

    const chainDrifted =
      JSON.stringify(invoice.approvalChain ?? []) !== JSON.stringify(userChain);
    const approverDrifted = invoice.currentApproverId !== desired;
    if (!chainDrifted && !approverDrifted) {
      return false;
    }

    const previous = {
      currentApproverId: invoice.currentApproverId,
      approvalChain: invoice.approvalChain,
    };

    invoice.approvalChain = userChain;
    invoice.currentApproverId = desired;
    await invoice.save({ transaction: tx });

    await this.audit.record(
      {
        actionType: 'APPROVER_RECONCILED',
        invoiceId: invoice.id,
        performedBy: performedBy ?? null,
        oldValue: previous,
        newValue: {
          currentApproverId: desired,
          approvalChain: userChain,
          rule: ruleName,
          roleChain,
          stepIndex,
        },
        notes: `Approver chain re-resolved to live designated user(s) for rule '${ruleName}'`,
      },
      tx,
    );

    this.logger.log(
      `Invoice ${invoice.invoiceNumber}: approver chain reconciled ` +
        `(${previous.currentApproverId ?? 'none'} -> ${desired})`,
    );
    return true;
  }

  /**
   * Reconcile a single invoice by id inside its own locked transaction. Used by
   * the list path (self-heal on read) where there is no ambient transaction.
   */
  async reconcileApproverById(id: string): Promise<Invoice | null> {
    return this.sequelize.transaction(async (tx) => {
      const invoice = await this.invoiceModel.findByPk(id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!invoice) {
        return null;
      }
      await this.reconcileApprover(invoice, tx);
      return invoice;
    });
  }

  /**
   * Single approval step. Records the current approver's decision and
   * either advances to the next approver in the chain (status stays
   * PENDING_APPROVAL) or transitions the invoice to APPROVED when the
   * chain is exhausted.
   *
   * Per PRD WF-01 + WF-03:
   *   - @Roles guard at the controller blocks AP_Clerk (403).
   *   - This method additionally enforces segregation of duties: only
   *     the user matching invoice.current_approver_id may approve.
   */
  async approve(
    id: string,
    approverId: string,
    notes?: string,
  ): Promise<ApproveResult> {
    const result = await this.sequelize.transaction(async (tx) => {
      const invoice = await this.invoiceModel.findByPk(id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      if (invoice.status !== InvoiceStatus.PENDING_APPROVAL) {
        throw new ConflictException(
          `Invoice is in status ${invoice.status}, not PENDING_APPROVAL`,
        );
      }
      // Re-resolve a possibly-stranded chain to the live designated users first,
      // so the segregation-of-duties check below compares against the current
      // approver and never blocks the legitimate authority on a stale id.
      await this.reconcileApprover(invoice, tx, approverId);
      if (invoice.currentApproverId !== approverId) {
        throw new ForbiddenException(
          'You are not the current required approver for this invoice (segregation of duties).',
        );
      }

      const chain = invoice.approvalChain ?? [];
      const idx = chain.indexOf(approverId);
      const nextApproverId = idx >= 0 && idx + 1 < chain.length ? chain[idx + 1] : null;
      const chainComplete = nextApproverId === null;

      // PRD WF-01 + WF-03: a Plant_Manager is capped at $50,000 only as the
      // FINAL authoriser. For >$50k invoices the rules engine routes
      // PM -> FD -> VP, where the PM step is an intermediate plant-level
      // sign-off (FD/VP carry the higher dollar authority). Blocking the PM
      // outright would deadlock every Tier-3 chain at its first step, so only
      // reject a PM whose approval would COMPLETE the chain above the cap.
      const approver = await this.users.findById(approverId);
      if (
        approver.role === Role.PLANT_MANAGER &&
        chainComplete &&
        Number(invoice.totalAmount ?? 0) > PLANT_MANAGER_LIMIT_USD
      ) {
        throw new ForbiddenException(
          `Plant_Manager approval limit is $${PLANT_MANAGER_LIMIT_USD.toLocaleString()}. ` +
            `Invoice total $${Number(invoice.totalAmount ?? 0).toLocaleString()} requires Finance Director approval.`,
        );
      }

      const completed = [...(invoice.approvalsCompleted ?? [])];
      completed.push({
        approverId,
        decision: 'APPROVED',
        timestamp: new Date().toISOString(),
        notes,
      });

      invoice.approvalsCompleted = completed;
      invoice.currentApproverId = nextApproverId;
      // Restart the SLA window + escalation chain for the next approver.
      invoice.pendingApprovalSince = chainComplete ? null : new Date();
      invoice.lastEscalatedAt = null;
      invoice.escalationLevel = 0;

      if (chainComplete) {
        this.stateMachine.assertTransition(
          invoice.status,
          InvoiceStatus.APPROVED,
        );
        invoice.previousStatus = invoice.status;
        invoice.status = InvoiceStatus.APPROVED;
      }

      await invoice.save({ transaction: tx });

      // Final approval keeps the PO draw-down: move the invoice's RESERVED
      // quantity/amount to CONSUMED (the .md's "keep updated PO values").
      if (chainComplete) {
        await this.allocation.consume(invoice.id, tx);
      }

      await this.audit.record(
        {
          actionType: chainComplete
            ? 'INVOICE_STATE_TRANSITION'
            : 'INVOICE_APPROVAL_STEP',
          invoiceId: invoice.id,
          performedBy: approverId,
          oldValue: chainComplete ? { status: InvoiceStatus.PENDING_APPROVAL } : null,
          newValue: chainComplete
            ? { status: InvoiceStatus.APPROVED, approvals: completed }
            : { advancedTo: nextApproverId, approvals: completed },
          notes: notes ?? null,
        },
        tx,
      );

      return { invoice, chainComplete, nextApproverId };
    });

    // Post-commit side effect: fire-and-forget so a slow/failing SMTP can never
    // turn a recorded approval into a 500 (notifyApprover handles its own errors).
    if (!result.chainComplete && result.nextApproverId) {
      void this.notifyApprover(result.invoice, /* isEscalation */ false);
    }

    this.logger.log(
      `Invoice ${result.invoice.invoiceNumber}: approval step by ${approverId} - ` +
        (result.chainComplete
          ? 'CHAIN COMPLETE -> APPROVED'
          : `advancing to ${result.nextApproverId}`),
    );

    return result;
  }

  /**
   * Reject - only the CURRENT required approver may reject (segregation of
   * duties, symmetric with `approve`). A prior approver who already signed off
   * and handed the invoice on can no longer pull it back.
   *
   * PRD WF-03: "Rejected invoices return to Pending_Review status with the
   * rejection reason visible to AP_Clerk." We therefore walk the invoice back
   * through the state machine (PENDING_APPROVAL -> REJECTED -> PENDING_REVIEW)
   * and land it in PENDING_REVIEW, keeping `rejectionReason` populated so the
   * clerk can see why it was bounced, fix it, and resubmit through the chain.
   */
  async reject(id: string, approverId: string, reason: string): Promise<Invoice> {
    const updated = await this.sequelize.transaction(async (tx) => {
      const invoice = await this.invoiceModel.findByPk(id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      if (invoice.status !== InvoiceStatus.PENDING_APPROVAL) {
        throw new ConflictException(
          `Invoice is in status ${invoice.status}, not PENDING_APPROVAL`,
        );
      }
      // Re-resolve a possibly-stranded chain to the live designated users first,
      // so the segregation-of-duties check below compares against the current
      // approver and never blocks the legitimate authority on a stale id.
      await this.reconcileApprover(invoice, tx, approverId);
      if (invoice.currentApproverId !== approverId) {
        throw new ForbiddenException(
          'You are not the current required approver for this invoice (segregation of duties).',
        );
      }

      const completed = [...(invoice.approvalsCompleted ?? [])];
      completed.push({
        approverId,
        decision: 'REJECTED',
        timestamp: new Date().toISOString(),
        notes: reason,
      });

      // Validate both legs of the rejection path against the state machine so
      // the lifecycle rules stay authoritative (PENDING_APPROVAL is only
      // permitted to reach PENDING_REVIEW via REJECTED).
      this.stateMachine.assertTransition(invoice.status, InvoiceStatus.REJECTED);
      this.stateMachine.assertTransition(
        InvoiceStatus.REJECTED,
        InvoiceStatus.PENDING_REVIEW,
      );

      invoice.previousStatus = invoice.status;
      invoice.status = InvoiceStatus.PENDING_REVIEW;
      invoice.rejectionReason = reason;
      invoice.approvalsCompleted = completed;
      invoice.currentApproverId = null;
      invoice.approvalChain = null;
      invoice.pendingApprovalSince = null;
      invoice.lastEscalatedAt = null;

      await invoice.save({ transaction: tx });

      // Rejection reverts every PO change made during matching: release the
      // invoice's RESERVED draw-down back to the PO's remaining quantity/amount.
      await this.allocation.release(invoice.id, tx);

      await this.audit.record(
        {
          actionType: 'INVOICE_STATE_TRANSITION',
          invoiceId: invoice.id,
          performedBy: approverId,
          oldValue: { status: InvoiceStatus.PENDING_APPROVAL },
          newValue: {
            status: InvoiceStatus.PENDING_REVIEW,
            rejectionReason: reason,
            rejectedBy: approverId,
          },
          notes: reason,
        },
        tx,
      );

      return invoice;
    });

    this.logger.log(
      `Invoice ${updated.invoiceNumber} REJECTED by ${approverId} -> returned to PENDING_REVIEW: ${reason}`,
    );
    return updated;
  }

  /**
   * Sends WF-04 notification to invoice.currentApproverId.
   * Used by submitMatch, approve (next step), and the WF-05 escalation cron.
   */
  async notifyApprover(invoice: Invoice, isEscalation: boolean): Promise<void> {
    if (!invoice.currentApproverId) {
      return;
    }
    try {
      const approver = await this.users.findById(invoice.currentApproverId);
      await this.notifications.sendApprovalRequired({
        to: approver.email,
        approverName: approver.fullName,
        invoiceNumber: invoice.invoiceNumber ?? '',
        supplierName: invoice.supplierName ?? '',
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
        invoiceId: invoice.id,
        isEscalation,
      });
    } catch (err) {
      // Email delivery failures should not break the workflow; log and continue.
      this.logger.warn(
        `Failed to notify ${invoice.currentApproverId} for invoice ${invoice.id}: ${(err as Error).message}`,
      );
    }
  }
}
