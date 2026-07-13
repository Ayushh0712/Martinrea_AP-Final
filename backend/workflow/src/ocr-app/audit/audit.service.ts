import { Injectable, Logger } from '@nestjs/common';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuditAction } from './audit-action.enum';

export interface AuditPayload {
  invoiceId?: string | null;
  action: AuditAction;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  message?: string;
}

/**
 * Thin OCR-side wrapper over the unified Sequelize {@link AuditLogsService}.
 *
 * Keeps the historical `log({ invoiceId, action, oldValue, newValue, message })`
 * signature so no OCR caller needs to change, while writing rows into the same
 * append-only `audit_logs` table the rest of the workflow uses. The mapping is:
 *   action  -> actionType
 *   message -> notes
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly auditLogs: AuditLogsService) {}

  async log(payload: AuditPayload): Promise<void> {
    try {
      await this.auditLogs.record({
        actionType: payload.action,
        invoiceId: payload.invoiceId ?? null,
        oldValue: payload.oldValue ?? null,
        newValue: payload.newValue ?? null,
        notes: payload.message ?? null,
      });
      this.logger.debug(`Audit logged: ${payload.action} :: ${payload.message ?? ''}`);
    } catch (err) {
      this.logger.error(`Failed to write audit log for action=${payload.action}`, err as Error);
    }
  }

  async listForInvoice(invoiceId: string) {
    const { data } = await this.auditLogs.findAll({ invoiceId, page: 1, limit: 200 });
    return data;
  }
}
