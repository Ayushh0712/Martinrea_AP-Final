import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export enum MatchType {
  TWO_WAY = 'TWO_WAY',
  THREE_WAY = 'THREE_WAY',
}

export enum MatchStatus {
  PENDING = 'PENDING',
  MATCHED = 'MATCHED',
  PARTIAL_MATCH = 'PARTIAL_MATCH',
  EXCEPTION = 'EXCEPTION',
}

/**
 * Result of a 2-way / 3-way match between an invoice, its PO and (optionally)
 * its goods receipt. One record per invoice.
 */
@Table({
  tableName: 'match_records',
  timestamps: true,
  underscored: true,
})
export class MatchRecord extends Model<MatchRecord> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  declare invoiceId: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare poId: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare grnId: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare matchedByUser: string | null;

  @Column({ type: DataType.ENUM(...Object.values(MatchType)), allowNull: false })
  declare matchType: MatchType;

  @Default(MatchStatus.PENDING)
  @Column({ type: DataType.ENUM(...Object.values(MatchStatus)), allowNull: false })
  declare matchStatus: MatchStatus;

  @Column({ type: DataType.BOOLEAN, allowNull: true })
  declare amountMatch: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true })
  declare quantityMatch: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true })
  declare vendorMatch: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true })
  declare poNumberMatch: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true })
  declare supplierMatch: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true })
  declare currencyMatch: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true })
  declare priceMatch: boolean | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare invoiceAmount: number | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare poAmount: number | null;

  /** Remaining PO amount still available after this match (line-level draw-down). */
  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare poAvailableAmount: number | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare grnAmount: number | null;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: true })
  declare tolerancePct: number | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare discrepancyCount: number;

  @Column({ type: DataType.STRING(20), allowNull: true })
  declare matchedBy: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare matchedAt: Date | null;

  @Column({ type: DataType.STRING(1000), allowNull: true })
  declare exceptionReason: string | null;
}
