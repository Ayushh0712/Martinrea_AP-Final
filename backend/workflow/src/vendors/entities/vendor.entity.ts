import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

export enum VendorType {
  MANUFACTURER = 'MANUFACTURER',
  DISTRIBUTOR = 'DISTRIBUTOR',
  SERVICE_PROVIDER = 'SERVICE_PROVIDER',
  OTHER = 'OTHER',
}

export enum VendorStatus {
  ACTIVE = 'ACTIVE',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  BLOCKED = 'BLOCKED',
  INACTIVE = 'INACTIVE',
}

/**
 * Vendor master data with onboarding status, banking details and rollup
 * counters used by the AP dashboards.
 */
@Table({
  tableName: 'vendors',
  timestamps: true,
  underscored: true,
})
export class Vendor extends Model<Vendor> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(50), allowNull: false, unique: true })
  declare vendorCode: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare legalName: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare taxId: string | null;

  @Default(VendorType.MANUFACTURER)
  @Column({ type: DataType.ENUM(...Object.values(VendorType)), allowNull: false })
  declare vendorType: VendorType;

  @Default(VendorStatus.PENDING_APPROVAL)
  @Column({ type: DataType.ENUM(...Object.values(VendorStatus)), allowNull: false })
  declare status: VendorStatus;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare email: string | null;

  @Column({ type: DataType.STRING(40), allowNull: true })
  declare phone: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare website: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare address: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare city: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare state: string | null;

  @Column({ type: DataType.STRING(2), allowNull: true })
  declare countryCode: string | null;

  @Column({ type: DataType.STRING(20), allowNull: true })
  declare postalCode: string | null;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'USD' })
  declare currency: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare paymentTermsDays: number | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare creditLimit: number | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare contactName: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare contactEmail: string | null;

  @Column({ type: DataType.STRING(40), allowNull: true })
  declare contactPhone: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare bankDetails: Record<string, unknown> | null;

  @Column({ type: DataType.STRING(1000), allowNull: true })
  declare notes: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare onboardedDate: string | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare totalPurchaseOrders: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare totalGoodsReceipts: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare totalInvoices: number;
}
