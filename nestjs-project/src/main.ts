import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server as TusServer } from '@tus/server';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from './common/filters/validation-exception.filter';
import swaggerConfig from './config/swagger.config';
import { buildSwaggerDocument } from './swagger/swagger-document';
import swaggerMetadata from './metadata.js';
import { TUS_SERVER, UPLOADS_TUS_PATH } from './uploads/uploads.constants';

async function bootstrap() {
  // Body parsing must stay off globally: the tus endpoint consumes the raw
  // request stream, and NestFactory's default parsers would otherwise
  // intercept it before it reaches the tus handler. JSON/urlencoded parsing
  // is re-applied below for every route except the tus prefix.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl.startsWith(UPLOADS_TUS_PATH)) return next();
    json()(req, res, () => urlencoded({ extended: true })(req, res, next));
  });

  const tusServer = app.get<TusServer>(TUS_SERVER);
  app.use(UPLOADS_TUS_PATH, (req: Request, res: Response) =>
    tusServer.handle(req, res),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );

  const swagger = app.get<ConfigType<typeof swaggerConfig>>(swaggerConfig.KEY);

  if (swagger.enabled) {
    await SwaggerModule.loadPluginMetadata(swaggerMetadata);
    const document = buildSwaggerDocument(app);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'StreamTube API Docs',
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port);
}
void bootstrap();
