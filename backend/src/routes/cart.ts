import { Router } from 'express';
import { z } from 'zod';
import {
  cartItemInputSchema,
  cartPutSchema,
  pickupInputSchema,
} from '../../../shared/src/validators.ts';
import type { CartItemInput } from '../../../shared/src/types.ts';
import type { BackendEnv } from '../config/env.ts';
import type { DataStore } from '../db/store.ts';
import { createAuthMiddleware } from '../middleware/auth.ts';
import {
  convertUsdCentsToKesMinor,
  PricingError,
  resolveAuthoritativeOrderQuote,
} from '../services/pricing.ts';

const quoteSchema = z.object({
  items: z.array(cartItemInputSchema).min(1).max(50),
  pickupPoint: pickupInputSchema.optional(),
});

export function createCartRouter(store: DataStore, env: BackendEnv): Router {
  const router = Router();
  const { requireUserAuth } = createAuthMiddleware(env.jwtSecret);

  async function hydrateCartItems(items: CartItemInput[]) {
    const hydrated = [];
    for (const item of items) {
      const product = await store.getProductById(item.productId);
      if (!product || !product.active) continue;
      const variant = product.variants.find((v) => v.sku === item.variantSku);
      if (!variant) continue;
      const unitPriceCents = variant.priceCents ?? product.retailPriceCents;
      const qty = Math.min(item.quantity, Math.max(1, variant.stock));
      hydrated.push({
        productId: product.id,
        slug: product.slug,
        name: product.name,
        variantSku: variant.sku,
        variantLabel: variant.label,
        image: product.images[0] || '/src/assets/images/prod_canvas_tote_1795286029892.jpg',
        quantity: qty,
        unitPriceCents,
        lineTotalCents: unitPriceCents * qty,
      });
    }
    return hydrated;
  }

  router.get('/api/cart', requireUserAuth, async (req, res) => {
    const rawItems = await store.getCart(req.authUser!.sub);
    const items = await hydrateCartItems(rawItems);
    const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);
    res.json({ items, subtotalCents });
  });

  router.put('/api/cart', requireUserAuth, async (req, res) => {
    const parsed = cartPutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid cart payload' });
      return;
    }

    const hydrated = await hydrateCartItems(parsed.data.items);
    const cleanInputs: CartItemInput[] = hydrated.map((h) => ({
      productId: h.productId,
      variantSku: h.variantSku,
      quantity: h.quantity,
    }));
    await store.setCart(req.authUser!.sub, cleanInputs);
    const subtotalCents = hydrated.reduce((sum, i) => sum + i.lineTotalCents, 0);
    res.json({ items: hydrated, subtotalCents });
  });

  router.post('/api/cart/merge', requireUserAuth, async (req, res) => {
    const parsed = cartPutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid cart items' });
      return;
    }

    const existing = await store.getCart(req.authUser!.sub);
    const mergedMap = new Map<string, CartItemInput>();
    for (const item of [...existing, ...parsed.data.items]) {
      const key = `${item.productId}::${item.variantSku}`;
      const prev = mergedMap.get(key);
      if (prev) {
        prev.quantity = Math.min(25, prev.quantity + item.quantity);
      } else {
        mergedMap.set(key, { ...item });
      }
    }

    const hydrated = await hydrateCartItems(Array.from(mergedMap.values()));
    await store.setCart(
      req.authUser!.sub,
      hydrated.map((h) => ({
        productId: h.productId,
        variantSku: h.variantSku,
        quantity: h.quantity,
      }))
    );
    const subtotalCents = hydrated.reduce((sum, i) => sum + i.lineTotalCents, 0);
    res.json({ items: hydrated, subtotalCents });
  });

  router.post('/api/cart/quote', async (req, res) => {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quote payload' });
      return;
    }

    try {
      const quote = await resolveAuthoritativeOrderQuote({
        store,
        items: parsed.data.items,
        pickupInput: parsed.data.pickupPoint || { stationId: 'nbo-cbd-hub' },
        cjApiKey: env.cjApiKey,
      });

      let mpesaEstimate: { kesWhole: number; rate: number } | null = null;
      if (env.mpesaUsdToKesRate) {
        const kes = convertUsdCentsToKesMinor(quote.totalCents, env.mpesaUsdToKesRate);
        mpesaEstimate = { kesWhole: kes.kesWhole, rate: kes.rate };
      }

      res.json({
        items: quote.pricedItems,
        subtotalCents: quote.subtotalCents,
        shippingCents: quote.shippingCents,
        totalCents: quote.totalCents,
        currency: 'USD',
        pickupPoint: quote.pickupPoint,
        mpesaEstimate,
      });
    } catch (err) {
      if (err instanceof PricingError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Unable to calculate order quote' });
    }
  });

  return router;
}
