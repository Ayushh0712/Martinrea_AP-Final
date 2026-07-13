export type AuthProvider = 'local' | 'keycloak';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  app: {
    baseUrl: string;
  };
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  };
  auth: {
    provider: AuthProvider;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  keycloak: {
    issuer: string;
    jwksUri: string;
    audience: string;
    clientId: string;
    clientSecret: string;
  };
  mail: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
  };
  workflow: {
    slaPendingApprovalHours: number;
    escalationCron: string;
  };
}

const toBool = (v: string | undefined, dflt: boolean): boolean =>
  v === undefined ? dflt : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  app: {
    baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  },
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'martinrea',
    password: process.env.DB_PASSWORD ?? 'martinrea_dev_pwd',
    name: process.env.DB_NAME ?? 'martinrea_ap',
  },
  auth: {
    provider: ((process.env.AUTH_PROVIDER ?? 'local').toLowerCase() === 'keycloak'
      ? 'keycloak'
      : 'local') as AuthProvider,
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-only-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  },
  keycloak: {
    issuer: process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/martinrea',
    jwksUri:
      process.env.KEYCLOAK_JWKS_URI ??
      'http://localhost:8080/realms/martinrea/protocol/openid-connect/certs',
    audience: process.env.KEYCLOAK_AUDIENCE ?? 'martinrea-ap',
    clientId: process.env.KEYCLOAK_CLIENT_ID ?? 'martinrea-ap',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? '',
  },
  mail: {
    enabled: toBool(process.env.MAIL_ENABLED, true),
    host: process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    secure: toBool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? 'Martinrea AP <noreply@martinrea.local>',
  },
  workflow: {
    slaPendingApprovalHours: parseInt(
      process.env.SLA_PENDING_APPROVAL_HOURS ?? '48',
      10,
    ),
    escalationCron: process.env.ESCALATION_CRON ?? '0 * * * *',
  },
});
