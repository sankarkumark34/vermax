import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/app.config.js';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const doc = new DocumentBuilder()
    .setTitle('Vermax API')
    .setDescription('NSE swing-trading decision platform: daily picks with stop/targets, sector priority (Defence & Engineering), fundamentals + news overlays, paper-trade journal.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  await app.listen(cfg.port, '0.0.0.0');
  new Logger('Bootstrap').log(`Vermax API on http://127.0.0.1:${cfg.port}/api  (docs: /docs)`);
}
await bootstrap();
