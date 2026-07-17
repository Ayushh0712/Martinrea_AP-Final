import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from '../../users/users.service';
import { AuthProvider } from '../../config/configuration';

/**
 * Payload shape for the LOCAL HS256 path (issued by our own /auth/login).
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  plantId: string | null;
  managerId: string | null;
}

/**
 * Payload shape for the KEYCLOAK RS256 path (issued by Keycloak).
 * Only the fields we actually consume are declared.
 */
interface KeycloakAccessTokenPayload {
  sub: string;
  iss: string;
  email?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  plant_id?: string;
}

/**
 * Dual-mode JWT strategy.
 *
 * - AUTH_PROVIDER=local    -> validate HS256 tokens signed by our service.
 * - AUTH_PROVIDER=keycloak -> validate RS256 tokens signed by Keycloak,
 *                            using its JWKS endpoint to fetch the public
 *                            key. The token's email claim is resolved to
 *                            our local users table so downstream code
 *                            (audit logs, approval_chain, manager_id, etc.)
 *                            keeps using our internal UUIDs.
 *
 * @Roles() / RolesGuard / @CurrentUser() consumers are unchanged.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private static readonly logger = new Logger(JwtStrategy.name);
  private readonly provider: AuthProvider;

  constructor(config: ConfigService, private readonly users: UsersService) {
    const provider = (config.get<AuthProvider>('auth.provider') ?? 'local');

    let opts: StrategyOptions;
    if (provider === 'keycloak') {
      const issuer = config.get<string>('keycloak.issuer');
      const jwksUri = config.get<string>('keycloak.jwksUri');
      if (!issuer || !jwksUri) {
        throw new Error(
          'AUTH_PROVIDER=keycloak requires KEYCLOAK_ISSUER and KEYCLOAK_JWKS_URI',
        );
      }
      JwtStrategy.logger.log(
        `Auth mode: KEYCLOAK (RS256). Issuer=${issuer}`,
      );
      opts = {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        algorithms: ['RS256'],
        issuer,
        // Audience check is intentionally OFF: Keycloak by default sets
        // aud="account", not the client id. Add a Keycloak audience
        // mapper later if you want to flip this on.
        secretOrKeyProvider: passportJwtSecret({
          cache: true,
          rateLimit: true,
          jwksRequestsPerMinute: 10,
          jwksUri,
        }),
      };
    } else {
      const secret = config.get<string>('jwt.secret');
      if (!secret) {
        throw new Error('JWT secret is not configured');
      }
      JwtStrategy.logger.log('Auth mode: LOCAL (HS256)');
      opts = {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        algorithms: ['HS256'],
        secretOrKey: secret,
      };
    }

    super(opts);
    this.provider = provider;
  }

  async validate(payload: unknown): Promise<AuthenticatedUser> {
    console.log("JWT VALIDATE CALLED");
    console.log(payload);
    return this.provider === 'keycloak'
      ? this.validateKeycloak(payload as KeycloakAccessTokenPayload)
      : this.validateLocal(payload as JwtPayload);
  }

  private validateLocal(payload: JwtPayload): AuthenticatedUser {
    if (!payload?.sub || !payload?.role) {
      throw new UnauthorizedException('Malformed token');
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      plantId: payload.plantId,
      managerId: payload.managerId,
    };
  }

  private async validateKeycloak(
    payload: KeycloakAccessTokenPayload,
  ): Promise<AuthenticatedUser> {
    const email = payload.email?.toLowerCase();
    if (!email) {
      throw new UnauthorizedException(
        'Keycloak token has no email claim (check the email/profile scope on the client)',
      );
    }

    const roleValues = Object.values(Role) as string[];
    const kcRoles = [
      ...(payload.realm_access?.roles ?? []),
      ...Object.values(payload.resource_access ?? {}).flatMap(
        (r) => r.roles ?? [],
      ),
    ];
    const role = kcRoles.find((r) => roleValues.includes(r)) as Role | undefined;
    if (!role) {
      throw new UnauthorizedException(
        `Keycloak token carries no recognised role. Expected one of [${roleValues.join(', ')}], got [${kcRoles.join(', ')}]`,
      );
    }

    const local = await this.users.findByEmail(email);
    if (!local) {
      throw new UnauthorizedException(
        `Keycloak user ${email} has no local user record. Run 'npm run seed' to provision the mirror.`,
      );
    }
    if (!local.isActive) {
      throw new UnauthorizedException(`User ${email} is inactive`);
    }

    return {
      id: local.id,
      email: local.email,
      role,
      plantId: local.plantId,
      managerId: local.managerId,
    };
  }
}
