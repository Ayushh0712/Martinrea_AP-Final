import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

/**
 * Supplier master data (lightweight view used by the workflow + match tracks).
 */
@Table({
  tableName: 'suppliers',
  timestamps: true,
  underscored: true,
})
export class Supplier extends Model<Supplier> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(50), allowNull: false, unique: true })
  declare supplierCode: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare taxId: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare email: string | null;

  @Column({ type: DataType.STRING(40), allowNull: true })
  declare phone: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare address: string | null;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'USD' })
  declare currency: string;

  @Column({ type: DataType.STRING(2), allowNull: true })
  declare countryCode: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare paymentTermsDays: number | null;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;
}
