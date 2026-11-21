import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  bulkUpdateOrderStatusSchema,
  cjImportSchema,
  createCategorySchema,
  createProductSchema,
  renameCategorySchema,
  updateOrderStatusSchema,
  updateProductInventorySchema,
} from '../../../shared/src/validators.ts';
import type { CategoryWithCount, Product } from '../../../shared/src/types.ts';
import type { BackendEnv } from '../config/env.ts';
import type { DataStore } from '../db/store.ts';
import { createAuthMiddleware } from '../middleware/auth.ts';
import { getCjCatalogItemById, searchCjCatalog } from '../services/cj.ts';
import {
  runLiveEnvDiagnostics,
  verifyDarajaSandboxAuthorization,
} from '../services/diagnostics.ts';

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || `item-${Date.now()}`
  );
}

const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function createAdminRouter(
  store: DataStore,
  env: BackendEnv,
  uploadsDir: string
): Router {
  const router = Router();
  const { requireAdminAuth } = createAuthMiddleware(env.jwtSecret);

  fs.mkdirSync(uploadsDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ALLOWED_IMAGE_EXT.has(ext) ? ext : '.jpg';
        cb(null, `prod-${crypto.randomUUID()}${safeExt}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_IMAGE_EXT.has(ext)) {
        cb(new Error('Only .jpg, .jpeg, .png, and .webp image files are allowed'));
        return;
      }
      cb(null, true);
    },
  });

  const handleAddProduct = async (req: import('express').Request, res: import('express').Response) => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid product payload' });
      return;
    }

    const now = new Date().toISOString();
    const id = `prod-${crypto.randomUUID().slice(0, 8)}`;
    const slug = `${slugify(parsed.data.name)}-${id.slice(-4)}`;
    const product: Product = {
      id,
      slug,
      name: parsed.data.name,
      category: parsed.data.category,
      description: parsed.data.description,
      images: parsed.data.images,
      currency: 'USD',
      retailPriceCents: parsed.data.retailPriceCents,
      variants: parsed.data.variants,
      source: 'manual',
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await store.ensureCategory(parsed.data.category);
    await store.upsertProduct(product);
    res.status(201).json({ product });
  };

  router.post('/addproduct', requireAdminAuth, handleAddProduct);
  router.post('/api/admin/products', requireAdminAuth, handleAddProduct);

  router.get('/api/admin/categories', requireAdminAuth, async (_req, res) => {
    const activeProducts = await store.listProducts(false);
    const countsByLower = new Map<string, number>();
    for (const p of activeProducts) {
      const clean = p.category.trim();
      if (!clean) continue;
      await store.ensureCategory(clean);
      const key = clean.toLowerCase();
      countsByLower.set(key, (countsByLower.get(key) || 0) + 1);
    }

    const categories = await store.listCategories();
    const withCounts: CategoryWithCount[] = categories.map((cat) => ({
      ...cat,
      productCount: countsByLower.get(cat.name.trim().toLowerCase()) || 0,
    }));
    res.json({ categories: withCounts });
  });

  router.post('/api/admin/categories', requireAdminAuth, async (req, res) => {
    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid category name' });
      return;
    }

    const result = await store.createCategory(parsed.data.name);
    if (!result.created) {
      res.status(409).json({
        error: `Category "${result.category.name}" already exists.`,
      });
      return;
    }

    const activeProducts = await store.listProducts(false);
    const productCount = activeProducts.filter(
      (p) => p.category.trim().toLowerCase() === result.category.name.toLowerCase()
    ).length;

    res.status(201).json({ category: { ...result.category, productCount } });
  });

  router.patch('/api/admin/categories/:id', requireAdminAuth, async (req, res) => {
    const parsed = renameCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid category name' });
      return;
    }

    const result = await store.renameCategory(String(req.params.id || ''), parsed.data.name);
    if (!result) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    if (result.conflict) {
      res.status(409).json({
        error: `Category "${parsed.data.name}" already exists.`,
      });
      return;
    }

    res.json({
      category: result.category,
      updatedProductCount: result.updatedProductCount,
    });
  });

  router.delete('/api/admin/categories/:id', requireAdminAuth, async (req, res) => {
    const result = await store.deleteCategory(String(req.params.id || ''));
    if (result.notFound) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    if (!result.deleted) {
      res.status(409).json({
        error: `Cannot delete category because ${result.productCount} active product(s) are assigned to it.`,
        productCount: result.productCount,
      });
      return;
    }

    res.json({ deleted: true, id: String(req.params.id || '') });
  });

  router.patch('/api/admin/products/:id', requireAdminAuth, async (req, res) => {
    const parsed = updateProductInventorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid product price or stock payload',
      });
      return;
    }

    const existing = await store.getProductById(String(req.params.id || ''));
    if (!existing || !existing.active) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const existingSkus = new Set(existing.variants.map((v) => v.sku));
    for (const v of parsed.data.variants) {
      if (!existingSkus.has(v.sku)) {
        res.status(400).json({ error: `Unknown variant SKU: ${v.sku}` });
        return;
      }
    }

    if (parsed.data.category) {
      await store.ensureCategory(parsed.data.category);
    }

    const stockBySku = new Map(parsed.data.variants.map((v) => [v.sku, v.stock]));
    const updatedProduct: Product = {
      ...existing,
      category: parsed.data.category ?? existing.category,
      retailPriceCents: parsed.data.retailPriceCents,
      variants: existing.variants.map((v) => ({
        ...v,
        stock: stockBySku.has(v.sku) ? stockBySku.get(v.sku)! : v.stock,
      })),
      updatedAt: new Date().toISOString(),
    };

    await store.upsertProduct(updatedProduct);
    res.json({ product: updatedProduct });
  });

  const removeSchema = z.object({
    id: z.string().trim().min(1, 'Product id is required'),
  });

  const handleRemoveProduct = async (req: import('express').Request, res: import('express').Response) => {
    const parsed = removeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Product id is required' });
      return;
    }

    const removed = await store.deactivateProduct(parsed.data.id);
    if (!removed) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ success: true, id: parsed.data.id });
  };

  router.post('/removeproduct', requireAdminAuth, handleRemoveProduct);
  router.post('/api/admin/products/remove', requireAdminAuth, handleRemoveProduct);

  const handleUpload = (req: import('express').Request, res: import('express').Response) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: (err as Error).message || 'Upload failed' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No image file provided (expected field "image")' });
        return;
      }
      // Verify file path remains strictly inside uploadsDir
      const resolved = path.resolve(uploadsDir, req.file.filename);
      const baseWithSep = path.resolve(uploadsDir) + path.sep;
      if (!resolved.startsWith(baseWithSep)) {
        res.status(400).json({ error: 'Invalid upload path' });
        return;
      }
      res.status(201).json({
        success: true,
        imageUrl: `/uploads/${req.file.filename}`,
      });
    });
  };

  router.post('/upload', requireAdminAuth, handleUpload);
  router.post('/api/admin/upload', requireAdminAuth, handleUpload);

  router.get('/admin/cj/products', requireAdminAuth, async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    try {
      const result = await searchCjCatalog(query, env.cjApiKey);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message || 'CJ search failed' });
    }
  });

  router.post('/admin/cj/import', requireAdminAuth, async (req, res) => {
    const parsed = cjImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Explicit retailPriceCents and cjProductId are required',
      });
      return;
    }

    try {
      const cjItem = await getCjCatalogItemById(parsed.data.cjProductId, env.cjApiKey);
      if (!cjItem) {
        res.status(404).json({ error: 'CJ product not found' });
        return;
      }

      const now = new Date().toISOString();
      const id = `prod-cj-${crypto.randomUUID().slice(0, 8)}`;
      const name = parsed.data.name || cjItem.name;
      const category = parsed.data.category || cjItem.category;
      const description = parsed.data.description || cjItem.description;
      const variantStocks = parsed.data.variantStocks || {};

      await store.ensureCategory(category);

      const product: Product = {
        id,
        slug: `${slugify(name)}-${id.slice(-4)}`,
        name,
        category,
        description,
        images: [cjItem.image],
        currency: 'USD',
        retailPriceCents: parsed.data.retailPriceCents,
        supplierCostCents: cjItem.supplierCostCents,
        variants: cjItem.variants.map((v) => ({
          sku: v.sku,
          label: v.label,
          stock:
            typeof variantStocks[v.sku] === 'number' && variantStocks[v.sku] >= 0
              ? variantStocks[v.sku]
              : v.stock,
          supplierCostCents: v.supplierCostCents,
          cjVariantId: v.cjVariantId,
        })),
        source: 'cj',
        cjProductId: cjItem.cjProductId,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      await store.upsertProduct(product);
      res.status(201).json({
        product,
        policyNotice:
          'Imported with supplier cost snapshot. Supplier orders are not placed automatically.',
      });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message || 'CJ import failed' });
    }
  });

  router.get('/admin/orders/paid', requireAdminAuth, async (_req, res) => {
    const orders = await store.listOrders({ paymentStatus: 'PAID' });
    res.json({ orders });
  });

  router.get('/admin/orders', requireAdminAuth, async (req, res) => {
    const status = typeof req.query.paymentStatus === 'string' ? req.query.paymentStatus : undefined;
    const orders = await store.listOrders(status ? { paymentStatus: status } : undefined);
    res.json({ orders });
  });

  router.patch('/admin/orders/bulk-status', requireAdminAuth, async (req, res) => {
    const parsed = bulkUpdateOrderStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid bulk order status payload',
      });
      return;
    }

    const uniqueRefs = Array.from(new Set(parsed.data.orderReferences));
    const updatedOrders = [];
    const skipped: Array<{ orderReference: string; reason: string }> = [];

    for (const ref of uniqueRefs) {
      const order = await store.getOrderByReference(ref);
      if (!order) {
        skipped.push({ orderReference: ref, reason: 'Order not found' });
        continue;
      }
      if (order.paymentStatus !== 'PAID' && parsed.data.fulfillmentStatus !== 'AWAITING_PAYMENT') {
        skipped.push({
          orderReference: ref,
          reason: 'Cannot advance fulfillment before payment is verified as PAID',
        });
        continue;
      }

      order.fulfillmentStatus = parsed.data.fulfillmentStatus;
      order.updatedAt = new Date().toISOString();
      await store.updateOrder(order);
      updatedOrders.push(order);
    }

    if (updatedOrders.length === 0 && skipped.length > 0) {
      const hasUnpaid = skipped.some((s) => s.reason.includes('PAID'));
      res.status(hasUnpaid ? 409 : 404).json({
        error: skipped[0].reason,
        updatedCount: 0,
        skipped,
      });
      return;
    }

    res.json({
      updatedCount: updatedOrders.length,
      orders: updatedOrders,
      skipped,
    });
  });

  router.patch('/admin/orders/:orderReference/status', requireAdminAuth, async (req, res) => {
    const parsed = updateOrderStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid fulfillment status' });
      return;
    }

    const order = await store.getOrderByReference(String(req.params.orderReference || ''));
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    if (order.paymentStatus !== 'PAID' && parsed.data.fulfillmentStatus !== 'AWAITING_PAYMENT') {
      res.status(409).json({
        error: 'Cannot advance fulfillment before payment is verified as PAID',
      });
      return;
    }

    order.fulfillmentStatus = parsed.data.fulfillmentStatus;
    order.updatedAt = new Date().toISOString();
    await store.updateOrder(order);
    res.json({ order });
  });

  router.get('/admin/diagnostics', requireAdminAuth, async (_req, res) => {
    const entries = await runLiveEnvDiagnostics(env);
    res.json({ dbMode: store.mode, entries });
  });

  router.post('/admin/diagnostics/daraja-sandbox', requireAdminAuth, async (_req, res) => {
    const result = await verifyDarajaSandboxAuthorization(env);
    res.json(result);
  });

  return router;
}
