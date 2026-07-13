import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { BLOB_UPLOAD_CLIENT } from '../shared';
import { PreProcessingService } from '../pre-processing/pre-processing.service';
import { PortalIngestionController } from './portal-ingestion.controller';
import { KeycloakAuthGuard } from '../auth/keycloak-auth.guard';
import { makePdf } from '../../../test/fixtures/file-bytes';

// Test-only guard that mimics what a verified Keycloak JWT will eventually
// inject. Real Keycloak verification is tested separately against the
// production JWKS in a dedicated guard suite (see NEEDS.md, "Auth tests").
const allowGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.headers.authorization?.toLowerCase().startsWith('bearer ')) {
      return false;
    }
    req.user = {
      id: 'u-test-1',
      email: 'test.clerk@martinrea.local',
      role: 'AP_Clerk' as const,
    };
    return true;
  },
};

describe('PortalIngestionController (e2e-ish)', () => {
  let app: INestApplication;
  let blob: { uploaded: Array<{ name: string; channel: string }> };

  beforeAll(async () => {
    blob = { uploaded: [] };
    const env: Record<string, string> = {
      MAX_FILE_BYTES: '10485760',
      ALLOWED_MIME_TYPES:
        'application/pdf,image/jpeg,image/png,image/tiff,application/xml,text/xml',
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PortalIngestionController],
      providers: [
        PreProcessingService,
        {
          provide: BLOB_UPLOAD_CLIENT,
          useValue: {
            upload: async (doc: { metadata: { originalName: string; sourceChannel: string } }) => {
              blob.uploaded.push({
                name: doc.metadata.originalName,
                channel: doc.metadata.sourceChannel,
              });
              return {
                documentId: `doc-${blob.uploaded.length}`,
                blobPath: 'x',
                isDuplicate: false,
              };
            },
            quarantine: async () => {
              /* noop */
            },
          },
        },
        { provide: ConfigService, useValue: { get: (k: string, d?: string) => env[k] ?? d } },
      ],
    })
      .overrideGuard(KeycloakAuthGuard)
      .useValue(allowGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests with no Authorization header', async () => {
    await request(app.getHttpServer())
      .post('/api/ingestion/upload')
      .attach('file', makePdf(), 'invoice.pdf')
      .expect(403);
  });

  it('accepts a valid PDF with a bearer token and returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ingestion/upload')
      .set('Authorization', 'Bearer test-token')
      .attach('file', makePdf(), 'invoice.pdf')
      .field('vendorHint', 'Northbridge')
      .expect(201);

    expect(res.body).toMatchObject({
      success: true,
      data: { documentId: expect.stringMatching(/^doc-/), status: 'STAGED' },
    });
    expect(blob.uploaded[blob.uploaded.length - 1].channel).toBe('portal');
  });

  it('rejects an unsupported file type with 415', async () => {
    await request(app.getHttpServer())
      .post('/api/ingestion/upload')
      .set('Authorization', 'Bearer test-token')
      .attach('file', Buffer.from('MZ\x90\x00\x03\x00\x00bogus-exe-payload'), 'sneaky.pdf')
      .expect(415);
  });

  it('rejects an empty body with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/ingestion/upload')
      .set('Authorization', 'Bearer test-token')
      .expect(400);
  });
});
