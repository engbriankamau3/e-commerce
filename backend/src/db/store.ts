import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { SAMPLE_PRODUCTS } from '../../../shared/src/catalogSeed.ts';
import type {
  CartItemInput,
  CategoryRecord,
  OrderRecord,
  PaymentAttemptRecord,
  Product,
  UserRecord,
} from '../../../shared/src/types.ts';
import {
  AdminConfigModel,
  CartModel,
  CategoryModel,
  OrderModel,
  PaymentAttemptModel,
  ProductModel,
  UserModel,
} from './models.ts';

interface PersistedSnapshot {
  products: Product[];
  categories: CategoryRecord[];
  users: UserRecord[];
  carts: Record<string, CartItemInput[]>;
  orders: OrderRecord[];
  paymentAttempts: PaymentAttemptRecord[];
  adminCredentials: { email: string; passwordHash: string; updatedAt: string } | null;
}

function slugifyCategory(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || `cat-${Date.now()}`
  );
}

function deriveInitialCategories(products: Product[]): CategoryRecord[] {
  const seen = new Set<string>();
  const categories: CategoryRecord[] = [];
  const now = new Date().toISOString();
  for (const p of products) {
    const clean = p.category.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const slug = slugifyCategory(clean);
    categories.push({
      id: `cat-${slug}`,
      slug,
      name: clean,
      createdAt: now,
      updatedAt: now,
    });
  }
  return categories;
}

export interface DataStore {
  readonly mode: 'mongodb' | 'local';
  init(): Promise<void>;
  close(): Promise<void>;

  listProducts(includeInactive?: boolean): Promise<Product[]>;
  getProductById(id: string): Promise<Product | null>;
  getProductBySlug(slug: string): Promise<Product | null>;
  upsertProduct(product: Product): Promise<Product>;
  deactivateProduct(id: string): Promise<boolean>;

  listCategories(): Promise<CategoryRecord[]>;
  ensureCategory(name: string): Promise<CategoryRecord>;
  createCategory(name: string): Promise<{ category: CategoryRecord; created: boolean }>;
  renameCategory(
    id: string,
    newName: string
  ): Promise<{ category: CategoryRecord; updatedProductCount: number; conflict?: boolean } | null>;
  deleteCategory(id: string): Promise<{ deleted: boolean; notFound?: boolean; productCount: number }>;

  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByFirebaseUid(uid: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<UserRecord>;
  updateUserPasswordHash(userId: string, newHash: string): Promise<void>;

  getCart(userId: string): Promise<CartItemInput[]>;
  setCart(userId: string, items: CartItemInput[]): Promise<CartItemInput[]>;

  createOrder(order: OrderRecord): Promise<OrderRecord>;
  getOrderByReference(orderReference: string): Promise<OrderRecord | null>;
  getOrderByStripeSessionId(sessionId: string): Promise<OrderRecord | null>;
  getOrderByMpesaCheckoutRequestId(checkoutRequestId: string): Promise<OrderRecord | null>;
  listOrders(filter?: { paymentStatus?: string; userId?: string; email?: string }): Promise<OrderRecord[]>;
  updateOrder(order: OrderRecord): Promise<OrderRecord>;

  recordPaymentAttempt(attempt: PaymentAttemptRecord): Promise<PaymentAttemptRecord>;
  listPaymentAttempts(orderReference: string): Promise<PaymentAttemptRecord[]>;

  getClaimedAdmin(): Promise<{ email: string; passwordHash: string } | null>;
  claimAdmin(email: string, passwordHash: string): Promise<boolean>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class LocalDataStore implements DataStore {
  readonly mode = 'local' as const;
  private filePath: string | null;
  private data: PersistedSnapshot;

  constructor(options: { persistFile?: string | null; seedSampleCatalog?: boolean } = {}) {
    this.filePath = options.persistFile ?? null;
    const initialProducts = options.seedSampleCatalog === false ? [] : clone(SAMPLE_PRODUCTS);
    this.data = {
      products: initialProducts,
      categories: deriveInitialCategories(initialProducts),
      users: [],
      carts: {},
      orders: [],
      paymentAttempts: [],
      adminCredentials: null,
    };
  }

  async init(): Promise<void> {
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedSnapshot>;
        const products =
          Array.isArray(parsed.products) && parsed.products.length > 0
            ? parsed.products
            : clone(SAMPLE_PRODUCTS);
        const categories =
          Array.isArray(parsed.categories) && parsed.categories.length > 0
            ? parsed.categories
            : deriveInitialCategories(products);
        this.data = {
          products,
          categories,
          users: Array.isArray(parsed.users) ? parsed.users : [],
          carts: parsed.carts && typeof parsed.carts === 'object' ? parsed.carts : {},
          orders: Array.isArray(parsed.orders) ? parsed.orders : [],
          paymentAttempts: Array.isArray(parsed.paymentAttempts) ? parsed.paymentAttempts : [],
          adminCredentials: parsed.adminCredentials ?? null,
        };
      } catch {
        this.flush();
      }
    } else {
      this.flush();
    }
  }

  async close(): Promise<void> {
    // No persistent socket to close
  }

  private flush(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async listProducts(includeInactive = false): Promise<Product[]> {
    const items = includeInactive ? this.data.products : this.data.products.filter((p) => p.active);
    return clone(items);
  }

  async getProductById(id: string): Promise<Product | null> {
    const found = this.data.products.find((p) => p.id === id);
    return found ? clone(found) : null;
  }

  async getProductBySlug(slug: string): Promise<Product | null> {
    const found = this.data.products.find((p) => p.slug === slug && p.active);
    return found ? clone(found) : null;
  }

  async upsertProduct(product: Product): Promise<Product> {
    const idx = this.data.products.findIndex((p) => p.id === product.id);
    if (idx >= 0) {
      this.data.products[idx] = clone(product);
    } else {
      this.data.products.unshift(clone(product));
    }
    this.flush();
    return clone(product);
  }

  async deactivateProduct(id: string): Promise<boolean> {
    const target = this.data.products.find((p) => p.id === id);
    if (!target) return false;
    target.active = false;
    target.updatedAt = new Date().toISOString();
    this.flush();
    return true;
  }

  async listCategories(): Promise<CategoryRecord[]> {
    return clone(this.data.categories);
  }

  async ensureCategory(name: string): Promise<CategoryRecord> {
    const clean = name.trim();
    const existing = this.data.categories.find(
      (c) => c.name.toLowerCase() === clean.toLowerCase()
    );
    if (existing) return clone(existing);
    const created = await this.createCategory(clean);
    return created.category;
  }

  async createCategory(name: string): Promise<{ category: CategoryRecord; created: boolean }> {
    const clean = name.trim();
    const existing = this.data.categories.find(
      (c) => c.name.toLowerCase() === clean.toLowerCase()
    );
    if (existing) {
      return { category: clone(existing), created: false };
    }
    const baseSlug = slugifyCategory(clean);
    let slug = baseSlug;
    if (this.data.categories.some((c) => c.slug === slug)) {
      slug = `${baseSlug}-${crypto.randomUUID().slice(0, 4)}`;
    }
    const now = new Date().toISOString();
    const record: CategoryRecord = {
      id: `cat-${crypto.randomUUID().slice(0, 8)}`,
      slug,
      name: clean,
      createdAt: now,
      updatedAt: now,
    };
    this.data.categories.push(record);
    this.flush();
    return { category: clone(record), created: true };
  }

  async renameCategory(
    id: string,
    newName: string
  ): Promise<{ category: CategoryRecord; updatedProductCount: number; conflict?: boolean } | null> {
    const target = this.data.categories.find((c) => c.id === id);
    if (!target) return null;
    const clean = newName.trim();
    const duplicate = this.data.categories.find(
      (c) => c.id !== id && c.name.toLowerCase() === clean.toLowerCase()
    );
    if (duplicate) {
      return { category: clone(target), updatedProductCount: 0, conflict: true };
    }

    const oldNameLower = target.name.toLowerCase();
    const now = new Date().toISOString();
    target.name = clean;
    target.slug = slugifyCategory(clean);
    target.updatedAt = now;

    let updatedProductCount = 0;
    for (const p of this.data.products) {
      if (p.category.trim().toLowerCase() === oldNameLower) {
        p.category = clean;
        p.updatedAt = now;
        updatedProductCount += 1;
      }
    }

    this.flush();
    return { category: clone(target), updatedProductCount };
  }

  async deleteCategory(
    id: string
  ): Promise<{ deleted: boolean; notFound?: boolean; productCount: number }> {
    const idx = this.data.categories.findIndex((c) => c.id === id);
    if (idx < 0) {
      return { deleted: false, notFound: true, productCount: 0 };
    }
    const target = this.data.categories[idx];
    const targetLower = target.name.trim().toLowerCase();
    const productCount = this.data.products.filter(
      (p) => p.active && p.category.trim().toLowerCase() === targetLower
    ).length;
    if (productCount > 0) {
      return { deleted: false, productCount };
    }
    this.data.categories.splice(idx, 1);
    this.flush();
    return { deleted: true, productCount: 0 };
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    const found = this.data.users.find((u) => u.email.toLowerCase() === normalized);
    return found ? clone(found) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const found = this.data.users.find((u) => u.id === id);
    return found ? clone(found) : null;
  }

  async findUserByFirebaseUid(uid: string): Promise<UserRecord | null> {
    const found = this.data.users.find((u) => u.firebaseUid === uid);
    return found ? clone(found) : null;
  }

  async createUser(user: UserRecord): Promise<UserRecord> {
    this.data.users.push(clone(user));
    this.flush();
    return clone(user);
  }

  async updateUserPasswordHash(userId: string, newHash: string): Promise<void> {
    const user = this.data.users.find((u) => u.id === userId);
    if (user) {
      user.passwordHash = newHash;
      user.updatedAt = new Date().toISOString();
      this.flush();
    }
  }

  async getCart(userId: string): Promise<CartItemInput[]> {
    return clone(this.data.carts[userId] || []);
  }

  async setCart(userId: string, items: CartItemInput[]): Promise<CartItemInput[]> {
    this.data.carts[userId] = clone(items);
    this.flush();
    return clone(items);
  }

  async createOrder(order: OrderRecord): Promise<OrderRecord> {
    this.data.orders.unshift(clone(order));
    this.flush();
    return clone(order);
  }

  async getOrderByReference(orderReference: string): Promise<OrderRecord | null> {
    const normalized = orderReference.trim().toUpperCase();
    const found = this.data.orders.find((o) => o.orderReference.toUpperCase() === normalized);
    return found ? clone(found) : null;
  }

  async getOrderByStripeSessionId(sessionId: string): Promise<OrderRecord | null> {
    const found = this.data.orders.find((o) => o.providerRefs.stripeSessionId === sessionId);
    return found ? clone(found) : null;
  }

  async getOrderByMpesaCheckoutRequestId(checkoutRequestId: string): Promise<OrderRecord | null> {
    const found = this.data.orders.find(
      (o) => o.providerRefs.mpesaCheckoutRequestId === checkoutRequestId
    );
    return found ? clone(found) : null;
  }

  async listOrders(filter?: {
    paymentStatus?: string;
    userId?: string;
    email?: string;
  }): Promise<OrderRecord[]> {
    let items = this.data.orders;
    if (filter?.paymentStatus) {
      items = items.filter((o) => o.paymentStatus === filter.paymentStatus);
    }
    if (filter?.userId) {
      items = items.filter((o) => o.userId === filter.userId);
    }
    if (filter?.email) {
      const normalized = filter.email.trim().toLowerCase();
      items = items.filter((o) => o.email.toLowerCase() === normalized);
    }
    return clone(items);
  }

  async updateOrder(order: OrderRecord): Promise<OrderRecord> {
    const idx = this.data.orders.findIndex((o) => o.orderReference === order.orderReference);
    if (idx >= 0) {
      this.data.orders[idx] = clone(order);
      this.flush();
    }
    return clone(order);
  }

  async recordPaymentAttempt(attempt: PaymentAttemptRecord): Promise<PaymentAttemptRecord> {
    this.data.paymentAttempts.unshift(clone(attempt));
    this.flush();
    return clone(attempt);
  }

  async listPaymentAttempts(orderReference: string): Promise<PaymentAttemptRecord[]> {
    return clone(this.data.paymentAttempts.filter((a) => a.orderReference === orderReference));
  }

  async getClaimedAdmin(): Promise<{ email: string; passwordHash: string } | null> {
    if (!this.data.adminCredentials) return null;
    return {
      email: this.data.adminCredentials.email,
      passwordHash: this.data.adminCredentials.passwordHash,
    };
  }

  async claimAdmin(email: string, passwordHash: string): Promise<boolean> {
    if (this.data.adminCredentials) return false;
    this.data.adminCredentials = {
      email: email.trim().toLowerCase(),
      passwordHash,
      updatedAt: new Date().toISOString(),
    };
    this.flush();
    return true;
  }
}

export class MongoDataStore implements DataStore {
  readonly mode = 'mongodb' as const;
  private uri: string;

  constructor(uri: string) {
    this.uri = uri;
  }

  async init(): Promise<void> {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(this.uri, { serverSelectionTimeoutMS: 5000 });
    }
    const count = await ProductModel.countDocuments();
    if (count === 0) {
      await ProductModel.insertMany(SAMPLE_PRODUCTS);
    }
    const catCount = await CategoryModel.countDocuments();
    if (catCount === 0) {
      const products = await ProductModel.find({ active: true }).lean();
      const initial = deriveInitialCategories(products as unknown as Product[]);
      if (initial.length > 0) {
        await CategoryModel.insertMany(initial);
      }
    }
  }

  async close(): Promise<void> {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  async listProducts(includeInactive = false): Promise<Product[]> {
    const query = includeInactive ? {} : { active: true };
    const docs = await ProductModel.find(query).sort({ createdAt: -1 }).lean();
    return docs as unknown as Product[];
  }

  async getProductById(id: string): Promise<Product | null> {
    const doc = await ProductModel.findOne({ id }).lean();
    return (doc as unknown as Product) || null;
  }

  async getProductBySlug(slug: string): Promise<Product | null> {
    const doc = await ProductModel.findOne({ slug, active: true }).lean();
    return (doc as unknown as Product) || null;
  }

  async upsertProduct(product: Product): Promise<Product> {
    await ProductModel.findOneAndUpdate({ id: product.id }, product, {
      upsert: true,
      new: true,
    });
    return product;
  }

  async deactivateProduct(id: string): Promise<boolean> {
    const res = await ProductModel.updateOne(
      { id },
      { $set: { active: false, updatedAt: new Date().toISOString() } }
    );
    return res.matchedCount > 0;
  }

  async listCategories(): Promise<CategoryRecord[]> {
    const docs = await CategoryModel.find({}).sort({ createdAt: 1 }).lean();
    return docs as unknown as CategoryRecord[];
  }

  async ensureCategory(name: string): Promise<CategoryRecord> {
    const res = await this.createCategory(name);
    return res.category;
  }

  async createCategory(name: string): Promise<{ category: CategoryRecord; created: boolean }> {
    const clean = name.trim();
    const all = await this.listCategories();
    const existing = all.find((c) => c.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      return { category: existing, created: false };
    }
    const baseSlug = slugifyCategory(clean);
    let slug = baseSlug;
    if (all.some((c) => c.slug === slug)) {
      slug = `${baseSlug}-${crypto.randomUUID().slice(0, 4)}`;
    }
    const now = new Date().toISOString();
    const record: CategoryRecord = {
      id: `cat-${crypto.randomUUID().slice(0, 8)}`,
      slug,
      name: clean,
      createdAt: now,
      updatedAt: now,
    };
    await CategoryModel.create(record);
    return { category: record, created: true };
  }

  async renameCategory(
    id: string,
    newName: string
  ): Promise<{ category: CategoryRecord; updatedProductCount: number; conflict?: boolean } | null> {
    const target = (await CategoryModel.findOne({ id }).lean()) as unknown as CategoryRecord | null;
    if (!target) return null;
    const clean = newName.trim();
    const all = await this.listCategories();
    if (all.some((c) => c.id !== id && c.name.toLowerCase() === clean.toLowerCase())) {
      return { category: target, updatedProductCount: 0, conflict: true };
    }

    const now = new Date().toISOString();
    const updatedSlug = slugifyCategory(clean);
    await CategoryModel.updateOne(
      { id },
      { $set: { name: clean, slug: updatedSlug, updatedAt: now } }
    );

    const escapedOld = target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prodRes = await ProductModel.updateMany(
      { category: { $regex: `^${escapedOld}$`, $options: 'i' } },
      { $set: { category: clean, updatedAt: now } }
    );

    return {
      category: { ...target, name: clean, slug: updatedSlug, updatedAt: now },
      updatedProductCount: prodRes.modifiedCount ?? 0,
    };
  }

  async deleteCategory(
    id: string
  ): Promise<{ deleted: boolean; notFound?: boolean; productCount: number }> {
    const target = (await CategoryModel.findOne({ id }).lean()) as unknown as CategoryRecord | null;
    if (!target) {
      return { deleted: false, notFound: true, productCount: 0 };
    }
    const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const productCount = await ProductModel.countDocuments({
      active: true,
      category: { $regex: `^${escaped}$`, $options: 'i' },
    });
    if (productCount > 0) {
      return { deleted: false, productCount };
    }
    await CategoryModel.deleteOne({ id });
    return { deleted: true, productCount: 0 };
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const doc = await UserModel.findOne({ email: email.trim().toLowerCase() }).lean();
    return (doc as unknown as UserRecord) || null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const doc = await UserModel.findOne({ id }).lean();
    return (doc as unknown as UserRecord) || null;
  }

  async findUserByFirebaseUid(uid: string): Promise<UserRecord | null> {
    const doc = await UserModel.findOne({ firebaseUid: uid }).lean();
    return (doc as unknown as UserRecord) || null;
  }

  async createUser(user: UserRecord): Promise<UserRecord> {
    await UserModel.create(user);
    return user;
  }

  async updateUserPasswordHash(userId: string, newHash: string): Promise<void> {
    await UserModel.updateOne(
      { id: userId },
      { $set: { passwordHash: newHash, updatedAt: new Date().toISOString() } }
    );
  }

  async getCart(userId: string): Promise<CartItemInput[]> {
    const doc = (await CartModel.findOne({ userId }).lean()) as { items?: CartItemInput[] } | null;
    return doc?.items || [];
  }

  async setCart(userId: string, items: CartItemInput[]): Promise<CartItemInput[]> {
    await CartModel.findOneAndUpdate(
      { userId },
      { userId, items, updatedAt: new Date().toISOString() },
      { upsert: true, new: true }
    );
    return items;
  }

  async createOrder(order: OrderRecord): Promise<OrderRecord> {
    await OrderModel.create(order);
    return order;
  }

  async getOrderByReference(orderReference: string): Promise<OrderRecord | null> {
    const doc = await OrderModel.findOne({
      orderReference: orderReference.trim().toUpperCase(),
    }).lean();
    return (doc as unknown as OrderRecord) || null;
  }

  async getOrderByStripeSessionId(sessionId: string): Promise<OrderRecord | null> {
    const doc = await OrderModel.findOne({ 'providerRefs.stripeSessionId': sessionId }).lean();
    return (doc as unknown as OrderRecord) || null;
  }

  async getOrderByMpesaCheckoutRequestId(checkoutRequestId: string): Promise<OrderRecord | null> {
    const doc = await OrderModel.findOne({
      'providerRefs.mpesaCheckoutRequestId': checkoutRequestId,
    }).lean();
    return (doc as unknown as OrderRecord) || null;
  }

  async listOrders(filter?: {
    paymentStatus?: string;
    userId?: string;
    email?: string;
  }): Promise<OrderRecord[]> {
    const query: Record<string, unknown> = {};
    if (filter?.paymentStatus) query.paymentStatus = filter.paymentStatus;
    if (filter?.userId) query.userId = filter.userId;
    if (filter?.email) query.email = filter.email.trim().toLowerCase();
    const docs = await OrderModel.find(query).sort({ createdAt: -1 }).lean();
    return docs as unknown as OrderRecord[];
  }

  async updateOrder(order: OrderRecord): Promise<OrderRecord> {
    await OrderModel.findOneAndUpdate({ orderReference: order.orderReference }, order, {
      new: true,
    });
    return order;
  }

  async recordPaymentAttempt(attempt: PaymentAttemptRecord): Promise<PaymentAttemptRecord> {
    await PaymentAttemptModel.create(attempt);
    return attempt;
  }

  async listPaymentAttempts(orderReference: string): Promise<PaymentAttemptRecord[]> {
    const docs = await PaymentAttemptModel.find({ orderReference }).sort({ createdAt: -1 }).lean();
    return docs as unknown as PaymentAttemptRecord[];
  }

  async getClaimedAdmin(): Promise<{ email: string; passwordHash: string } | null> {
    const doc = (await AdminConfigModel.findOne({ key: 'primary_admin' }).lean()) as {
      email: string;
      passwordHash: string;
    } | null;
    if (!doc) return null;
    return { email: doc.email, passwordHash: doc.passwordHash };
  }

  async claimAdmin(email: string, passwordHash: string): Promise<boolean> {
    const existing = await AdminConfigModel.findOne({ key: 'primary_admin' }).lean();
    if (existing) return false;
    await AdminConfigModel.create({
      key: 'primary_admin',
      email: email.trim().toLowerCase(),
      passwordHash,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
}

export async function createDataStore(mongodbUri: string, localFile?: string): Promise<DataStore> {
  if (mongodbUri) {
    const mongo = new MongoDataStore(mongodbUri);
    try {
      await mongo.init();
      return mongo;
    } catch (err) {
      const safeMsg = String((err as Error)?.message || err || 'Connection failed').replace(
        /mongodb(\+srv)?:\/\/[^@\s]+@/gi,
        'mongodb$1://***@'
      );
      console.warn(
        '[db] Unable to connect to MONGODB_URI; falling back to local persistent store:',
        safeMsg
      );
    }
  }
  const local = new LocalDataStore({
    persistFile: localFile ?? path.resolve(process.cwd(), '.data', 'store.json'),
  });
  await local.init();
  return local;
}
