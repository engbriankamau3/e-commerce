import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadBackendEnv } from '../backend/src/config/env.ts';
import { LocalDataStore } from '../backend/src/db/store.ts';
import { createBackendApp } from '../backend/src/app.ts';
import { isOrderCreatedWithinRange } from '../admin/src/components/DateRangePicker.tsx';

describe('Order tracking (/track) and customer pickup point lock lifecycle', () => {
  it('allows customer pickup updates while PROCESSING and locks them once READY_FOR_PICKUP', async () => {
    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      ADMIN_EMAIL: 'admin@kora.test',
      ADMIN_PASSWORD: 'admin-password-123',
    });
    const app = createBackendApp({ store, env });

    const now = new Date().toISOString();
    await store.createOrder({
      orderReference: 'KRA-TRK1',
      email: 'amina@example.com',
      customerName: 'Amina Odhiambo',
      items: [],
      subtotalCents: 14500,
      shippingCents: 0,
      totalCents: 14500,
      currency: 'USD',
      chargedAmountMinor: 14500,
      chargedCurrency: 'USD',
      paymentMethod: 'stripe',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'PROCESSING',
      pickupPoint: {
        stationId: 'nbo-cbd-hub',
        stationName: 'Kora Nairobi CBD Locker',
        area: 'Kimathi Street, Nairobi',
        updatedAt: now,
      },
      providerRefs: {},
      createdAt: now,
      updatedAt: now,
    });

    // Lookup succeeds with matching orderReference + email
    const lookupRes = await request(app)
      .post('/api/orders/track')
      .send({ orderReference: 'KRA-TRK1', email: 'amina@example.com' });
    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body.order.pickupEditable).toBe(true);

    // Wrong email returns 404
    const wrongEmail = await request(app)
      .post('/api/orders/track')
      .send({ orderReference: 'KRA-TRK1', email: 'other@example.com' });
    expect(wrongEmail.status).toBe(404);

    // Customer updates pickup station while PROCESSING
    const patchRes = await request(app)
      .patch('/api/orders/track/pickup')
      .send({
        orderReference: 'KRA-TRK1',
        email: 'amina@example.com',
        pickupPoint: {
          stationId: 'nbo-westlands',
          area: 'Sarit Centre Desk',
          notes: 'Collect at 5pm',
        },
      });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.order.pickupPoint.stationId).toBe('nbo-westlands');

    // Admin advances order to READY_FOR_PICKUP
    const adminLogin = await request(app).post('/api/admin/login').send({
      email: 'admin@kora.test',
      password: 'admin-password-123',
    });
    const statusRes = await request(app)
      .patch('/admin/orders/KRA-TRK1/status')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({ fulfillmentStatus: 'READY_FOR_PICKUP' });
    expect(statusRes.status).toBe(200);

    // Subsequent customer pickup edit is blocked with 409 Conflict
    const lockedPatch = await request(app)
      .patch('/api/orders/track/pickup')
      .send({
        orderReference: 'KRA-TRK1',
        email: 'amina@example.com',
        pickupPoint: {
          stationId: 'nbo-kilimani',
        },
      });
    expect(lockedPatch.status).toBe(409);
    expect(lockedPatch.body.error).toMatch(/READY FOR PICKUP/i);
  });

  it('allows admin bulk fulfillment status updates for PAID orders while skipping unpaid orders', async () => {
    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      ADMIN_EMAIL: 'admin@kora.test',
      ADMIN_PASSWORD: 'admin-password-123',
    });
    const app = createBackendApp({ store, env });
    const now = new Date().toISOString();

    const makeOrder = (ref: string, paymentStatus: 'PAID' | 'PENDING') => ({
      orderReference: ref,
      email: `${ref.toLowerCase()}@example.com`,
      customerName: `Customer ${ref}`,
      items: [],
      subtotalCents: 5000,
      shippingCents: 0,
      totalCents: 5000,
      currency: 'USD' as const,
      chargedAmountMinor: 5000,
      chargedCurrency: 'USD' as const,
      paymentMethod: 'stripe' as const,
      paymentStatus,
      fulfillmentStatus:
        paymentStatus === 'PAID' ? ('PROCESSING' as const) : ('AWAITING_PAYMENT' as const),
      pickupPoint: {
        stationId: 'nbo-cbd-hub',
        stationName: 'Kora Nairobi CBD Locker',
        area: 'Kimathi Street, Nairobi',
        updatedAt: now,
      },
      providerRefs: {},
      createdAt: now,
      updatedAt: now,
    });

    await store.createOrder(makeOrder('KRA-BLK1', 'PAID'));
    await store.createOrder(makeOrder('KRA-BLK2', 'PAID'));
    await store.createOrder(makeOrder('KRA-BLK3', 'PENDING'));

    const unauth = await request(app)
      .patch('/admin/orders/bulk-status')
      .send({ orderReferences: ['KRA-BLK1'], fulfillmentStatus: 'DISPATCHED' });
    expect(unauth.status).toBe(401);

    const adminLogin = await request(app).post('/api/admin/login').send({
      email: 'admin@kora.test',
      password: 'admin-password-123',
    });

    const bulkRes = await request(app)
      .patch('/admin/orders/bulk-status')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({
        orderReferences: ['KRA-BLK1', 'KRA-BLK2', 'KRA-BLK3'],
        fulfillmentStatus: 'DISPATCHED',
      });

    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.updatedCount).toBe(2);
    expect(bulkRes.body.skipped).toHaveLength(1);
    expect((await store.getOrderByReference('KRA-BLK1'))!.fulfillmentStatus).toBe('DISPATCHED');
    expect((await store.getOrderByReference('KRA-BLK2'))!.fulfillmentStatus).toBe('DISPATCHED');
    expect((await store.getOrderByReference('KRA-BLK3'))!.fulfillmentStatus).toBe(
      'AWAITING_PAYMENT'
    );
  });

  it('filters orders accurately by inclusive local creation date range', () => {
    const midDayIso = new Date(2026, 10, 15, 14, 30, 0).toISOString();
    const startBoundaryIso = new Date(2026, 10, 15, 0, 0, 0, 0).toISOString();
    const endBoundaryIso = new Date(2026, 10, 17, 23, 59, 59, 999).toISOString();
    const beforeRangeIso = new Date(2026, 10, 14, 23, 59, 59, 999).toISOString();
    const afterRangeIso = new Date(2026, 10, 18, 0, 0, 0, 0).toISOString();

    const range = { from: '2026-11-15', to: '2026-11-17' };
    expect(isOrderCreatedWithinRange(midDayIso, range)).toBe(true);
    expect(isOrderCreatedWithinRange(startBoundaryIso, range)).toBe(true);
    expect(isOrderCreatedWithinRange(endBoundaryIso, range)).toBe(true);
    expect(isOrderCreatedWithinRange(beforeRangeIso, range)).toBe(false);
    expect(isOrderCreatedWithinRange(afterRangeIso, range)).toBe(false);

    expect(isOrderCreatedWithinRange(beforeRangeIso, { from: '', to: '2026-11-15' })).toBe(true);
    expect(isOrderCreatedWithinRange(afterRangeIso, { from: '2026-11-18', to: '' })).toBe(true);
    expect(isOrderCreatedWithinRange(midDayIso, { from: '', to: '' })).toBe(true);
  });
});
