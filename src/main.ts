import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix
  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  app.setGlobalPrefix(apiPrefix, {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  // CORS
  const rawOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : [process.env.FRONTEND_URL || 'http://localhost:4200'];
  const normalizedOrigins = rawOrigins.filter(Boolean).map((origin) => origin.replace(/\/+$/, ''));

  app.enableCors({
    origin: (origin, callback) => {
      // Allow non-browser clients (Postman, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = origin.replace(/\/+$/, '');
      const isExactMatch = normalizedOrigins.includes(normalizedOrigin);
      const isWildcardMatch = normalizedOrigins.some((allowed) => {
        if (!allowed.includes('*')) return false;
        // Supports patterns like https://*.netlify.app
        try {
          const allowedUrl = new URL(allowed.replace('*.', 'placeholder.'));
          const incomingUrl = new URL(normalizedOrigin);
          const protocolMatches = allowedUrl.protocol === incomingUrl.protocol;
          const allowedHostSuffix = allowedUrl.hostname.replace('placeholder.', '.');
          const hostMatches = incomingUrl.hostname.endsWith(allowedHostSuffix);
          return protocolMatches && hostMatches;
        } catch {
          return false;
        }
      });

      callback(null, isExactMatch || isWildcardMatch);
    },
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Psychology Clinic SaaS API')
    .setDescription('Multi-tenant Psychology Clinic Management System')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT access token',
        in: 'header',
      },
      'access-token',
    )
    .addTag('auth', 'Authentication endpoints')
    .addTag('tenants', 'Tenant management')
    .addTag('users', 'User management')
    .addTag('patients', 'Patient management')
    .addTag('appointments', 'Appointment scheduling')
    .addTag('clinical-notes', 'Clinical records')
    .addTag('tasks', 'Task management')
    .addTag('next-session-plans', 'Treatment plans')
    .addTag('notifications', 'Notification system')
    .addTag('health', 'Health checks')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}/${apiPrefix}`);
  console.log(`📚 Swagger docs available at: http://localhost:${port}/${apiPrefix}/docs`);
}

bootstrap();
