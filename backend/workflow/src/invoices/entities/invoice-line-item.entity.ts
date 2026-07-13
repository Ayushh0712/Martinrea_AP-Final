import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

/**
 * Individual line items belonging to an invoice. Unique per (invoice, line)
 * so seeds and OCR re-extraction upsert idempotently.
 */
@Table({
  tableName: 'invoice_line_items',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'invoice_line_items_invoice_line_uq',
      unique: true,
      fields: ['invoice_id', 'line_number'],
    },
  ],
})
export class InvoiceLineItem extends Model<InvoiceLineItem> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare invoiceId: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare lineNumber: number;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare description: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare itemCode: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare skuOrPartNumber: string | null;

  @Column({ type: DataType.DECIMAL(14, 3), allowNull: true })
  declare quantity: number | null;

  @Column({ type: DataType.STRING(20), allowNull: true })
  declare unitOfMeasure: string | null;

  @Column({ type: DataType.DECIMAL(16, 4), allowNull: true })
  declare unitPrice: number | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare lineTotal: number | null;
}
