import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Ephemeral per-process fallback only when JWT_SECRET is omitted in local/preview mode.
const EPHEMERAL_JWT_SECRET = crypto.randomBytes(32).toString('hex');

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  MONGODB_URI: z.string().optional(),
  JWT_SECRET: z.string().min(16).optional(),
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  ADMIN_PASSWORD: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().optional(),
  MPESA_USD_TO_KES_RATE: z.string().optional(),
  CJ_API_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional(),
});

export interface BackendEnv {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  appUrl: string;
  allowedOrigins: string[];
  mongodbUri: string;
  jwtSecret: string;
  adminEmail: string;
  adminPassword: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  mpesaEnv: 'sandbox' | 'production';
  mpesaConsumerKey: string;
  mpesaConsumerSecret: string;
  mpesaShortcode: string;
  mpesaPasskey: string;
  mpesaCallbackUrl: string;
  mpesaUsdToKesRate: number | null;
  cjApiKey: string;
  firebaseServiceAccountBase64: string;
}

export function loadBackendEnv(overrides: Record<string, string | undefined> = {}): BackendEnv {
  const merged = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid backend environment configuration: ${issues}`);
  }

  const d = parsed.data;
  const appUrl = (d.APP_URL || `http://localhost:${d.PORT}`).replace(/\/+$/, '');
  const originSet = new Set(
    d.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  originSet.add(appUrl);
  originSet.add(`http://localhost:${d.PORT}`);
  originSet.add(`http://127.0.0.1:${d.PORT}`);

  let parsedRate: number | null = null;
  if (d.MPESA_USD_TO_KES_RATE && d.MPESA_USD_TO_KES_RATE.trim() !== '') {
    const num = Number(d.MPESA_USD_TO_KES_RATE);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error('MPESA_USD_TO_KES_RATE must be a positive number when configured');
    }
    parsedRate = num;
  }

  return {
    port: d.PORT,
    nodeEnv: d.NODE_ENV,
    appUrl,
    allowedOrigins: Array.from(originSet),
    mongodbUri: d.MONGODB_URI?.trim() || '',
    jwtSecret: d.JWT_SECRET?.trim() || EPHEMERAL_JWT_SECRET,
    adminEmail: d.ADMIN_EMAIL?.trim().toLowerCase() || '',
    adminPassword: d.ADMIN_PASSWORD || '',
    stripeSecretKey: d.STRIPE_SECRET_KEY?.trim() || '',
    stripeWebhookSecret: d.STRIPE_WEBHOOK_SECRET?.trim() || '',
    mpesaEnv: d.MPESA_ENV,
    mpesaConsumerKey: d.MPESA_CONSUMER_KEY?.trim() || '',
    mpesaConsumerSecret: d.MPESA_CONSUMER_SECRET?.trim() || '',
    mpesaShortcode: d.MPESA_SHORTCODE?.trim() || '',
    mpesaPasskey: d.MPESA_PASSKEY?.trim() || '',
    mpesaCallbackUrl: d.MPESA_CALLBACK_URL?.trim() || '',
    mpesaUsdToKesRate: parsedRate,
    cjApiKey: d.CJ_API_KEY?.trim() || '',
    firebaseServiceAccountBase64: d.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim() || '',
  };
}
