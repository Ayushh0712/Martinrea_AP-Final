import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import './express-request';

export type Role = 'AP_Clerk' | 'Plant_Manager' | 'Finance_Director' | 'Admin';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

const KNOWN_ROLES: readonly Role[] = ['AP_Clerk', 'Plant_Manager', 'Finance_Director', 'Admin'];

// `req.user` typing lives in ./express-request.ts. The side-effect import
// above guarantees the augmentation is loaded by every consumer.

/**
 * Auth guard backed by Keycloak (WF-01).
 *
 * Wiring contract (provided by Mohd Aman / Identity team):
 *   KEYCLOAK_ISSUER_URL        e.g. https://auth.martinrea.com/realms/martinrea
 *   KEYCLOAK_JWKS_URL          e.g. https://auth.martinrea.com/realms/martinrea/protocol/openid-connect/certs
 *   KEYCLOAK_AUDIENCE          e.g. ap-ingestion-api
 *   KEYCLOAK_ROLE_CLAIM_PATH   e.g. resource_access.ap-ingestion-api.roles  (dot path)
 *
 * Behaviour by profile (INGESTION_PROFILE):
 *   - `local`: any `Bearer <token>` is accepted and a dev AP_Clerk identity
 *     is injected, so the portal can be exercised without a Keycloak server.
 *     A specific dev role can be requested via `X-Dev-Role: Plant_Manager`.
 *   - anything else (`prod`): the bearer JWT is cryptographically verified
 *     against the Keycloak JWKS (issuer + audience checked), and the role is
 *     extracted from the configured claim path. Fails CLOSED -- a missing or
 *     invalid token, or missing config, returns 401.
 */
type AuthMode = 'local' | 'jwt' | 'keycloak';

@Injectable()
export class KeycloakAuthGuard implements CanActivate {
  private readonly logger = new Logger(KeycloakAuthGuard.name);
  private readonly mode: AuthMode;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: ConfigService) {
    this.mode = this.resolveMode();
  }

  /**
   * Auth mode is unified with the rest of the stack:
   *   INGESTION_AUTH_MODE = local | jwt | keycloak  (takes precedence)
   * Falls back to the legacy behaviour driven by INGESTION_PROFILE:
   *   profile=local -> dev bypass, otherwise -> keycloak.
   */
  private resolveMode(): AuthMode {
    const explicit = (this.config.get<string>('INGESTION_AUTH_MODE') ?? '')
      .toLowerCase()
      .trim();
    if (explicit === 'local' || explicit === 'jwt' || explicit === 'keycloak') {
      return explicit;
    }
    return (this.config.get<string>('INGESTION_PROFILE') ?? 'local') === 'local'
      ? 'local'
      : 'keycloak';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;

    // Dev bypass: accept any (or no) bearer and inject a dev identity.
    if (this.mode === 'local') {
      req.user = this.devUser(req);
      return true;
    }

    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = authHeader.slice(authHeader.indexOf(' ') + 1).trim();

    if (this.mode === 'jwt') {
      req.user = await this.verifySharedJwt(token);
      return true;
    }

    // mode === 'keycloak'
    const issuer = this.config.get<string>('KEYCLOAK_ISSUER_URL');
    const jwksUrl = this.config.get<string>('KEYCLOAK_JWKS_URL');
    const audience = this.config.get<string>('KEYCLOAK_AUDIENCE');
    if (!issuer || !jwksUrl || !audience) {
      throw new UnauthorizedException(
        'KeycloakAuthGuard not configured -- set KEYCLOAK_ISSUER_URL, KEYCLOAK_JWKS_URL, KEYCLOAK_AUDIENCE.',
      );
    }

    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, { issuer, audience }));
    } catch (err) {
      throw new UnauthorizedException(`Invalid token: ${(err as Error).message}`);
    }

    const role = this.extractRole(payload);
    if (!role) {
      throw new UnauthorizedException('No recognised AP role in token');
    }

    req.user = {
      id: String(payload.sub ?? payload['oid'] ?? 'unknown'),
      email: String(payload['email'] ?? payload['preferred_username'] ?? 'unknown'),
      role,
    };
    return true;
  }

  /**
   * Verify the HS256 token issued by workflow-service's /api/auth/login using
   * the SHARED JWT_SECRET. Payload shape: { sub, email, role, plantId }.
   */
  private async verifySharedJwt(token: string): Promise<AuthUser> {
    const secretValue = this.config.get<string>('JWT_SECRET');
    if (!secretValue) {
      throw new UnauthorizedException(
        'INGESTION_AUTH_MODE=jwt requires JWT_SECRET (shared with workflow-service).',
      );
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(
        token,
        new TextEncoder().encode(secretValue),
        { algorithms: ['HS256'] },
      ));
    } catch (err) {
      throw new UnauthorizedException(`Invalid token: ${(err as Error).message}`);
    }
    const claimed = String(payload['role'] ?? '');
    const role = KNOWN_ROLES.find((r) => r === claimed) ?? 'AP_Clerk';
    return {
      id: String(payload.sub ?? 'unknown'),
      email: String(payload['email'] ?? 'unknown'),
      role,
    };
  }

  private devUser(req: Request): AuthUser {
    const requested = req.headers['x-dev-role'];
    const role = KNOWN_ROLES.find((r) => r === requested) ?? 'AP_Clerk';
    return { id: 'dev-user', email: 'dev.clerk@martinrea.local', role };
  }

  /**
   * Pull the role from the JWT using the configured dot path. Keycloak
   * typically nests client roles under `resource_access.<client>.roles`
   * (an array). We return the first value that maps to a known AP role.
   */
  private extractRole(payload: JWTPayload): Role | undefined {
    const path = this.config.get<string>(
      'KEYCLOAK_ROLE_CLAIM_PATH',
      'resource_access.ap-ingestion-api.roles',
    );
    const claim = path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, payload);

    const candidates = Array.isArray(claim) ? claim : [claim];
    return KNOWN_ROLES.find((r) => candidates.includes(r));
  }
}
