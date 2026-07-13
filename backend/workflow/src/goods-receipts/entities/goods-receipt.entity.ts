import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export enum GoodsReceiptStatus {
  OPEN = 'OPEN',
  PARTIALLY_MATCHED = 'PARTIALLY_MATCHED',
  FULLY_MATCHED = 'FULLY_MATCHED',
  REJECTED = 'REJECTED',
}

interface GoodsReceiptLineItem {
  poLineRef: string;
  partNumber?: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPrice: number;
  currency: string;
}

/**
 * Goods receipt (mock ERP view) used as the "GR" leg of the 3-way match.
 */
@Table({
  tableName: 'goods_receipts',
  timestamps: true,
  underscored: true,
})
export class GoodsReceipt extends Model<GoodsReceipt> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(60), allowNull: false, unique: true })
  declare grNumber: string;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare poNumber: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare purchaseOrderId: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare purchaseOrderLineId: string | null;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare supplierCode: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare supplierName: string | null;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare plantId: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare receivedDate: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare receivedBy: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare partNumberDescription: string | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare receivedQuantity: number | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare acceptedQuantity: number | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare rejectedQuantity: number | null;

  @Column({ type: DataType.DECIMAL(16, 4), allowNull: true })
  declare unitPrice: number | null;

  @Default(GoodsReceiptStatus.OPEN)
  @Column({
    type: DataType.ENUM(...Object.values(GoodsReceiptStatus)),
    allowNull: false,
  })
  declare status: GoodsReceiptStatus;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'USD' })
  declare currency: string;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare totalReceivedValue: number | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare lineItems: GoodsReceiptLineItem[] | null;

  @Column({ type: DataType.STRING(1000), allowNull: true })
  declare notes: string | null;
}
