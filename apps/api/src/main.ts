import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fs from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/app.config.js';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const doc = new DocumentBuilder()
    .setTitle('Vermax API')
    .setDescription('NSE swing-trading decision platform: daily picks with stop/targets, sector priority (Defence & Engineering), fundamentals + news overlays.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  // Serve the built UI (apps/web/dist) from the same process so one service runs the whole product.
  const webDist = path.join(cfg.repoRoot, 'apps', 'web', 'dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.useStaticAssets(webDist, { index: false, maxAge: '1h' });
    app.getHttpAdapter().getInstance().get(/^\/(?!api|docs).*/, (_req: unknown, res: { sendFile: (p: string) => void }) => res.sendFile(path.join(webDist, 'index.html')));
  }

  await app.listen(cfg.port, '0.0.0.0');
  new Logger('Bootstrap').log(`Vermax on http://127.0.0.1:${cfg.port}  (API /api, docs /docs${fs.existsSync(webDist) ? ', UI /' : ''})`);
}
await bootstrap();
