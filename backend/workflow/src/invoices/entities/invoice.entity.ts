import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';
import { DocumentType } from '../../common/enums/document-type.enum';

/**
 * Invoice - workflow-service local view.
 *
 * The canonical Invoices schema is owned by Roshni (DAT-01). This entity
 * defines only the columns the workflow track needs to drive the state
 * machine, audit log, and approval routing. When Roshni publishes the
 * unified Flyway migration this entity must be reconciled with it.
 *
 * Columns directly tied to PRD requirements:
 *   - status              -> PRD Section 5.2 invoice lifecycle
 *   - approval_chain      -> PRD WF-03 (sequential routing - JSONB)
 *   - approvals_completed -> PRD WF-03 (history of approver actions)
 *   - current_approver_id -> PRD WF-03 / WF-05 (used by SLA escalation)
 */
@Table({
  tableName: 'invoices',
  timestamps: true,
  paranoid: true,
  underscored: true,
})
export class Invoice extends Model<Invoice> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  // Relaxed to nullable + non-unique so a file can be uploaded and stored
  // BEFORE OCR extraction fills in the number. Duplicate detection is done in
  // code (supplier + number), not via a DB UNIQUE constraint.
  @Column({ type: DataType.STRING(100), allowNull: true })
  declare invoiceNumber: string | null;

  // Relaxed to nullable for the same upload-before-extraction reason.
  @Column({ type: DataType.STRING(255), allowNull: true })
  declare supplierName: string | null;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare supplierId: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare poNumber: string | null;

  /** FK to the reserved/consumed PurchaseOrder (line-level 2-way matching). */
  @Column({ type: DataType.UUID, allowNull: true })
  declare purchaseOrderId: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare invoiceDate: Date | null;

  @Column({ type: DataType.DECIMAL(14, 2), allowNull: true })
  declare subtotal: number | null;

  @Column({ type: DataType.DECIMAL(14, 2), allowNull: true })
  declare taxAmount: number | null;

  @Column({ type: DataType.DECIMAL(14, 2), allowNull: true })
  declare discount: number | null;

  // Relaxed to nullable (default 0) so uploads persist before extraction.
  @Default(0)
  @Column({
    type: DataType.DECIMAL(14, 2),
    allowNull: true,
    get(this: Invoice): number {
      const raw = this.getDataValue('totalAmount');
      return raw === null || raw === undefined
        ? 0
        : parseFloat(raw as unknown as string);
    },
  })
  declare totalAmount: number;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare dueDate: string | null;

  // ---------------- OCR operational fields (merged from the ocr schema) ----
  @Column({ type: DataType.STRING(1000), allowNull: true })
  declare filePath: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare originalFilename: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare mimeType: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare fileSize: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare rawOcrText: string | null;

  @Column({ type: DataType.DECIMAL(5, 2), allowNull: true })
  declare confidenceScore: number | null;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare requiresReview: boolean;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare reviewReason: string | null;

  @Default(DocumentType.INVOICE)
  @Column({
    type: DataType.ENUM(...Object.values(DocumentType)),
    allowNull: false,
  })
  declare documentType: DocumentType;

  @Column({ type: DataType.STRING(10), allowNull: true })
  declare language: string | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare ocrRetryCount: number;

  @Column({ type: DataType.STRING(1000), allowNull: true })
  declare errorMessage: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare supplierTaxId: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare billToName: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare paymentTerm: string | null;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'USD' })
  declare currency: string;

  @Default(InvoiceStatus.RECEIVED)
  @Column({
    type: DataType.ENUM(...Object.values(InvoiceStatus)),
    allowNull: false,
  })
  declare status: InvoiceStatus;

  /**
   * The status held immediately before the current one. Drives the lifecycle
   * stepper UI: pins EXCEPTION to the stage it diverted from and marks a
   * PENDING_REVIEW that was retrieved from the exception queue. Stored as a
   * plain string (not a second pg enum type) so the dev-mode
   * `ADD COLUMN IF NOT EXISTS` self-heal in InvoicesService.onModuleInit
   * produces the same schema as a fresh sync(). Null for rows created before
   * this column existed or created directly at their status (OCR paths).
   */
  @Column({ type: DataType.STRING(40), allowNull: true })
  declare previousStatus: InvoiceStatus | null;

  /**
   * The stage held when the invoice last entered EXCEPTION. Overwritten on
   * each new exception cycle and never cleared, so the lifecycle stepper can
   * anchor the exception lane (divert stage -> Exception -> back to Review)
   * even after retrieval flips previousStatus to EXCEPTION. Plain string for
   * the same self-heal reason as previousStatus. Null for rows created
   * directly at EXCEPTION (OCR-validation rejects) or predating the column.
   */
  @Column({ type: DataType.STRING(40), allowNull: true })
  declare exceptionFrom: InvoiceStatus | null;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare ingestionChannel: string | null;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare plantId: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare currentApproverId: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare approvalChain: string[] | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare approvalsCompleted: Array<{
    approverId: string;
    decision: 'APPROVED' | 'REJECTED';
    timestamp: string;
    notes?: string;
  }> | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare rejectionReason: string | null;

  /**
   * Set by WF-05 escalation cron each time the invoice is escalated.
   * Prevents duplicate escalation emails on subsequent cron ticks.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare lastEscalatedAt: Date | null;

  /**
   * WF-05 escalation depth. 0 = not yet escalated; each SLA window the invoice
   * remains in PENDING_APPROVAL advances one hop up the org hierarchy
   * (current approver -> manager -> VP). Drives the progressive escalation
   * chain rather than a single manager notification.
   */
  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare escalationLevel: number;

  /** When the invoice entered PENDING_APPROVAL (for SLA windowing). */
  @Column({ type: DataType.DATE, allowNull: true })
  declare pendingApprovalSince: Date | null;
}
