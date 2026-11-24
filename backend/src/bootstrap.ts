import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppConfigService } from './config/app-config.service';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

/** Shared HTTP setup used by main.ts and by the integration tests (identical behaviour). */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get(AppConfigService);
  app.use(requestIdMiddleware);
  app.setGlobalPrefix(config.get('API_PREFIX'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProductionLike ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  const origins = config
    .get('CORS_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useBodyParser('json', { limit: '256kb' });

  const uploadDir = resolve(config.get('UPLOAD_DIR'));
  mkdirSync(uploadDir, { recursive: true });
  app.useStaticAssets(uploadDir, {
    prefix: '/uploads/',
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
  });

  if (!config.isProductionLike || process.env.ENABLE_SWAGGER === 'true') {
    const doc = new DocumentBuilder()
      .setTitle('EmblemWay API')
      .setDescription(
        'Journeys, geospatial route matching, traffic prediction, hotspots and ride pooling.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc), {
      jsonDocumentUrl: 'api/docs-json',
    });
  }
  app.enableShutdownHooks();
  return app;
}
