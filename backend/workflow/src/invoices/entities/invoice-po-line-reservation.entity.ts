import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export enum ReservationStatus {
  RESERVED = 'RESERVED',
  CONSUMED = 'CONSUMED',
  RELEASED = 'RELEASED',
  PARTIAL = 'PARTIAL',
}

/**
 * Ledger row linking an invoice (line) to the PO line it draws against.
 * Records how much quantity/amount was reserved and what became of it,
 * so multiple invoices can consume one PO without double-spending it.
 */
@Table({
  tableName: 'invoice_po_line_reservations',
  timestamps: true,
  underscored: true,
})
export class InvoicePoLineReservation extends Model<InvoicePoLineReservation> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare invoiceId: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare invoiceLineId: string | null;

  @Column({ type: DataType.UUID, allowNull: false })
  declare purchaseOrderId: string;

  @Column({ type: DataType.UUID, allowNull: true })
  declare purchaseOrderLineId: string | null;

  @Default(0)
  @Column({ type: DataType.DECIMAL(14, 3), allowNull: false })
  declare reservedQuantity: number;

  @Default(0)
  @Column({ type: DataType.DECIMAL(16, 2), allowNull: false })
  declare reservedAmount: number;

  @Default(ReservationStatus.RESERVED)
  @Column({
    type: DataType.ENUM(...Object.values(ReservationStatus)),
    allowNull: false,
  })
  declare status: ReservationStatus;

  @Column({ type: DataType.DATE, allowNull: true })
  declare reservedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare consumedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare releasedAt: Date | null;
}
