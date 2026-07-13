import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { HttpStatus, Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // PRD DAT-03: input validation failures return 422 (not the Nest 400).
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );

  // PRD DAT-03: uniform error envelope { success:false, error, message, ... }.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Serve the OCR dashboard UI from /public at the site root.
  // API routes live under /api/* so they don't collide.
  app.useStaticAssets(join(process.cwd(), 'public'));

  app.setGlobalPrefix('api');

  // CORS origins are env-driven (comma-separated) so the frontend origin can
  // be configured per environment without code changes. Falls back to the
  // common local dev origins.
  const corsOrigins = (
    config.get<string>('CORS_ORIGINS') ??
    'http://localhost:3000,http://10.221.149.102:3000'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const swagger = new DocumentBuilder()
    .setTitle('Martinrea AP Backend')
    .setDescription(
      'Unified backend: invoice approval workflow (WF-01..WF-05) + AI invoice OCR pipeline (/api/ocr/*).',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, doc);

  const port = config.get<number>('port') ?? 3001;
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `Martinrea AP backend listening on http://10.221.149.102:${port}/api (also reachable on http://localhost:${port}/api)`,
    'Bootstrap',
  );
  Logger.log(`Swagger docs at http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start workflow-service', err);
  process.exit(1);
});
