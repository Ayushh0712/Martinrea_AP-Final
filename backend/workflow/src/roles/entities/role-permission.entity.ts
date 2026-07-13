import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Role } from '../../common/enums/role.enum';

/**
 * RBAC permission matrix (PRD Section 4.7).
 *
 * One row per (role, permission) pair. Permissions follow RESOURCE:ACTION.
 * Rows can be toggled via isActive without code changes.
 */
@Table({
  tableName: 'role_permissions',
  timestamps: true,
  underscored: true,
})
export class RolePermission extends Model<RolePermission> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.ENUM(...Object.values(Role)), allowNull: false })
  declare role: Role;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare permission: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare description: string | null;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;
}
