import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const config = app.get(AppConfigService);
  await app.listen(config.get('PORT'), '0.0.0.0');
  app
    .get(Logger)
    .log(
      `EmblemWay API listening on :${config.get('PORT')}/${config.get('API_PREFIX')} (${config.get('NODE_ENV')})`,
    );
}

process.on('unhandledRejection', (reason) => {
  // Surface, never swallow: an unhandled rejection is a bug.
  process.stderr.write(
    `Unhandled promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`,
  );
});

bootstrap().catch((err: unknown) => {
  process.stderr.write(
    `Failed to start EmblemWay API: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
