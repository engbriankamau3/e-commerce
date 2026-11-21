import mongoose, { Schema } from 'mongoose';
import type {
  CategoryRecord,
  OrderRecord,
  PaymentAttemptRecord,
  Product,
  UserRecord,
} from '../../../shared/src/types.ts';

const ProductVariantSchema = new Schema(
  {
    sku: { type: String, required: true },
    label: { type: String, required: true },
    stock: { type: Number, required: true, default: 0 },
    priceCents: { type: Number },
    supplierCostCents: { type: Number },
    cjVariantId: { type: String },
  },
  { _id: false }
);

const ProductSchema = new Schema<Product>(
  {
    id: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    category: { type: String, required: true, index: true },
    description: { type: String, required: true },
    images: { type: [String], default: [] },
    currency: { type: String, enum: ['USD'], default: 'USD' },
    retailPriceCents: { type: Number, required: true },
    supplierCostCents: { type: Number },
    variants: { type: [ProductVariantSchema], default: [] },
    source: { type: String, enum: ['manual', 'cj'], default: 'manual' },
    cjProductId: { type: String },
    active: { type: Boolean, default: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const UserSchema = new Schema<UserRecord>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    firebaseUid: { type: String, index: true },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const CartSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    items: {
      type: [
        {
          productId: { type: String, required: true },
          variantSku: { type: String, required: true },
          quantity: { type: Number, required: true },
        },
      ],
      default: [],
    },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const OrderItemSnapshotSchema = new Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    variantSku: { type: String, required: true },
    variantLabel: { type: String, required: true },
    image: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPriceCents: { type: Number, required: true },
    lineTotalCents: { type: Number, required: true },
    supplierCostCents: { type: Number },
  },
  { _id: false }
);

const OrderSchema = new Schema<OrderRecord>(
  {
    orderReference: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, index: true },
    customerName: { type: String, required: true },
    userId: { type: String, index: true },
    items: { type: [OrderItemSnapshotSchema], required: true },
    subtotalCents: { type: Number, required: true },
    shippingCents: { type: Number, required: true },
    totalCents: { type: Number, required: true },
    currency: { type: String, enum: ['USD', 'KES'], required: true },
    chargedAmountMinor: { type: Number, required: true },
    chargedCurrency: { type: String, enum: ['USD', 'KES'], required: true },
    paymentMethod: { type: String, enum: ['stripe', 'mpesa'], required: true },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },
    fulfillmentStatus: {
      type: String,
      enum: ['AWAITING_PAYMENT', 'PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'DELIVERED'],
      default: 'AWAITING_PAYMENT',
    },
    pickupPoint: { type: Schema.Types.Mixed, required: true },
    providerRefs: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const PaymentAttemptSchema = new Schema<PaymentAttemptRecord>(
  {
    id: { type: String, required: true, unique: true },
    orderReference: { type: String, required: true, index: true },
    provider: { type: String, enum: ['stripe', 'mpesa'], required: true },
    expectedAmountMinor: { type: Number, required: true },
    expectedCurrency: { type: String, enum: ['USD', 'KES'], required: true },
    receivedAmountMinor: { type: Number },
    receivedCurrency: { type: String },
    status: {
      type: String,
      enum: ['INITIATED', 'VERIFIED', 'AMOUNT_MISMATCH', 'FAILED', 'EXPIRED'],
      required: true,
    },
    message: { type: String, required: true },
    rawSummary: { type: String },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);

const AdminConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const CategorySchema = new Schema<CategoryRecord>(
  {
    id: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

export const ProductModel =
  mongoose.models.Product || mongoose.model<Product>('Product', ProductSchema);
export const CategoryModel =
  mongoose.models.Category || mongoose.model<CategoryRecord>('Category', CategorySchema);
export const UserModel = mongoose.models.User || mongoose.model<UserRecord>('User', UserSchema);
export const CartModel = mongoose.models.Cart || mongoose.model('Cart', CartSchema);
export const OrderModel = mongoose.models.Order || mongoose.model<OrderRecord>('Order', OrderSchema);
export const PaymentAttemptModel =
  mongoose.models.PaymentAttempt ||
  mongoose.model<PaymentAttemptRecord>('PaymentAttempt', PaymentAttemptSchema);
export const AdminConfigModel =
  mongoose.models.AdminConfig || mongoose.model('AdminConfig', AdminConfigSchema);
