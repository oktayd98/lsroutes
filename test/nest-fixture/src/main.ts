import { NestFactory } from '@nestjs/core';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api', { exclude: ['health', { path: 'webhooks/(.*)', method: RequestMethod.POST }] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  await app.listen(3000);
}
bootstrap();
