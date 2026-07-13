import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export enum DiscrepancySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum DiscrepancyType {
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  QUANTITY_MISMATCH = 'QUANTITY_MISMATCH',
  TAX_MISMATCH = 'TAX_MISMATCH',
  PRICE_MISMATCH = 'PRICE_MISMATCH',
  UNIT_PRICE_MISMATCH = 'UNIT_PRICE_MISMATCH',
  OTHER = 'OTHER',
}

/**
 * A single field-level discrepancy found within a match record (e.g. amount
 * or quantity mismatch). Unique per (match_record, field).
 */
@Table({
  tableName: 'match_discrepancies',
  timestamps: true,
  underscored: true,
})
export class MatchDiscrepancy extends Model<MatchDiscrepancy> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare matchRecordId: string;

  /** Optional line-level anchors; null = header-level discrepancy. */
  @Column({ type: DataType.UUID, allowNull: true })
  declare invoiceLineId: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare purchaseOrderLineId: string | null;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare fieldName: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare invoiceValue: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare poValue: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare grnValue: string | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare differenceAmount: number | null;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: true })
  declare differencePct: number | null;

  @Default(DiscrepancySeverity.MEDIUM)
  @Column({
    type: DataType.ENUM(...Object.values(DiscrepancySeverity)),
    allowNull: false,
  })
  declare severity: DiscrepancySeverity;

  @Default(DiscrepancyType.OTHER)
  @Column({
    type: DataType.ENUM(...Object.values(DiscrepancyType)),
    allowNull: false,
  })
  declare discrepancyType: DiscrepancyType;

  /** Whether this discrepancy blocks approval (hard fail vs advisory). */
  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare blocking: boolean;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare resolved: boolean;

  @Column({ type: DataType.DATE, allowNull: true })
  declare resolvedAt: Date | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare resolvedBy: string | null;

  @Column({ type: DataType.STRING(1000), allowNull: true })
  declare resolutionNote: string | null;
}
