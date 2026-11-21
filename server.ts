import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { loadBackendEnv } from './backend/src/config/env.ts';
import { createDataStore } from './backend/src/db/store.ts';
import { createBackendApp } from './backend/src/app.ts';

async function startUnifiedServer() {
  const env = loadBackendEnv();
  const store = await createDataStore(env.mongodbUri);
  const app = createBackendApp({ store, env });

  const rootDir = process.cwd();
  const imagesDir = path.resolve(rootDir, 'src', 'assets', 'images');
  const frontendDistDir = path.resolve(rootDir, 'frontend', 'dist');
  const adminDir = path.resolve(rootDir, 'admin');
  const adminDistDir = path.resolve(adminDir, 'dist');

  // Serve generated studio product & hero imagery
  if (fs.existsSync(imagesDir)) {
    app.use('/src/assets/images', express.static(imagesDir));
  }

  // Mount Admin SPA (/admin)
  if (env.nodeEnv !== 'production') {
    const adminVite = await createViteServer({
      root: adminDir,
      configFile: path.resolve(adminDir, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use('/admin', adminVite.middlewares);
  } else if (fs.existsSync(adminDistDir)) {
    app.use('/admin', express.static(adminDistDir));
    app.get(/^\/admin(?:\/.*)?$/, (_req, res) => {
      res.sendFile(path.join(adminDistDir, 'index.html'));
    });
  }

  // Serve Astro static build for Storefront (/, /checkout, /track, /account)
  // In dev mode when ASTRO_DEV_PROXY=true, proxy storefront traffic to Astro dev server on 4321
  if (env.nodeEnv !== 'production' && process.env.ASTRO_DEV_PROXY === 'true') {
    app.use((req, res, next) => {
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/admin') ||
        req.path.startsWith('/uploads') ||
        req.path.startsWith('/allproducts') ||
        req.path.startsWith('/addproduct') ||
        req.path.startsWith('/removeproduct') ||
        req.path.startsWith('/upload') ||
        req.path.startsWith('/auth')
      ) {
        next();
        return;
      }

      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: 4321,
          path: req.originalUrl,
          method: req.method,
          headers: req.headers,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', () => next());
      req.pipe(proxyReq);
    });
  }

  if (fs.existsSync(frontendDistDir)) {
    app.use(express.static(frontendDistDir, { extensions: ['html'], redirect: false }));
    app.get(/^(?!\/(?:api|admin|uploads)\b).*/, (req, res, next) => {
      const cleanPath = req.path.replace(/^\/+|\/+$/g, '');
      const candidates = cleanPath
        ? [
            path.join(frontendDistDir, cleanPath, 'index.html'),
            path.join(frontendDistDir, `${cleanPath}.html`),
            path.join(frontendDistDir, 'index.html'),
          ]
        : [path.join(frontendDistDir, 'index.html')];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          res.sendFile(candidate);
          return;
        }
      }
      next();
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(503)
        .send('Storefront build not found. Run "npm run build" to generate frontend/dist.');
    });
  }

  app.listen(env.port, '0.0.0.0', () => {
    console.log(
      `[kora-platform] Unified gateway running on http://0.0.0.0:${env.port} (db: ${store.mode}, env: ${env.nodeEnv})`
    );
  });
}

startUnifiedServer().catch((err) => {
  console.error('[kora-platform] Fatal startup error:', err);
  process.exit(1);
});
