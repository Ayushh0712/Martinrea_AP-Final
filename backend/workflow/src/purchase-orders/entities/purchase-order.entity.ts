import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export enum PurchaseOrderStatus {
  OPEN = 'OPEN',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED = 'FULLY_RECEIVED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

/**
 * Purchase order header (mock ERP view) used as the "PO" leg of the 3-way match.
 */
@Table({
  tableName: 'purchase_orders',
  timestamps: true,
  underscored: true,
})
export class PurchaseOrder extends Model<PurchaseOrder> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(60), allowNull: false, unique: true })
  declare poNumber: string;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare supplierCode: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare supplierId: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare supplierName: string | null;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare plantId: string | null;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'USD' })
  declare currency: string;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare totalAmount: number | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare orderTotal: number | null;

  // Line-level 2-way matching draw-down tracking (header rollups of the
  // per-line reserved/consumed amounts).
  @Default(0)
  @Column({ type: DataType.DECIMAL(16, 2), allowNull: false })
  declare reservedAmount: number;

  @Default(0)
  @Column({ type: DataType.DECIMAL(16, 2), allowNull: false })
  declare consumedAmount: number;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare partNumberDescription: string | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare quantity: number | null;

  @Column({ type: DataType.DECIMAL(16, 4), allowNull: true })
  declare unitPrice: number | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare lineTotal: number | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare instanceId: string | null;

  @Default(PurchaseOrderStatus.OPEN)
  @Column({
    type: DataType.ENUM(...Object.values(PurchaseOrderStatus)),
    allowNull: false,
  })
  declare status: PurchaseOrderStatus;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare issuedDate: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare expectedDeliveryDate: string | null;

  @Column({ type: DataType.STRING(1000), allowNull: true })
  declare notes: string | null;
}
