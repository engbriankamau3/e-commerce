import { Router } from 'express';
import { findPickupStation } from '../../../shared/src/pickupStations.ts';
import {
  isPickupLocked,
  trackLookupSchema,
  updatePickupSchema,
} from '../../../shared/src/validators.ts';
import type { OrderRecord } from '../../../shared/src/types.ts';
import type { BackendEnv } from '../config/env.ts';
import type { DataStore } from '../db/store.ts';
import { createAuthMiddleware } from '../middleware/auth.ts';

function sanitizeOrderForCustomer(order: OrderRecord) {
  return {
    orderReference: order.orderReference,
    email: order.email,
    customerName: order.customerName,
    items: order.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      variantSku: item.variantSku,
      variantLabel: item.variantLabel,
      image: item.image,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
    })),
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    currency: order.currency,
    chargedAmountMinor: order.chargedAmountMinor,
    chargedCurrency: order.chargedCurrency,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    pickupPoint: order.pickupPoint,
    pickupEditable: !isPickupLocked(order.fulfillmentStatus),
    trackingWorkflow: 'store_managed',
    mpesaReceiptNumber: order.providerRefs.mpesaReceiptNumber,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function createOrdersRouter(store: DataStore, env: BackendEnv): Router {
  const router = Router();
  const { requireUserAuth } = createAuthMiddleware(env.jwtSecret);

  router.post('/api/orders/track', async (req, res) => {
    const parsed = trackLookupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter order reference and email' });
      return;
    }

    const order = await store.getOrderByReference(parsed.data.orderReference);
    if (!order || order.email.toLowerCase() !== parsed.data.email) {
      res.status(404).json({ error: 'No matching order found for that reference and email' });
      return;
    }

    const attempts = await store.listPaymentAttempts(order.orderReference);
    res.json({
      order: sanitizeOrderForCustomer(order),
      attempts: attempts.map((a) => ({
        status: a.status,
        provider: a.provider,
        message: a.message,
        createdAt: a.createdAt,
      })),
    });
  });

  router.patch('/api/orders/track/pickup', async (req, res) => {
    const parsed = updatePickupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid pickup update request' });
      return;
    }

    const order = await store.getOrderByReference(parsed.data.orderReference);
    if (!order || order.email.toLowerCase() !== parsed.data.email) {
      res.status(404).json({ error: 'No matching order found for that reference and email' });
      return;
    }

    if (isPickupLocked(order.fulfillmentStatus)) {
      res.status(409).json({
        error: `Pickup point cannot be changed once the order is marked ${order.fulfillmentStatus.replace(/_/g, ' ')}.`,
      });
      return;
    }

    const station = findPickupStation(parsed.data.pickupPoint.stationId);
    if (!station) {
      res.status(400).json({ error: 'Selected pickup station does not exist' });
      return;
    }

    order.pickupPoint = {
      stationId: station.id,
      stationName: station.name,
      area: parsed.data.pickupPoint.area?.trim() || station.area,
      notes: parsed.data.pickupPoint.notes?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    order.updatedAt = new Date().toISOString();
    await store.updateOrder(order);

    res.json({ order: sanitizeOrderForCustomer(order) });
  });

  router.get('/api/orders/mine', requireUserAuth, async (req, res) => {
    const byUser = await store.listOrders({ userId: req.authUser!.sub });
    const byEmail = await store.listOrders({ email: req.authUser!.email });
    const seen = new Set<string>();
    const combined: OrderRecord[] = [];
    for (const order of [...byUser, ...byEmail]) {
      if (!seen.has(order.orderReference)) {
        seen.add(order.orderReference);
        combined.push(order);
      }
    }
    res.json({ orders: combined.map(sanitizeOrderForCustomer) });
  });

  return router;
}
