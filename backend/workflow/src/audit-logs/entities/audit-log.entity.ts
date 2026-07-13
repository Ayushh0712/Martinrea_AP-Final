import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

/**
 * Append-only audit log.
 *
 * Per PRD DAT-04 / WF acceptance criteria:
 *   "Audit_Logs table is append-only - no UPDATE or DELETE operations
 *    are permitted on this table."
 *
 * Enforcement plan:
 *   1. Sequelize-level: never expose update()/destroy() in the service.
 *   2. DB-level (production, owned by Roshni): a PostgreSQL trigger
 *      that raises an exception on UPDATE/DELETE attempts.
 */
@Table({
  tableName: 'audit_logs',
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class AuditLog extends Model<AuditLog> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare actionType: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare invoiceId: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare performedBy: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare oldValue: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare newValue: Record<string, unknown> | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare notes: string | null;
}
