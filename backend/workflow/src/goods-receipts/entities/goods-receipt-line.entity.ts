import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

/**
 * A single received line on a goods receipt, tied to the PO line it fulfils.
 * Captures received/accepted/rejected quantities for line-level 3-way match.
 */
@Table({
  tableName: 'goods_receipt_lines',
  timestamps: true,
  underscored: true,
})
export class GoodsReceiptLine extends Model<GoodsReceiptLine> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare goodsReceiptId: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare purchaseOrderLineId: string | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare receivedQuantity: number | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare acceptedQuantity: number | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare rejectedQuantity: number | null;

  @Column({ type: DataType.DECIMAL(16, 4), allowNull: true })
  declare unitPrice: number | null;
}
