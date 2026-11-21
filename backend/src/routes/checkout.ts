import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  mpesaCheckoutSchema,
  normalizeKenyanPhone,
  stripeCheckoutSchema,
} from '../../../shared/src/validators.ts';
import type { OrderRecord } from '../../../shared/src/types.ts';
import type { BackendEnv } from '../config/env.ts';
import type { DataStore } from '../db/store.ts';
import { createAuthMiddleware } from '../middleware/auth.ts';
import {
  initiateDarajaStkPush,
  parseMpesaCallbackPayload,
  processMpesaVerification,
  queryDarajaStkStatus,
} from '../services/mpesa.ts';
import {
  convertUsdCentsToKesMinor,
  PricingError,
  resolveAuthoritativeOrderQuote,
} from '../services/pricing.ts';
import { createStripeCheckoutSession, handleStripeWebhookEvent } from '../services/stripe.ts';

function generateOrderReference(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[crypto.randomInt(0, chars.length)];
  }
  return `KRA-${suffix}`;
}

const mpesaQuerySchema = z.object({
  orderReference: z.string().trim().min(4),
});

export function createCheckoutRouter(store: DataStore, env: BackendEnv): Router {
  const router = Router();
  const { optionalUserAuth } = createAuthMiddleware(env.jwtSecret);

  router.post('/api/checkout/stripe', optionalUserAuth, async (req, res) => {
    const parsed = stripeCheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid checkout input' });
      return;
    }

    try {
      const quote = await resolveAuthoritativeOrderQuote({
        store,
        items: parsed.data.items,
        pickupInput: parsed.data.pickupPoint,
        cjApiKey: env.cjApiKey,
      });

      const orderReference = generateOrderReference();
      const now = new Date().toISOString();
      const order: OrderRecord = {
        orderReference,
        email: parsed.data.email,
        customerName: parsed.data.customerName,
        userId: req.authUser?.sub,
        items: quote.items,
        subtotalCents: quote.subtotalCents,
        shippingCents: quote.shippingCents,
        totalCents: quote.totalCents,
        currency: 'USD',
        chargedAmountMinor: quote.totalCents,
        chargedCurrency: 'USD',
        paymentMethod: 'stripe',
        paymentStatus: 'PENDING',
        fulfillmentStatus: 'AWAITING_PAYMENT',
        pickupPoint: quote.pickupPoint,
        providerRefs: {},
        createdAt: now,
        updatedAt: now,
      };

      const successUrl =
        parsed.data.successUrl ||
        `${env.appUrl}/track?order=${encodeURIComponent(orderReference)}&email=${encodeURIComponent(order.email)}&checkout=success`;
      const cancelUrl =
        parsed.data.cancelUrl ||
        `${env.appUrl}/checkout?canceled=1&order=${encodeURIComponent(orderReference)}`;

      const session = await createStripeCheckoutSession({
        order,
        env,
        successUrl,
        cancelUrl,
      });

      order.providerRefs.stripeSessionId = session.sessionId;
      await store.createOrder(order);
      await store.recordPaymentAttempt({
        id: `pa-${crypto.randomUUID()}`,
        orderReference,
        provider: 'stripe',
        expectedAmountMinor: order.chargedAmountMinor,
        expectedCurrency: 'USD',
        status: 'INITIATED',
        message: `Created Stripe Checkout session ${session.sessionId}`,
        createdAt: now,
      });

      res.status(201).json({
        orderReference,
        sessionId: session.sessionId,
        checkoutUrl: session.checkoutUrl,
        totalCents: order.totalCents,
        currency: order.currency,
        paymentStatus: order.paymentStatus,
      });
    } catch (err) {
      if (err instanceof PricingError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const message = (err as Error).message || 'Unable to initiate Stripe Checkout';
      const status = message.includes('not configured') ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/checkout/mpesa', optionalUserAuth, async (req, res) => {
    const parsed = mpesaCheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid M-Pesa checkout input' });
      return;
    }

    try {
      const quote = await resolveAuthoritativeOrderQuote({
        store,
        items: parsed.data.items,
        pickupInput: parsed.data.pickupPoint,
        cjApiKey: env.cjApiKey,
      });

      const kes = convertUsdCentsToKesMinor(quote.totalCents, env.mpesaUsdToKesRate);
      const phone = normalizeKenyanPhone(parsed.data.phoneNumber);
      const orderReference = generateOrderReference();
      const now = new Date().toISOString();

      const stk = await initiateDarajaStkPush({
        env,
        orderReference,
        phoneNumber: phone,
        amountKesWhole: kes.kesWhole,
      });

      const order: OrderRecord = {
        orderReference,
        email: parsed.data.email,
        customerName: parsed.data.customerName,
        userId: req.authUser?.sub,
        items: quote.items,
        subtotalCents: quote.subtotalCents,
        shippingCents: quote.shippingCents,
        totalCents: quote.totalCents,
        currency: 'USD',
        chargedAmountMinor: kes.kesMinor,
        chargedCurrency: 'KES',
        paymentMethod: 'mpesa',
        paymentStatus: 'PENDING',
        fulfillmentStatus: 'AWAITING_PAYMENT',
        pickupPoint: quote.pickupPoint,
        providerRefs: {
          mpesaCheckoutRequestId: stk.checkoutRequestId,
          mpesaMerchantRequestId: stk.merchantRequestId,
          mpesaPhoneNumber: phone,
        },
        createdAt: now,
        updatedAt: now,
      };

      await store.createOrder(order);
      await store.recordPaymentAttempt({
        id: `pa-${crypto.randomUUID()}`,
        orderReference,
        provider: 'mpesa',
        expectedAmountMinor: kes.kesMinor,
        expectedCurrency: 'KES',
        status: 'INITIATED',
        message: `STK Push initiated (CheckoutRequestID=${stk.checkoutRequestId}, rate=${kes.rate})`,
        createdAt: now,
      });

      res.status(201).json({
        orderReference,
        checkoutRequestId: stk.checkoutRequestId,
        customerMessage: stk.customerMessage,
        amountKesWhole: kes.kesWhole,
        usdToKesRate: kes.rate,
        totalUsdCents: order.totalCents,
        paymentStatus: order.paymentStatus,
      });
    } catch (err) {
      if (err instanceof PricingError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const message = (err as Error).message || 'Unable to initiate M-Pesa STK Push';
      const status = message.includes('not configured') ? 503 : 502;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/payments/stripe/webhook', async (req, res) => {
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? req.body;
    const signature = req.header('stripe-signature');

    try {
      const result = await handleStripeWebhookEvent({
        rawBody,
        signature,
        env,
        store,
      });
      res.json({ received: true, ...result });
    } catch (err) {
      const message = (err as Error).message || 'Webhook signature verification failed';
      const status = message.includes('not configured') ? 503 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/payments/mpesa/callback', async (req, res) => {
    const parsed = parseMpesaCallbackPayload(req.body);
    if (!parsed) {
      res.status(400).json({ error: 'Invalid M-Pesa callback payload' });
      return;
    }

    const result = await processMpesaVerification({ parsed, store });
    if (!result.found) {
      res.status(404).json({ ResultCode: 1, ResultDesc: result.message });
      return;
    }

    res.json({
      ResultCode: 0,
      ResultDesc: 'Accepted',
      orderReference: result.orderReference,
      paymentStatus: result.paymentStatus,
      message: result.message,
    });
  });

  router.post('/api/payments/mpesa/query', async (req, res) => {
    const parsed = mpesaQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'orderReference is required' });
      return;
    }

    const order = await store.getOrderByReference(parsed.data.orderReference);
    if (!order || order.paymentMethod !== 'mpesa' || !order.providerRefs.mpesaCheckoutRequestId) {
      res.status(404).json({ error: 'M-Pesa order not found' });
      return;
    }

    if (order.paymentStatus === 'PAID') {
      res.json({
        orderReference: order.orderReference,
        paymentStatus: order.paymentStatus,
        message: 'Payment already verified',
      });
      return;
    }

    try {
      const queryResult = await queryDarajaStkStatus({
        env,
        checkoutRequestId: order.providerRefs.mpesaCheckoutRequestId,
      });
      const verification = await processMpesaVerification({
        parsed: {
          checkoutRequestId: order.providerRefs.mpesaCheckoutRequestId,
          resultCode: queryResult.resultCode,
          resultDesc: queryResult.resultDesc,
          amountKesWhole:
            queryResult.resultCode === 0 ? Math.round(order.chargedAmountMinor / 100) : undefined,
        },
        store,
      });
      res.json(verification);
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
    }
  });

  return router;
}
