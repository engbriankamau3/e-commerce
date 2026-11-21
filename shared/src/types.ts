export type CurrencyCode = 'USD' | 'KES';

export type PaymentMethod = 'stripe' | 'mpesa';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';

export type FulfillmentStatus =
  | 'AWAITING_PAYMENT'
  | 'PROCESSING'
  | 'READY_FOR_PICKUP'
  | 'DISPATCHED'
  | 'DELIVERED';

export const LOCKED_PICKUP_STATUSES: ReadonlyArray<FulfillmentStatus> = [
  'READY_FOR_PICKUP',
  'DISPATCHED',
  'DELIVERED',
];

export interface ProductVariant {
  sku: string;
  label: string;
  stock: number;
  priceCents?: number;
  supplierCostCents?: number;
  cjVariantId?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  images: string[];
  currency: 'USD';
  retailPriceCents: number;
  supplierCostCents?: number;
  variants: ProductVariant[];
  source: 'manual' | 'cj';
  cjProductId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryRecord {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryWithCount extends CategoryRecord {
  productCount: number;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  firebaseUid?: string;
  role: 'customer' | 'admin';
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: 'customer' | 'admin';
}

export interface CartItemInput {
  productId: string;
  variantSku: string;
  quantity: number;
}

export interface PricedCartItem {
  productId: string;
  slug: string;
  name: string;
  variantSku: string;
  variantLabel: string;
  image: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface PickupStation {
  id: string;
  name: string;
  area: string;
  hours: string;
  shippingCents: number;
}

export interface PickupPoint {
  stationId: string;
  stationName: string;
  area: string;
  notes?: string;
  updatedAt: string;
}

export interface OrderItemSnapshot {
  productId: string;
  name: string;
  variantSku: string;
  variantLabel: string;
  image: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  supplierCostCents?: number;
}

export interface OrderRecord {
  orderReference: string;
  email: string;
  customerName: string;
  userId?: string;
  items: OrderItemSnapshot[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  currency: CurrencyCode;
  chargedAmountMinor: number;
  chargedCurrency: CurrencyCode;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  pickupPoint: PickupPoint;
  providerRefs: {
    stripeSessionId?: string;
    stripePaymentIntentId?: string;
    mpesaCheckoutRequestId?: string;
    mpesaMerchantRequestId?: string;
    mpesaReceiptNumber?: string;
    mpesaPhoneNumber?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAttemptRecord {
  id: string;
  orderReference: string;
  provider: PaymentMethod;
  expectedAmountMinor: number;
  expectedCurrency: CurrencyCode;
  receivedAmountMinor?: number;
  receivedCurrency?: string;
  status: 'INITIATED' | 'VERIFIED' | 'AMOUNT_MISMATCH' | 'FAILED' | 'EXPIRED';
  message: string;
  rawSummary?: string;
  createdAt: string;
}

export interface CjCatalogItem {
  cjProductId: string;
  name: string;
  category: string;
  description: string;
  image: string;
  supplierCostCents: number;
  suggestedRetailCents: number;
  variants: Array<{
    cjVariantId: string;
    sku: string;
    label: string;
    stock: number;
    supplierCostCents: number;
  }>;
}
