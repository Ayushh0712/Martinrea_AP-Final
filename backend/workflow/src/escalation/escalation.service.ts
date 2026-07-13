import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../common/enums/invoice-status.enum';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * WF-05 - SLA escalation cron.
 *
 * Runs hourly (configurable via ESCALATION_CRON). Finds invoices stuck in
 * PENDING_APPROVAL longer than SLA_PENDING_APPROVAL_HOURS (default 48 per
 * PRD WF-05) and escalates PROGRESSIVELY up the org hierarchy:
 *   - 1st breach window  -> current approver's manager
 *   - 2nd breach window  -> manager's manager (e.g. VP)
 *   - subsequent windows -> capped at the top of the hierarchy
 * Each pass:
 *   1. Re-notifies the current approver and emails the next escalation target.
 *   2. Logs an SLA_BREACH event (with escalation level + target) to Audit_Logs.
 *   3. Advances escalation_level and stamps last_escalated_at so the next cron
 *      tick doesn't re-send until another full SLA window passes.
 *
 * PRD WF-05 max chain: current approver -> manager -> VP (org hierarchy table,
 * modelled by users.manager_id).
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    @InjectModel(Invoice) private readonly invoiceModel: typeof Invoice,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  // Cadence is env-driven (ESCALATION_CRON) per PRD WF-05; defaults to hourly.
  @Cron(process.env.ESCALATION_CRON || CronExpression.EVERY_HOUR, {
    name: 'sla-escalation',
  })
  async runHourly(): Promise<void> {
    await this.runOnce();
  }

  /** Public so tests and ops endpoints can invoke a single pass. */
  async runOnce(): Promise<{ checked: number; escalated: number }> {
    const slaHours =
      this.config.get<number>('workflow.slaPendingApprovalHours') ?? 48;
    const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000);

    const breached = await this.invoiceModel.findAll({
      where: {
        status: InvoiceStatus.PENDING_APPROVAL,
        pendingApprovalSince: { [Op.lt]: cutoff },
        [Op.or]: [
          { lastEscalatedAt: null },
          { lastEscalatedAt: { [Op.lt]: cutoff } },
        ],
      },
    });

    this.logger.log(
      `SLA cron: cutoff=${cutoff.toISOString()} candidates=${breached.length}`,
    );

    let escalated = 0;
    for (const invoice of breached) {
      try {
        await this.escalateOne(invoice, slaHours);
        escalated++;
      } catch (err) {
        this.logger.error(
          `Escalation failed for invoice ${invoice.id}: ${(err as Error).message}`,
        );
      }
    }

    return { checked: breached.length, escalated };
  }

  private async escalateOne(invoice: Invoice, slaHours: number): Promise<void> {
    if (!invoice.currentApproverId) {
      return;
    }
    const approver = await this.users.findById(invoice.currentApproverId);

    // Progressive escalation: advance one hop up the manager chain per breach
    // window. Level 1 -> manager, level 2 -> manager's manager (VP), etc.
    const targetLevel = (invoice.escalationLevel ?? 0) + 1;
    const target = await this.walkManagerChain(approver, targetLevel);
    const reachedLevel = target.hops; // capped at top of hierarchy

    // Always re-notify the current approver so the invoice stays on their radar.
    await this.notifications.sendApprovalRequired({
      to: approver.email,
      approverName: approver.fullName,
      invoiceNumber: invoice.invoiceNumber ?? '',
      supplierName: invoice.supplierName ?? '',
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
      invoiceId: invoice.id,
      isEscalation: true,
    });

    // Notify the escalation target (next person up the chain), if any.
    if (target.user) {
      await this.notifications.sendApprovalRequired({
        to: target.user.email,
        approverName: target.user.fullName,
        invoiceNumber: invoice.invoiceNumber ?? '',
        supplierName: invoice.supplierName ?? '',
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
        invoiceId: invoice.id,
        isEscalation: true,
      });
    }

    invoice.lastEscalatedAt = new Date();
    invoice.escalationLevel = Math.max(reachedLevel, invoice.escalationLevel ?? 0);
    await invoice.save();

    await this.audit.record({
      actionType: 'SLA_BREACH',
      invoiceId: invoice.id,
      performedBy: null,
      newValue: {
        slaHours,
        escalationLevel: invoice.escalationLevel,
        approverId: approver.id,
        approverEmail: approver.email,
        escalatedTo: target.user?.id ?? null,
        escalatedToEmail: target.user?.email ?? null,
        atTopOfHierarchy: target.atTop,
        pendingApprovalSince: invoice.pendingApprovalSince?.toISOString() ?? null,
      },
      notes: target.user
        ? `SLA escalation level ${invoice.escalationLevel} -> ${target.user.email}`
        : 'SLA escalation: top of approval hierarchy reached (no higher manager)',
    });

    this.logger.log(
      `SLA_BREACH: invoice ${invoice.invoiceNumber} escalation level ${invoice.escalationLevel} ` +
        `-> ${target.user?.email ?? '(top of hierarchy)'}`,
    );
  }

  /**
   * Walk up the `manager_id` chain from `start` by up to `hops` levels.
   * Returns the user reached (or null if `start` has no manager at all), how
   * many hops were actually taken (capped at the top of the hierarchy), and
   * whether the top was reached.
   */
  private async walkManagerChain(
    start: { managerId: string | null },
    hops: number,
  ): Promise<{
    user: Awaited<ReturnType<UsersService['findById']>> | null;
    hops: number;
    atTop: boolean;
  }> {
    let current: { managerId: string | null } = start;
    let reached: Awaited<ReturnType<UsersService['findById']>> | null = null;
    let taken = 0;
    for (let i = 0; i < hops; i++) {
      if (!current.managerId) {
        return { user: reached, hops: taken, atTop: true };
      }
      reached = await this.users.findById(current.managerId);
      current = reached;
      taken += 1;
    }
    return { user: reached, hops: taken, atTop: !current.managerId };
  }
}
