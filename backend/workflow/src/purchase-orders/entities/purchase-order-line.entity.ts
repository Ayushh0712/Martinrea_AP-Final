import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export enum PurchaseOrderLineStatus {
  OPEN = 'OPEN',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED = 'FULLY_RECEIVED',
}

/**
 * A single line on a purchase order. Enables line-level 2-way matching:
 * each line tracks ordered vs reserved vs consumed quantity so multiple
 * invoices can draw down one PO. Unique per (purchase_order, line_number).
 */
@Table({
  tableName: 'purchase_order_lines',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'purchase_order_lines_po_line_uq',
      unique: true,
      fields: ['purchase_order_id', 'line_number'],
    },
  ],
})
export class PurchaseOrderLine extends Model<PurchaseOrderLine> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare purchaseOrderId: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare lineNumber: number;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare itemCode: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare description: string | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare orderQuantity: number | null;

  @Default(0)
  @Column({ type: DataType.DECIMAL(14, 3), allowNull: false })
  declare reservedQuantity: number;

  @Default(0)
  @Column({ type: DataType.DECIMAL(14, 3), allowNull: false })
  declare consumedQuantity: number;

  @Column({ type: DataType.STRING(20), allowNull: true })
  declare unitOfMeasure: string | null;

  @Column({ type: DataType.DECIMAL(16, 4), allowNull: true })
  declare unitPrice: number | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare lineTotal: number | null;

  @Default(PurchaseOrderLineStatus.OPEN)
  @Column({
    type: DataType.ENUM(...Object.values(PurchaseOrderLineStatus)),
    allowNull: false,
  })
  declare status: PurchaseOrderLineStatus;
}
