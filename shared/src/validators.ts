import { z } from 'zod';
import { LOCKED_PICKUP_STATUSES, type CurrencyCode, type FulfillmentStatus } from './types.ts';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Enter a valid email address').toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required').max(128),
});

export const cartItemInputSchema = z.object({
  productId: z.string().trim().min(1),
  variantSku: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(25),
});

export const cartPutSchema = z.object({
  items: z.array(cartItemInputSchema).max(50),
});

export const pickupInputSchema = z.object({
  stationId: z.string().trim().min(1, 'Select a pickup station'),
  area: z.string().trim().min(2, 'Enter a pickup area').max(120).optional(),
  notes: z.string().trim().max(240).optional(),
});

export const stripeCheckoutSchema = z.object({
  email: z.string().trim().email('Valid email is required').toLowerCase(),
  customerName: z.string().trim().min(2, 'Full name is required').max(100),
  items: z.array(cartItemInputSchema).min(1, 'Your bag is empty').max(50),
  pickupPoint: pickupInputSchema,
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export const mpesaCheckoutSchema = z.object({
  email: z.string().trim().email('Valid email is required').toLowerCase(),
  customerName: z.string().trim().min(2, 'Full name is required').max(100),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^(?:\+?254|0)[17]\d{8}$/, 'Enter a valid Kenyan mobile number (e.g. 0712345678 or 254712345678)'),
  items: z.array(cartItemInputSchema).min(1, 'Your bag is empty').max(50),
  pickupPoint: pickupInputSchema,
});

export const trackLookupSchema = z.object({
  orderReference: z.string().trim().min(4).max(40).toUpperCase(),
  email: z.string().trim().email().toLowerCase(),
});

export const updatePickupSchema = z.object({
  orderReference: z.string().trim().min(4).max(40).toUpperCase(),
  email: z.string().trim().email().toLowerCase(),
  pickupPoint: pickupInputSchema,
});

export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(10).max(2000),
  images: z.array(z.string().trim().min(1)).min(1),
  retailPriceCents: z.number().int().min(100).max(10_000_000),
  variants: z
    .array(
      z.object({
        sku: z.string().trim().min(2).max(64),
        label: z.string().trim().min(1).max(80),
        stock: z.number().int().min(0).max(100_000),
        priceCents: z.number().int().min(100).optional(),
      })
    )
    .min(1),
});

export const createCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Category name must be at least 2 characters')
    .max(60, 'Category name must be 60 characters or fewer'),
});

export const renameCategorySchema = createCategorySchema;

export const updateProductInventorySchema = z.object({
  retailPriceCents: z.number().int().min(100).max(10_000_000),
  category: z.string().trim().min(2).max(60).optional(),
  variants: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(64),
        stock: z.number().int().min(0).max(100_000),
      })
    )
    .min(1),
});

export const cjImportSchema = z.object({
  cjProductId: z.string().trim().min(1),
  retailPriceCents: z.number().int().min(100).max(10_000_000),
  name: z.string().trim().min(2).max(120).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().min(5).max(2000).optional(),
  variantStocks: z.record(z.string(), z.number().int().min(0).max(100_000)).optional(),
});

export const updateOrderStatusSchema = z.object({
  fulfillmentStatus: z.enum([
    'AWAITING_PAYMENT',
    'PROCESSING',
    'READY_FOR_PICKUP',
    'DISPATCHED',
    'DELIVERED',
  ]),
});

export const bulkUpdateOrderStatusSchema = z.object({
  orderReferences: z
    .array(z.string().trim().min(1))
    .min(1, 'Select at least one order')
    .max(100, 'Cannot update more than 100 orders at once'),
  fulfillmentStatus: updateOrderStatusSchema.shape.fulfillmentStatus,
});

export function isPickupLocked(status: FulfillmentStatus): boolean {
  return LOCKED_PICKUP_STATUSES.includes(status);
}

export function formatMoney(centsOrMinor: number, currency: CurrencyCode = 'USD'): string {
  const amount = centsOrMinor / 100;
  if (currency === 'KES') {
    return `KES ${Math.round(amount).toLocaleString('en-US')}`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function normalizeKenyanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) {
    return `254${digits.slice(1)}`;
  }
  if (digits.startsWith('254') && digits.length === 12) {
    return digits;
  }
  return digits;
}
