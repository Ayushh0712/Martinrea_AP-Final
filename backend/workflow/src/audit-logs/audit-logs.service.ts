import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { AuditLog } from './entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

export interface AuditLogInput {
  actionType: string;
  invoiceId?: string | null;
  performedBy?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  notes?: string | null;
}

/** Plain audit-log row enriched with the actor's display name (null = system). */
export type AuditLogEntry = Record<string, unknown> & {
  performedByName: string | null;
};

export interface PaginatedAuditLogs {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    @InjectModel(AuditLog) private readonly auditLogModel: typeof AuditLog,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  /**
   * Append-only insert. Never expose update() or destroy() on this model.
   *
   * Pass the caller's `transaction` when recording from inside a managed
   * transaction so the audit row uses the SAME connection (and commits
   * atomically) instead of acquiring a second pooled connection while the
   * transaction holds the first - that double-connection-per-write pattern
   * can starve the pool and intermittently fail state-changing requests.
   */
  async record(input: AuditLogInput, transaction?: Transaction): Promise<AuditLog> {
    const entry = await this.auditLogModel.create(
      {
        actionType: input.actionType,
        invoiceId: input.invoiceId ?? null,
        performedBy: input.performedBy ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        notes: input.notes ?? null,
      } as AuditLog,
      transaction ? { transaction } : undefined,
    );
    this.logger.debug(
      `Audit: ${input.actionType} by ${input.performedBy ?? 'system'}`,
    );
    return entry;
  }

  /**
   * Read-only, paginated query of the audit trail. This is a SELECT only -
   * it never mutates rows, preserving the append-only guarantee (DAT-04).
   * Optional filters (invoiceId, actionType, performedBy) combine with AND.
   * Newest first.
   */
  async findAll(query: QueryAuditLogsDto): Promise<PaginatedAuditLogs> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where: Record<string, unknown> = {};
    if (query.invoiceId) where.invoiceId = query.invoiceId;
    if (query.actionType) where.actionType = query.actionType;
    if (query.performedBy) where.performedBy = query.performedBy;

    const { rows, count } = await this.auditLogModel.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    const names = await this.resolvePerformerNames(rows);

    return {
      data: rows.map((row) => ({
        ...row.get({ plain: true }),
        performedByName: row.performedBy
          ? names.get(row.performedBy) ?? null
          : null,
      })),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    };
  }

  /**
   * Batch-resolve the distinct `performedBy` user ids on a page of rows to
   * display names, so the UI can show "Jane Doe" instead of a bare UUID.
   * `paranoid: false` keeps names resolvable on historical entries even after
   * the user is soft-deleted; unknown ids simply stay unresolved (null).
   */
  private async resolvePerformerNames(
    rows: AuditLog[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        rows
          .map((r) => r.performedBy)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
    if (ids.length === 0) return new Map();

    const users = await this.userModel.findAll({
      where: { id: ids },
      attributes: ['id', 'fullName', 'email'],
      paranoid: false,
    });
    return new Map(users.map((u) => [u.id, u.fullName || u.email]));
  }
}
