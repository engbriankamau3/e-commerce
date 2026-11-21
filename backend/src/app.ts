import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import type { BackendEnv } from './config/env.ts';
import type { DataStore } from './db/store.ts';
import { createAdminRouter } from './routes/admin.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createCartRouter } from './routes/cart.ts';
import { createCatalogRouter } from './routes/catalog.ts';
import { createCheckoutRouter } from './routes/checkout.ts';
import { createOrdersRouter } from './routes/orders.ts';
import { sanitizeNoSqlInput } from './utils/security.ts';

export interface CreateBackendAppOptions {
  store: DataStore;
  env: BackendEnv;
  uploadsDir?: string;
}

export function createBackendApp(options: CreateBackendAppOptions): Express {
  const { store, env } = options;
  const uploadsDir = options.uploadsDir ?? path.resolve(process.cwd(), 'uploads');
  const app = express();

  app.set('trust proxy', 1);

  // Strict CORS allowlist (never wildcard on authenticated endpoints)
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (env.allowedOrigins.includes(origin) || origin === env.appUrl) {
          callback(null, true);
          return;
        }
        // Allow AI Studio preview domains dynamically matching APP_URL host if configured
        try {
          const originHost = new URL(origin).host;
          const appHost = new URL(env.appUrl).host;
          if (originHost === appHost) {
            callback(null, true);
            return;
          }
        } catch {
          // ignore malformed origin
        }
        callback(new Error(`CORS origin not allowed: ${origin}`));
      },
      credentials: true,
    })
  );

  // Preserve raw body for Stripe webhook signature verification
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Block NoSQL operator keys (`$gt`, `__proto__`, etc.) on JSON/urlencoded payloads
  // while leaving rawBody untouched for Stripe webhook HMAC verification.
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      req.body = sanitizeNoSqlInput(req.body);
    }
    next();
  });

  app.use('/uploads', express.static(uploadsDir));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      dbMode: store.mode,
      mpesaConversionEnabled: Boolean(env.mpesaUsdToKesRate && env.mpesaUsdToKesRate > 0),
    });
  });

  app.use(createAuthRouter(store, env));
  app.use(createCatalogRouter(store, env));
  app.use(createCartRouter(store, env));
  app.use(createCheckoutRouter(store, env));
  app.use(createOrdersRouter(store, env));
  app.use(createAdminRouter(store, env, uploadsDir));

  return app;
}
