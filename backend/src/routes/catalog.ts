import { Router } from 'express';
import { SAMPLE_PRODUCTS } from '../../../shared/src/catalogSeed.ts';
import { PICKUP_STATIONS } from '../../../shared/src/pickupStations.ts';
import type { CategoryWithCount } from '../../../shared/src/types.ts';
import type { BackendEnv } from '../config/env.ts';
import type { DataStore } from '../db/store.ts';

export function createCatalogRouter(store: DataStore, env: BackendEnv): Router {
  const router = Router();

  const handleListProducts = async (req: import('express').Request, res: import('express').Response) => {
    try {
      let products = await store.listProducts(false);
      let source: 'database' | 'sample-fallback' = 'database';
      if (products.length === 0) {
        products = SAMPLE_PRODUCTS;
        source = 'sample-fallback';
      }

      const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      if (category && category.toLowerCase() !== 'all') {
        products = products.filter((p) => p.category.toLowerCase() === category.toLowerCase());
      }
      if (q) {
        products = products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q)
        );
      }

      res.json({ products, source });
    } catch {
      res.json({ products: SAMPLE_PRODUCTS, source: 'sample-fallback' });
    }
  };

  router.get('/allproducts', handleListProducts);
  router.get('/api/products', handleListProducts);

  router.get('/api/categories', async (_req, res) => {
    try {
      let products = await store.listProducts(false);
      if (products.length === 0) {
        products = SAMPLE_PRODUCTS;
      }

      const countsByLowerName = new Map<string, number>();
      const fallbackNamesByLower = new Map<string, string>();
      for (const product of products) {
        const clean = product.category.trim();
        if (!clean) continue;
        const key = clean.toLowerCase();
        countsByLowerName.set(key, (countsByLowerName.get(key) || 0) + 1);
        if (!fallbackNamesByLower.has(key)) {
          fallbackNamesByLower.set(key, clean);
        }
      }

      const managed = await store.listCategories();
      const seenLower = new Set<string>();
      const categories: CategoryWithCount[] = [];

      for (const cat of managed) {
        const key = cat.name.trim().toLowerCase();
        seenLower.add(key);
        categories.push({
          ...cat,
          productCount: countsByLowerName.get(key) || 0,
        });
      }

      const now = new Date().toISOString();
      for (const [key, displayName] of fallbackNamesByLower.entries()) {
        if (!seenLower.has(key)) {
          const slug =
            displayName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'category';
          categories.push({
            id: `cat-${slug}`,
            slug,
            name: displayName,
            createdAt: now,
            updatedAt: now,
            productCount: countsByLowerName.get(key) || 0,
          });
        }
      }

      res.json({ categories });
    } catch {
      res.json({ categories: [] });
    }
  });

  router.get('/api/products/:slug', async (req, res) => {
    const slug = String(req.params.slug || '').trim();
    const product =
      (await store.getProductBySlug(slug)) ||
      (await store.getProductById(slug)) ||
      SAMPLE_PRODUCTS.find((p) => p.slug === slug || p.id === slug) ||
      null;

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ product });
  });

  router.get('/api/pickup-stations', (_req, res) => {
    res.json({
      stations: PICKUP_STATIONS,
      mpesaUsdToKesRate: env.mpesaUsdToKesRate,
      mpesaConversionEnabled: Boolean(env.mpesaUsdToKesRate && env.mpesaUsdToKesRate > 0),
    });
  });

  return router;
}
