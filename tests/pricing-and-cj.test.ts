import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadBackendEnv } from '../backend/src/config/env.ts';
import { LocalDataStore } from '../backend/src/db/store.ts';
import { createBackendApp } from '../backend/src/app.ts';
import { convertUsdCentsToKesMinor } from '../backend/src/services/pricing.ts';

describe('Server-side pricing, CJ Dropshipping import, and M-Pesa USD->KES conversion', () => {
  it('computes authoritative cart quotes from DB records and ignores client-supplied prices', async () => {
    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      MPESA_USD_TO_KES_RATE: '130',
    });
    const app = createBackendApp({ store, env });

    const quoteRes = await request(app)
      .post('/api/cart/quote')
      .send({
        items: [
          {
            productId: 'prod-waxed-tote',
            variantSku: 'KRA-TOTE-OLV',
            quantity: 2,
            // Tampered client price should have zero effect
            unitPriceCents: 1,
            totalCents: 1,
          },
        ],
        pickupPoint: { stationId: 'nbo-cbd-hub' },
      });

    expect(quoteRes.status).toBe(200);
    // $145.00 x 2 = $290.00 (29000 cents), free shipping over $150
    expect(quoteRes.body.subtotalCents).toBe(29000);
    expect(quoteRes.body.shippingCents).toBe(0);
    expect(quoteRes.body.totalCents).toBe(29000);
    expect(quoteRes.body.mpesaEstimate.kesWhole).toBe(37700);
  });

  it('requires explicit retail price on CJ import, snapshots supplier cost, and never auto-orders', async () => {
    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      ADMIN_EMAIL: 'admin@kora.test',
      ADMIN_PASSWORD: 'admin-password-123',
    });
    const app = createBackendApp({ store, env });

    const loginRes = await request(app).post('/api/admin/login').send({
      email: 'admin@kora.test',
      password: 'admin-password-123',
    });
    const adminToken = loginRes.body.token;

    const missingPrice = await request(app)
      .post('/admin/cj/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cjProductId: 'CJ-2026-8841' });
    expect(missingPrice.status).toBe(400);

    const imported = await request(app)
      .post('/admin/cj/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cjProductId: 'CJ-2026-8841', retailPriceCents: 4900 });
    expect(imported.status).toBe(201);
    expect(imported.body.product.source).toBe('cj');
    expect(imported.body.product.supplierCostCents).toBe(1450);
    expect(imported.body.product.retailPriceCents).toBe(4900);
    expect(imported.body.policyNotice).toMatch(/not placed automatically/i);
  });

  it('refuses USD-to-KES conversion when MPESA_USD_TO_KES_RATE is unconfigured', async () => {
    expect(() => convertUsdCentsToKesMinor(10000, null)).toThrow(/MPESA_USD_TO_KES_RATE/);

    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      MPESA_USD_TO_KES_RATE: '',
    });
    const app = createBackendApp({ store, env });

    const res = await request(app)
      .post('/api/checkout/mpesa')
      .send({
        customerName: 'Amina Odhiambo',
        email: 'amina@example.com',
        phoneNumber: '0712345678',
        items: [{ productId: 'prod-stoneware-carafe', variantSku: 'KRA-CER-CHK', quantity: 1 }],
        pickupPoint: { stationId: 'nbo-cbd-hub' },
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/MPESA_USD_TO_KES_RATE/i);
  });

  it('allows admin to update product retail price and variant stock via PATCH /api/admin/products/:id', async () => {
    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      ADMIN_EMAIL: 'admin@kora.test',
      ADMIN_PASSWORD: 'admin-password-123',
      MPESA_USD_TO_KES_RATE: '130',
    });
    const app = createBackendApp({ store, env });

    const unauth = await request(app)
      .patch('/api/admin/products/prod-waxed-tote')
      .send({ retailPriceCents: 16000, variants: [{ sku: 'KRA-TOTE-OLV', stock: 42 }] });
    expect(unauth.status).toBe(401);

    const loginRes = await request(app).post('/api/admin/login').send({
      email: 'admin@kora.test',
      password: 'admin-password-123',
    });
    const adminToken = loginRes.body.token;

    const updateRes = await request(app)
      .patch('/api/admin/products/prod-waxed-tote')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        retailPriceCents: 16500,
        variants: [{ sku: 'KRA-TOTE-OLV', stock: 33 }],
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.product.retailPriceCents).toBe(16500);
    expect(
      updateRes.body.product.variants.find((v: { sku: string }) => v.sku === 'KRA-TOTE-OLV').stock
    ).toBe(33);

    // Authoritative quote immediately reflects updated retail price ($165.00 = 16500 cents)
    const quoteRes = await request(app)
      .post('/api/cart/quote')
      .send({
        items: [{ productId: 'prod-waxed-tote', variantSku: 'KRA-TOTE-OLV', quantity: 1 }],
        pickupPoint: { stationId: 'nbo-cbd-hub' },
      });
    expect(quoteRes.status).toBe(200);
    expect(quoteRes.body.subtotalCents).toBe(16500);
  });

  it('supports managed category CRUD with cascade rename, safe delete protection, and customized CJ import', async () => {
    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      ADMIN_EMAIL: 'admin@kora.test',
      ADMIN_PASSWORD: 'admin-password-123',
    });
    const app = createBackendApp({ store, env });

    const loginRes = await request(app).post('/api/admin/login').send({
      email: 'admin@kora.test',
      password: 'admin-password-123',
    });
    const adminToken = loginRes.body.token;

    // 1. Create a managed category and block case-insensitive duplicates
    const createCatRes = await request(app)
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lighting' });
    expect(createCatRes.status).toBe(201);
    const lightingCatId = createCatRes.body.category.id;

    const dupCatRes = await request(app)
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'lighting' });
    expect(dupCatRes.status).toBe(409);

    // 2. Customized CJ import (custom title, category, description, stock overrides, retail price)
    const cjImportRes = await request(app)
      .post('/admin/cj/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        cjProductId: 'CJ-2026-8841',
        name: 'Studio Matte Black Thermos',
        category: 'Lighting',
        description: 'Custom curated storefront copy for dual-wall insulated studio flask.',
        retailPriceCents: 5400,
        variantStocks: { 'CJ-PEN-BLK': 9 },
      });
    expect(cjImportRes.status).toBe(201);
    expect(cjImportRes.body.product.name).toBe('Studio Matte Black Thermos');
    expect(cjImportRes.body.product.category).toBe('Lighting');
    expect(cjImportRes.body.product.description).toMatch(/Custom curated storefront copy/);
    expect(cjImportRes.body.product.variants[0].stock).toBe(9);
    expect(cjImportRes.body.product.supplierCostCents).toBe(1450);

    // 3. Safe delete rejects while active products belong to category
    const blockedDelete = await request(app)
      .delete(`/api/admin/categories/${encodeURIComponent(lightingCatId)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blockedDelete.status).toBe(409);
    expect(blockedDelete.body.productCount).toBe(1);

    // 4. Rename category cascades to assigned products and reflects in public GET /api/categories
    const renameRes = await request(app)
      .patch(`/api/admin/categories/${encodeURIComponent(lightingCatId)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Home Studio' });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.updatedProductCount).toBe(1);

    const publicCats = await request(app).get('/api/categories');
    expect(publicCats.status).toBe(200);
    const homeStudio = publicCats.body.categories.find(
      (c: { name: string }) => c.name === 'Home Studio'
    );
    expect(homeStudio?.productCount).toBe(1);

    // 5. Remove product and confirm empty category can now be deleted
    const removeProd = await request(app)
      .post('/removeproduct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: cjImportRes.body.product.id });
    expect(removeProd.status).toBe(200);

    const allowedDelete = await request(app)
      .delete(`/api/admin/categories/${encodeURIComponent(lightingCatId)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(allowedDelete.status).toBe(200);
  });
});
