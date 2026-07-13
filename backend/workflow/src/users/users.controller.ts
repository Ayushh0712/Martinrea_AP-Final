import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Phase 1 stub. In production this is restricted to Finance_Director
   * (or an admin role added later). For local bootstrapping use the
   * `npm run seed` script.
   */
  @Post()
  @Roles(Role.FINANCE_DIRECTOR)
  async create(@Body() dto: CreateUserDto) {
    const user = await this.users.create(dto);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      plantId: user.plantId,
    };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    // Enrich the token identity with fullName from the users table so the
    // frontend AuthUser (which expects fullName) is complete after refresh.
    const full = await this.users.findById(user.id).catch(() => null);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      plantId: user.plantId,
      managerId: user.managerId,
      fullName: full?.fullName ?? user.email,
    };
  }
}
