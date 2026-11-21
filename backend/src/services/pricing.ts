import { findPickupStation } from '../../../shared/src/pickupStations.ts';
import type {
  CartItemInput,
  OrderItemSnapshot,
  PickupPoint,
  PricedCartItem,
} from '../../../shared/src/types.ts';
import type { DataStore } from '../db/store.ts';
import { recheckCjVariantBeforeCheckout } from './cj.ts';

export class PricingError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface AuthoritativeQuote {
  items: OrderItemSnapshot[];
  pricedItems: PricedCartItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  pickupPoint: PickupPoint;
}

const FREE_SHIPPING_THRESHOLD_CENTS = 15000;

export async function resolveAuthoritativeOrderQuote(options: {
  store: DataStore;
  items: CartItemInput[];
  pickupInput: { stationId: string; area?: string; notes?: string };
  cjApiKey: string;
}): Promise<AuthoritativeQuote> {
  const { store, items, pickupInput, cjApiKey } = options;

  if (!items || items.length === 0) {
    throw new PricingError('Your bag is empty', 400);
  }

  const station = findPickupStation(pickupInput.stationId);
  if (!station) {
    throw new PricingError('Selected pickup station does not exist', 400);
  }

  // Merge duplicate (productId, variantSku) lines cleanly
  const merged = new Map<string, CartItemInput>();
  for (const item of items) {
    const key = `${item.productId}::${item.variantSku}`;
    const prev = merged.get(key);
    if (prev) {
      prev.quantity = Math.min(25, prev.quantity + item.quantity);
    } else {
      merged.set(key, { ...item });
    }
  }

  const snapshots: OrderItemSnapshot[] = [];
  const pricedItems: PricedCartItem[] = [];
  let subtotalCents = 0;

  for (const item of merged.values()) {
    const product = await store.getProductById(item.productId);
    if (!product || !product.active) {
      throw new PricingError(`Product ${item.productId} is no longer available`, 404);
    }

    const variant = product.variants.find((v) => v.sku === item.variantSku);
    if (!variant) {
      throw new PricingError(
        `Variant ${item.variantSku} is not available for ${product.name}`,
        400
      );
    }

    if (variant.stock < item.quantity) {
      throw new PricingError(
        `Only ${variant.stock} units available for ${product.name} (${variant.label})`,
        409
      );
    }

    const cjRecheck = await recheckCjVariantBeforeCheckout(
      product,
      variant.sku,
      item.quantity,
      cjApiKey
    );
    if (!cjRecheck.available) {
      throw new PricingError(cjRecheck.reason || 'Supplier variant unavailable', 409);
    }

    const unitPriceCents = variant.priceCents ?? product.retailPriceCents;
    const lineTotalCents = unitPriceCents * item.quantity;
    subtotalCents += lineTotalCents;

    const image = product.images[0] || '/src/assets/images/prod_canvas_tote_1795286029892.jpg';

    snapshots.push({
      productId: product.id,
      name: product.name,
      variantSku: variant.sku,
      variantLabel: variant.label,
      image,
      quantity: item.quantity,
      unitPriceCents,
      lineTotalCents,
      supplierCostCents: cjRecheck.latestSupplierCostCents ?? variant.supplierCostCents,
    });

    pricedItems.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      variantSku: variant.sku,
      variantLabel: variant.label,
      image,
      quantity: item.quantity,
      unitPriceCents,
      lineTotalCents,
    });
  }

  const shippingCents =
    subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : station.shippingCents;
  const totalCents = subtotalCents + shippingCents;

  const pickupPoint: PickupPoint = {
    stationId: station.id,
    stationName: station.name,
    area: pickupInput.area?.trim() || station.area,
    notes: pickupInput.notes?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };

  return {
    items: snapshots,
    pricedItems,
    subtotalCents,
    shippingCents,
    totalCents,
    pickupPoint,
  };
}

/**
 * Converts USD cents to KES minor units (cents, i.e., 100 minor units = 1 KES).
 * Refuses conversion if MPESA_USD_TO_KES_RATE is unconfigured.
 */
export function convertUsdCentsToKesMinor(
  usdCents: number,
  usdToKesRate: number | null
): { kesMinor: number; kesWhole: number; rate: number } {
  if (!usdToKesRate || !Number.isFinite(usdToKesRate) || usdToKesRate <= 0) {
    throw new PricingError(
      'M-Pesa USD to KES conversion is disabled because MPESA_USD_TO_KES_RATE is not configured.',
      503
    );
  }
  const kesWhole = Math.max(1, Math.round((usdCents / 100) * usdToKesRate));
  return {
    kesWhole,
    kesMinor: kesWhole * 100,
    rate: usdToKesRate,
  };
}
