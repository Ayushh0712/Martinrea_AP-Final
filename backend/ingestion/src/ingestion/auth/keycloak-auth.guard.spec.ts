import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import { KeycloakAuthGuard } from './keycloak-auth.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

const mockJwtVerify = jwtVerify as unknown as jest.Mock;

function configStub(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, def?: string) => values[key] ?? def,
  } as unknown as ConfigService;
}

function contextFor(headers: Record<string, string>): {
  context: ExecutionContext;
  req: { headers: Record<string, string>; user?: unknown };
} {
  const req: { headers: Record<string, string>; user?: unknown } = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

const PROD_CONFIG = {
  INGESTION_PROFILE: 'prod',
  KEYCLOAK_ISSUER_URL: 'https://auth.example.com/realms/mre-ap',
  KEYCLOAK_JWKS_URL: 'https://auth.example.com/realms/mre-ap/protocol/openid-connect/certs',
  KEYCLOAK_AUDIENCE: 'ap-ingestion-api',
};

beforeEach(() => {
  mockJwtVerify.mockReset();
});

describe('KeycloakAuthGuard -- local profile', () => {
  const guard = () => new KeycloakAuthGuard(configStub({ INGESTION_PROFILE: 'local' }));

  it('accepts requests without a bearer token (dev bypass) and injects a dev AP_Clerk', async () => {
    const { context, req } = contextFor({});
    await expect(guard().canActivate(context)).resolves.toBe(true);
    expect(req.user).toMatchObject({ role: 'AP_Clerk', id: 'dev-user' });
  });

  it('accepts any bearer token and injects a dev AP_Clerk', async () => {
    const { context, req } = contextFor({ authorization: 'Bearer anything' });

    await expect(guard().canActivate(context)).resolves.toBe(true);

    expect(req.user).toMatchObject({ role: 'AP_Clerk', id: 'dev-user' });
  });

  it('honours the X-Dev-Role override for known roles only', async () => {
    const elevated = contextFor({
      authorization: 'Bearer t',
      'x-dev-role': 'Plant_Manager',
    });
    await guard().canActivate(elevated.context);
    expect(elevated.req.user).toMatchObject({ role: 'Plant_Manager' });

    const unknown = contextFor({ authorization: 'Bearer t', 'x-dev-role': 'Super_Admin' });
    await guard().canActivate(unknown.context);
    expect(unknown.req.user).toMatchObject({ role: 'AP_Clerk' }); // falls back
  });
});

describe('KeycloakAuthGuard -- prod profile', () => {
  it('fails closed when Keycloak config is missing', async () => {
    const guard = new KeycloakAuthGuard(configStub({ INGESTION_PROFILE: 'prod' }));
    const { context } = contextFor({ authorization: 'Bearer token' });

    await expect(guard.canActivate(context)).rejects.toThrow(/not configured/);
  });

  it('rejects tokens that fail JWKS verification', async () => {
    mockJwtVerify.mockRejectedValue(new Error('signature mismatch'));
    const guard = new KeycloakAuthGuard(configStub(PROD_CONFIG));
    const { context } = contextFor({ authorization: 'Bearer bad-token' });

    await expect(guard.canActivate(context)).rejects.toThrow(/Invalid token/);
    expect(mockJwtVerify).toHaveBeenCalledWith('bad-token', 'mock-jwks', {
      issuer: PROD_CONFIG.KEYCLOAK_ISSUER_URL,
      audience: PROD_CONFIG.KEYCLOAK_AUDIENCE,
    });
  });

  it('maps a verified token with a known role onto req.user', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: 'user-42',
        email: 'clerk@martinrea.com',
        resource_access: { 'ap-ingestion-api': { roles: ['AP_Clerk'] } },
      },
    });
    const guard = new KeycloakAuthGuard(configStub(PROD_CONFIG));
    const { context, req } = contextFor({ authorization: 'Bearer good-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(req.user).toEqual({ id: 'user-42', email: 'clerk@martinrea.com', role: 'AP_Clerk' });
  });

  it('rejects verified tokens that carry no recognised AP role', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: 'user-43',
        resource_access: { 'ap-ingestion-api': { roles: ['Random_Role'] } },
      },
    });
    const guard = new KeycloakAuthGuard(configStub(PROD_CONFIG));
    const { context } = contextFor({ authorization: 'Bearer good-token' });

    await expect(guard.canActivate(context)).rejects.toThrow(/No recognised AP role/);
  });

  it('reads the role from a custom claim path when configured', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'u', realm_access: { roles: ['Finance_Director'] } },
    });
    const guard = new KeycloakAuthGuard(
      configStub({ ...PROD_CONFIG, KEYCLOAK_ROLE_CLAIM_PATH: 'realm_access.roles' }),
    );
    const { context, req } = contextFor({ authorization: 'Bearer good-token' });

    await guard.canActivate(context);

    expect(req.user).toMatchObject({ role: 'Finance_Director' });
  });
});
