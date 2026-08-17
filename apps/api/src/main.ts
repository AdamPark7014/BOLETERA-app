import './load-env';
import { timingSafeEqual } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';

/** Rutas que sirve SwaggerModule.setup('api/docs', …). */
const DOCS_PATHS = ['/api/docs', '/api/docs-json'];

/** Comparación en tiempo constante: no filtra el usuario/clave por temporización. */
function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Basic Auth para la documentación cuando se publica en producción (F2-19).
 *
 * El mapa completo de las ~198 rutas es reconocimiento gratis para un atacante:
 * nombres de parámetros, endpoints de admin y de reembolso, formas de los DTO.
 */
function docsBasicAuth(user: string, password: string) {
  return (req: any, res: any, next: () => void) => {
    const header = String(req.headers?.authorization || '');
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator > -1) {
        const givenUser = decoded.slice(0, separator);
        const givenPassword = decoded.slice(separator + 1);
        if (secretEquals(givenUser, user) && secretEquals(givenPassword, password)) {
          return next();
        }
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Boletera API docs"');
    res.status(401).send('Unauthorized');
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const isProduction = process.env.NODE_ENV === 'production';

  // Detrás de un balanceador o CDN, `req.ip` es la IP del proxy: el rate
  // limiting contaría a los 30.000 compradores como un solo cliente y el límite
  // de ráfaga cortaría el onsale entero. TRUST_PROXY = número de saltos de
  // proxy delante del API (1 con un solo balanceador), o 'true'/'loopback'.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const hops = Number.parseInt(trustProxy, 10);
    app.getHttpAdapter().getInstance().set('trust proxy', Number.isFinite(hops) ? hops : trustProxy);
  } else if (isProduction) {
    console.warn(
      'TRUST_PROXY no está definido: si el API está detrás de un balanceador, el rate ' +
        'limiting verá una sola IP para todo el tráfico. Define TRUST_PROXY=1 (o los saltos que haya).',
    );
  }

  app.use(
    helmet({
      // API is consumed cross-origin by web/admin/taquilla in local and prod.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS — web :3000/:3010, admin :3001, taquilla :3002 (+ LAN / loopback en dev)
  const configured = (process.env.CORS_ORIGIN ||
    'http://localhost:3000,http://localhost:3010,http://localhost:3001,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3010,http://127.0.0.1:3001,http://127.0.0.1:3002'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (configured.includes('*') || configured.includes(origin)) {
        return callback(null, true);
      }
      // Always allow loopback (web/admin/taquilla may use alternate ports in local).
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return callback(null, true);
      }
      const isDev = process.env.NODE_ENV !== 'production';
      if (
        isDev &&
        (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin) ||
          /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin))
      ) {
        return callback(null, true);
      }
      // Prefer false over Error — Error becomes HTTP 500 via Nest exception filter.
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Channel',
      'X-Cashier-Id',
      'Idempotency-Key',
      'X-Forwarded-For',
    ],
  });

  // Swagger documentation — cerrada por defecto en producción (F2-19).
  // Antes `SwaggerModule.setup` se ejecutaba siempre, publicando el catálogo
  // completo de rutas del API en el despliegue de producción.
  const docsForced = process.env.ENABLE_API_DOCS === 'true';
  const exposeDocs = !isProduction || docsForced;

  const docsUser = process.env.API_DOCS_USER;
  const docsPassword = process.env.API_DOCS_PASSWORD;

  if (exposeDocs && isProduction && (!docsUser || !docsPassword)) {
    // Fallar al arrancar es preferible a publicar el mapa del API sin candado.
    throw new Error(
      'ENABLE_API_DOCS=true en producción exige API_DOCS_USER y API_DOCS_PASSWORD. ' +
        'Define ambos o deja ENABLE_API_DOCS=false.',
    );
  }

  if (exposeDocs) {
    if (docsUser && docsPassword) {
      const guard = docsBasicAuth(docsUser, docsPassword);
      // Un `app.use` por ruta: el prefijo '/api/docs' no cubre '/api/docs-json'.
      for (const path of DOCS_PATHS) app.use(path, guard);
    }

    const config = new DocumentBuilder()
      .setTitle('Boletera Platform API')
      .setDescription(
        'Enterprise Ticketing System - Official API Documentation. Handles discovery, inventory, pricing, orders, payments, fraud detection, resale marketplace, and analytics.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addServer('http://localhost:4000', 'Development')
      .addServer('https://api.boletera.com', 'Production')
      .addTag('Discovery', 'Event search and discovery endpoints')
      .addTag('Inventory', 'Ticket availability and inventory management')
      .addTag('Pricing', 'Dynamic pricing and pricing information')
      .addTag('Orders', 'Order management and transaction processing')
      .addTag('Payments', 'Payment processing and methods')
      .addTag('Resale', 'Secondary market and resale functionality')
      .addTag('Analytics', 'Reporting and analytics endpoints')
      .addTag('Fraud', 'Fraud detection and security')
      .addTag('Admin', 'Admin operations')
      .addTag('Access', 'Venue entry scanning and QR validation')
      .addTag('Tenant', 'Multi-tenant resolution')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.API_PORT || 4000;
  const host = process.env.API_HOST || '0.0.0.0';

  await app.listen(port, host);
  console.log(`Boletera API running on ${host}:${port}`);
  if (exposeDocs) {
    const lock = docsUser && docsPassword ? 'protegida con Basic Auth' : 'sin autenticación';
    console.log(`API Documentation: http://localhost:${port}/api/docs (${lock})`);
  } else {
    console.log('API Documentation: deshabilitada (ENABLE_API_DOCS=false en producción)');
  }
}

void bootstrap().catch((error) => {
  console.error('Bootstrap error:', error);
  process.exit(1);
});


