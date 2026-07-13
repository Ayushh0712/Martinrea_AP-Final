import {
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Role } from '../../common/enums/role.enum';

/**
 * Users table - Phase 1 RBAC.
 *
 * NOTE: The canonical Users schema is owned by Roshni (Data & Repository
 * track, DAT-01). This entity defines the columns the Workflow service
 * requires. Once Roshni publishes the unified migration, this entity
 * must be reconciled with the shared schema. See README "Open Questions".
 */
@Table({
  tableName: 'users',
  timestamps: true,
  paranoid: true,
  underscored: true,
})
export class User extends Model<User> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
  declare email: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare fullName: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare passwordHash: string;

  @Column({
    type: DataType.ENUM(...Object.values(Role)),
    allowNull: false,
  })
  declare role: Role;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare plantId: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare managerId: string | null;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;
}
