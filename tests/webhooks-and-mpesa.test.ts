import { describe, expect, it } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { loadBackendEnv } from '../backend/src/config/env.ts';
import { LocalDataStore } from '../backend/src/db/store.ts';
import { createBackendApp } from '../backend/src/app.ts';
import type { OrderRecord } from '../shared/src/types.ts';

function buildPendingOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const now = new Date().toISOString();
  return {
    orderReference: 'KRA-TEST01',
    email: 'amina@example.com',
    customerName: 'Amina Odhiambo',
    items: [
      {
        productId: 'prod-stoneware-carafe',
        name: 'Kiln Stoneware Pour-Over Set',
        variantSku: 'KRA-CER-CHK',
        variantLabel: 'Chalk Matte (500ml)',
        image: '/src/assets/images/prod_ceramic_carafe_1795286029988.jpg',
        quantity: 1,
        unitPriceCents: 7800,
        lineTotalCents: 7800,
      },
    ],
    subtotalCents: 7800,
    shippingCents: 0,
    totalCents: 7800,
    currency: 'USD',
    chargedAmountMinor: 7800,
    chargedCurrency: 'USD',
    paymentMethod: 'stripe',
    paymentStatus: 'PENDING',
    fulfillmentStatus: 'AWAITING_PAYMENT',
    pickupPoint: {
      stationId: 'nbo-cbd-hub',
      stationName: 'Kora Nairobi CBD Locker',
      area: 'Kimathi Street, Nairobi',
      updatedAt: now,
    },
    providerRefs: {
      stripeSessionId: 'cs_test_123',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Stripe webhook signature verification & M-Pesa Daraja callback handling', () => {
  it('verifies Stripe signature, rejects amount mismatch, and marks PAID only on exact match', async () => {
    const webhookSecret = 'whsec_test_secret_123456';
    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    });
    const app = createBackendApp({ store, env });

    await store.createOrder(buildPendingOrder());

    const stripe = new Stripe('sk_test_dummy');

    // 1. Invalid signature must be rejected
    const badRes = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('stripe-signature', 't=123,v1=invalid')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed' }));
    expect(badRes.status).toBe(400);

    // 2. Tampered/mismatched amount must NOT mark order PAID
    const mismatchPayload = JSON.stringify({
      id: 'evt_mismatch',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 100,
          currency: 'usd',
          metadata: { orderReference: 'KRA-TEST01' },
        },
      },
    });
    const mismatchSig = stripe.webhooks.generateTestHeaderString({
      payload: mismatchPayload,
      secret: webhookSecret,
    });
    const mismatchRes = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('stripe-signature', mismatchSig)
      .set('Content-Type', 'application/json')
      .send(mismatchPayload);
    expect(mismatchRes.status).toBe(200);
    expect((await store.getOrderByReference('KRA-TEST01'))!.paymentStatus).toBe('PENDING');

    // 3. Valid exact-amount webhook transitions order to PAID + PROCESSING
    const validPayload = JSON.stringify({
      id: 'evt_valid',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 7800,
          currency: 'usd',
          payment_intent: 'pi_test_999',
          metadata: { orderReference: 'KRA-TEST01' },
        },
      },
    });
    const validSig = stripe.webhooks.generateTestHeaderString({
      payload: validPayload,
      secret: webhookSecret,
    });
    const validRes = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('stripe-signature', validSig)
      .set('Content-Type', 'application/json')
      .send(validPayload);
    expect(validRes.status).toBe(200);

    const paidOrder = await store.getOrderByReference('KRA-TEST01');
    expect(paidOrder!.paymentStatus).toBe('PAID');
    expect(paidOrder!.fulfillmentStatus).toBe('PROCESSING');
  });

  it('handles M-Pesa Daraja JSON and form-encoded callbacks, enforcing exact KES match', async () => {
    const store = new LocalDataStore({ persistFile: null });
    const env = loadBackendEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      MPESA_USD_TO_KES_RATE: '130',
    });
    const app = createBackendApp({ store, env });

    // Order for $10.00 = KES 1,300 (130000 minor)
    await store.createOrder(
      buildPendingOrder({
        orderReference: 'KRA-MP01',
        totalCents: 1000,
        chargedAmountMinor: 130000,
        chargedCurrency: 'KES',
        paymentMethod: 'mpesa',
        providerRefs: {
          mpesaCheckoutRequestId: 'ws_CO_TEST_001',
        },
      })
    );

    // 1. Mismatched KES amount via JSON callback leaves order PENDING
    const mismatchCb = await request(app)
      .post('/api/payments/mpesa/callback')
      .send({
        Body: {
          stkCallback: {
            CheckoutRequestID: 'ws_CO_TEST_001',
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 500 },
                { Name: 'MpesaReceiptNumber', Value: 'BAD0001' },
              ],
            },
          },
        },
      });
    expect(mismatchCb.status).toBe(200);
    expect((await store.getOrderByReference('KRA-MP01'))!.paymentStatus).toBe('PENDING');

    // 2. Exact KES amount via form-encoded callback marks order PAID
    const formRes = await request(app)
      .post('/api/payments/mpesa/callback')
      .type('form')
      .send({
        CheckoutRequestID: 'ws_CO_TEST_001',
        ResultCode: '0',
        ResultDesc: 'Success',
        Amount: '1300',
        MpesaReceiptNumber: 'UAH9281XYZ',
        PhoneNumber: '254712345678',
      });
    expect(formRes.status).toBe(200);

    const updated = await store.getOrderByReference('KRA-MP01');
    expect(updated!.paymentStatus).toBe('PAID');
    expect(updated!.fulfillmentStatus).toBe('PROCESSING');
    expect(updated!.providerRefs.mpesaReceiptNumber).toBe('UAH9281XYZ');

    // 3. Non-zero ResultCode on a pending order marks it FAILED
    await store.createOrder(
      buildPendingOrder({
        orderReference: 'KRA-MP02',
        totalCents: 1000,
        chargedAmountMinor: 130000,
        chargedCurrency: 'KES',
        paymentMethod: 'mpesa',
        providerRefs: {
          mpesaCheckoutRequestId: 'ws_CO_TEST_002',
        },
      })
    );
    const failCb = await request(app)
      .post('/api/payments/mpesa/callback')
      .send({
        Body: {
          stkCallback: {
            CheckoutRequestID: 'ws_CO_TEST_002',
            ResultCode: 1032,
            ResultDesc: 'Request cancelled by user',
          },
        },
      });
    expect(failCb.status).toBe(200);
    expect((await store.getOrderByReference('KRA-MP02'))!.paymentStatus).toBe('FAILED');
  });
});
