import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Role } from '../../common/enums/role.enum';

/**
 * Approval routing rules per PRD WF-03.
 *
 *   "Rules are stored in a configurable Rules_Engine table - not
 *    hardcoded - so thresholds can be updated without code changes."
 *
 * Each row defines an amount band and the ordered chain of ROLES that
 * must approve invoices in that band. The actual approver USERS are
 * resolved at submit-match time based on plant_id (for Plant_Manager)
 * and "first active user with role" (for Finance_Director).
 *
 * Example seed (PRD Phase 1 defaults):
 *   Tier 1: 0       <= total <= 50_000   -> [PM]
 *   Tier 2: 50_000  <  total              -> [FD]
 */
@Table({
  tableName: 'approval_rules',
  timestamps: true,
  underscored: true,
})
export class ApprovalRule extends Model<ApprovalRule> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(60), allowNull: false, unique: true })
  declare ruleName: string;

  /** Inclusive lower bound. null = no lower bound. */
  @Column({ type: DataType.DECIMAL(14, 2), allowNull: true })
  declare minAmount: number | null;

  /** Inclusive upper bound. null = no upper bound (catch-all tier). */
  @Column({ type: DataType.DECIMAL(14, 2), allowNull: true })
  declare maxAmount: number | null;

  /** Ordered chain of roles. Stored as JSONB array of Role enum values. */
  @Column({ type: DataType.JSONB, allowNull: false })
  declare roleChain: Role[];

  /** Higher priority wins when multiple rules match. Lower priority numbers checked first. */
  @Default(100)
  @Column(DataType.INTEGER)
  declare priority: number;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare description: string | null;
}
