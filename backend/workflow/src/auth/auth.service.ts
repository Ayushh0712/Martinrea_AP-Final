import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { JwtPayload } from './strategies/jwt.strategy';
import { AuthProvider } from '../config/configuration';

export interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    plantId: string | null;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const provider = this.config.get<AuthProvider>('auth.provider') ?? 'local';
    if (provider === 'keycloak') {
      return this.loginViaKeycloak(email, password);
    }

    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.users.verifyPassword(password, user.passwordHash);
    if (!ok) {
      await this.audit.record({
        actionType: 'AUTH_LOGIN_FAILED',
        performedBy: user.id,
        newValue: { email: user.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      plantId: user.plantId,
      managerId: user.managerId,
    };

    const accessToken = await this.jwt.signAsync(payload);

    await this.audit.record({
      actionType: 'AUTH_LOGIN_SUCCESS',
      performedBy: user.id,
      newValue: { email: user.email, role: user.role },
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        plantId: user.plantId,
      },
    };
  }

  /**
   * Keycloak Direct Access Grant, performed server-side so the confidential
   * client secret never reaches the browser. The frontend keeps calling
   * POST /api/auth/login with email + password; we exchange those for a
   * Keycloak RS256 access token and resolve the local user mirror (so the UI
   * gets id / fullName / plantId, and downstream services keep our UUIDs).
   */
  private async loginViaKeycloak(
    email: string,
    password: string,
  ): Promise<LoginResult> {
    const issuer = this.config.get<string>('keycloak.issuer');
    const clientId = this.config.get<string>('keycloak.clientId');
    const clientSecret = this.config.get<string>('keycloak.clientSecret');
    if (!issuer || !clientId) {
      throw new ServiceUnavailableException(
        'AUTH_PROVIDER=keycloak but KEYCLOAK_ISSUER / KEYCLOAK_CLIENT_ID are not set.',
      );
    }

    const tokenUrl = `${issuer.replace(/\/+$/, '')}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      username: email,
      password,
      scope: 'openid',
    });
    if (clientSecret) body.set('client_secret', clientSecret);

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Keycloak unreachable at ${tokenUrl}: ${(err as Error).message}`,
      );
    }

    if (res.status === 400 || res.status === 401) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Keycloak token endpoint error ${res.status}: ${text.slice(0, 200)}`,
      );
    }

    const token = (await res.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new UnauthorizedException('Keycloak returned no access token');
    }

    // The local users table mirrors the Keycloak users (same emails). It gives
    // us our internal UUID + fullName + plantId for the UI and audit trail.
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        `No active local user mirror for ${email}. Run 'npm run seed' to provision it.`,
      );
    }

    await this.audit.record({
      actionType: 'AUTH_LOGIN_SUCCESS',
      performedBy: user.id,
      newValue: { email: user.email, role: user.role, via: 'keycloak' },
    });

    return {
      accessToken: token.access_token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        plantId: user.plantId,
      },
    };
  }
}
