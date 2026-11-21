import crypto from 'node:crypto';
import Stripe from 'stripe';
import type { OrderRecord } from '../../../shared/src/types.ts';
import type { BackendEnv } from '../config/env.ts';
import type { DataStore } from '../db/store.ts';

export async function createStripeCheckoutSession(options: {
  order: OrderRecord;
  env: BackendEnv;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ sessionId: string; checkoutUrl: string }> {
  const { order, env, successUrl, cancelUrl } = options;

  if (!env.stripeSecretKey) {
    throw new Error('Stripe is not configured on this server (STRIPE_SECRET_KEY missing)');
  }

  const stripe = new Stripe(env.stripeSecretKey);
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map((item) => ({
    price_data: {
      currency: order.chargedCurrency.toLowerCase(),
      product_data: {
        name: `${item.name} (${item.variantLabel})`,
      },
      unit_amount: item.unitPriceCents,
    },
    quantity: item.quantity,
  }));

  if (order.shippingCents > 0) {
    lineItems.push({
      price_data: {
        currency: order.chargedCurrency.toLowerCase(),
        product_data: {
          name: `Pickup Dispatch (${order.pickupPoint.stationName})`,
        },
        unit_amount: order.shippingCents,
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: order.email,
    client_reference_id: order.orderReference,
    metadata: {
      orderReference: order.orderReference,
    },
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  return {
    sessionId: session.id,
    checkoutUrl: session.url,
  };
}

export interface StripeWebhookResult {
  handled: boolean;
  orderReference?: string;
  paymentStatus?: string;
  reason?: string;
}

export async function handleStripeWebhookEvent(options: {
  rawBody: Buffer | string;
  signature: string | undefined;
  env: BackendEnv;
  store: DataStore;
}): Promise<StripeWebhookResult> {
  const { rawBody, signature, env, store } = options;

  if (!env.stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  if (!signature) {
    throw new Error('Missing Stripe-Signature header');
  }

  // Construct Stripe client with placeholder key if only verifying webhook signatures in tests
  const stripe = new Stripe(env.stripeSecretKey || 'sk_test_webhook_verify_only');
  const event = stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);

  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded' &&
    event.type !== 'checkout.session.async_payment_failed' &&
    event.type !== 'checkout.session.expired'
  ) {
    return { handled: false, reason: `Ignored event type ${event.type}` };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const orderRef = session.metadata?.orderReference || session.client_reference_id || '';
  const order =
    (orderRef ? await store.getOrderByReference(orderRef) : null) ||
    (await store.getOrderByStripeSessionId(session.id));

  if (!order) {
    return { handled: false, reason: 'Order not found for Stripe session' };
  }

  if (event.type === 'checkout.session.expired') {
    if (order.paymentStatus === 'PENDING') {
      order.paymentStatus = 'EXPIRED';
      order.updatedAt = new Date().toISOString();
      await store.updateOrder(order);
    }
    await store.recordPaymentAttempt({
      id: `pa-${crypto.randomUUID()}`,
      orderReference: order.orderReference,
      provider: 'stripe',
      expectedAmountMinor: order.chargedAmountMinor,
      expectedCurrency: order.chargedCurrency,
      receivedAmountMinor: session.amount_total ?? undefined,
      receivedCurrency: session.currency?.toUpperCase(),
      status: 'EXPIRED',
      message: 'Stripe checkout session expired',
      createdAt: new Date().toISOString(),
    });
    return {
      handled: true,
      orderReference: order.orderReference,
      paymentStatus: order.paymentStatus,
    };
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    if (order.paymentStatus === 'PENDING') {
      order.paymentStatus = 'FAILED';
      order.updatedAt = new Date().toISOString();
      await store.updateOrder(order);
    }
    await store.recordPaymentAttempt({
      id: `pa-${crypto.randomUUID()}`,
      orderReference: order.orderReference,
      provider: 'stripe',
      expectedAmountMinor: order.chargedAmountMinor,
      expectedCurrency: order.chargedCurrency,
      receivedAmountMinor: session.amount_total ?? undefined,
      receivedCurrency: session.currency?.toUpperCase(),
      status: 'FAILED',
      message: 'Stripe async payment failed',
      createdAt: new Date().toISOString(),
    });
    return {
      handled: true,
      orderReference: order.orderReference,
      paymentStatus: order.paymentStatus,
    };
  }

  // checkout.session.completed or checkout.session.async_payment_succeeded
  const isPaid = session.payment_status === 'paid';
  const receivedAmount = session.amount_total ?? -1;
  const receivedCurrency = (session.currency || '').toUpperCase();

  if (!isPaid) {
    await store.recordPaymentAttempt({
      id: `pa-${crypto.randomUUID()}`,
      orderReference: order.orderReference,
      provider: 'stripe',
      expectedAmountMinor: order.chargedAmountMinor,
      expectedCurrency: order.chargedCurrency,
      receivedAmountMinor: receivedAmount >= 0 ? receivedAmount : undefined,
      receivedCurrency,
      status: 'INITIATED',
      message: `Session completed with payment_status=${session.payment_status}; awaiting settlement`,
      createdAt: new Date().toISOString(),
    });
    return {
      handled: true,
      orderReference: order.orderReference,
      paymentStatus: order.paymentStatus,
    };
  }

  if (
    receivedAmount !== order.chargedAmountMinor ||
    receivedCurrency !== order.chargedCurrency
  ) {
    await store.recordPaymentAttempt({
      id: `pa-${crypto.randomUUID()}`,
      orderReference: order.orderReference,
      provider: 'stripe',
      expectedAmountMinor: order.chargedAmountMinor,
      expectedCurrency: order.chargedCurrency,
      receivedAmountMinor: receivedAmount,
      receivedCurrency,
      status: 'AMOUNT_MISMATCH',
      message: `Amount/currency mismatch: expected ${order.chargedAmountMinor} ${order.chargedCurrency}, got ${receivedAmount} ${receivedCurrency}`,
      createdAt: new Date().toISOString(),
    });
    return {
      handled: true,
      orderReference: order.orderReference,
      paymentStatus: order.paymentStatus,
      reason: 'Amount or currency mismatch',
    };
  }

  if (order.paymentStatus !== 'PAID') {
    order.paymentStatus = 'PAID';
    if (order.fulfillmentStatus === 'AWAITING_PAYMENT') {
      order.fulfillmentStatus = 'PROCESSING';
    }
    order.providerRefs.stripeSessionId = session.id;
    if (typeof session.payment_intent === 'string') {
      order.providerRefs.stripePaymentIntentId = session.payment_intent;
    }
    order.updatedAt = new Date().toISOString();
    await store.updateOrder(order);
  }

  await store.recordPaymentAttempt({
    id: `pa-${crypto.randomUUID()}`,
    orderReference: order.orderReference,
    provider: 'stripe',
    expectedAmountMinor: order.chargedAmountMinor,
    expectedCurrency: order.chargedCurrency,
    receivedAmountMinor: receivedAmount,
    receivedCurrency,
    status: 'VERIFIED',
    message: `Verified Stripe payment (${event.type})`,
    createdAt: new Date().toISOString(),
  });

  return {
    handled: true,
    orderReference: order.orderReference,
    paymentStatus: order.paymentStatus,
  };
}
