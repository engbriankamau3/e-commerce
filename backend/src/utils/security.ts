import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { PublicUser } from '../../../shared/src/types.ts';

const SCRYPT_PREFIX = 'scrypt$';
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${SCRYPT_PREFIX}${salt}$${derived}`;
}

export function isLegacyPlaintextHash(storedHash: string): boolean {
  return !storedHash.startsWith(SCRYPT_PREFIX);
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;

  if (isLegacyPlaintextHash(storedHash)) {
    const a = Buffer.from(password, 'utf8');
    const b = Buffer.from(storedHash, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface JwtClaims {
  sub: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
}

export function signAuthToken(user: PublicUser, secret: string, expiresIn = '7d'): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    } satisfies JwtClaims,
    secret,
    { algorithm: 'HS256', expiresIn: expiresIn as jwt.SignOptions['expiresIn'] }
  );
}

export function verifyAuthToken(token: string, secret: string): JwtClaims | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!decoded || typeof decoded !== 'object') return null;
    const sub = String(decoded.sub || '');
    const email = String((decoded as Record<string, unknown>).email || '');
    const name = String((decoded as Record<string, unknown>).name || '');
    const role = (decoded as Record<string, unknown>).role === 'admin' ? 'admin' : 'customer';
    if (!sub || !email) return null;
    return { sub, email, name, role };
  } catch {
    return null;
  }
}

export function sanitizeNoSqlInput<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNoSqlInput(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      clean[key] = sanitizeNoSqlInput(val);
    }
    return clean as T;
  }
  return value;
}

interface FirebaseServiceAccount {
  project_id: string;
  client_email?: string;
}

let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function fetchGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAt > now) {
    return cachedGoogleCerts.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Unable to fetch Firebase public signing certificates');
  }
  const certs = (await resp.json()) as Record<string, string>;
  cachedGoogleCerts = { certs, expiresAt: now + 3600 * 1000 };
  return certs;
}

export interface VerifiedFirebaseIdentity {
  uid: string;
  email: string;
  name: string;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  serviceAccountBase64: string
): Promise<VerifiedFirebaseIdentity> {
  if (!serviceAccountBase64) {
    throw new Error('Firebase server verification is not configured (FIREBASE_SERVICE_ACCOUNT_BASE64 missing)');
  }

  let serviceAccount: FirebaseServiceAccount;
  try {
    const rawJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
    serviceAccount = JSON.parse(rawJson) as FirebaseServiceAccount;
  } catch {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_BASE64 configuration');
  }

  if (!serviceAccount.project_id) {
    throw new Error('Firebase service account missing project_id');
  }

  const decodedComplete = jwt.decode(idToken, { complete: true });
  if (!decodedComplete || typeof decodedComplete === 'string') {
    throw new Error('Malformed Firebase ID token');
  }

  const kid = decodedComplete.header.kid;
  if (!kid) {
    throw new Error('Firebase ID token missing key id');
  }

  const certs = await fetchGooglePublicCerts();
  const cert = certs[kid];
  if (!cert) {
    throw new Error('Firebase token signing key not recognized');
  }

  const verified = jwt.verify(idToken, cert, {
    algorithms: ['RS256'],
    audience: serviceAccount.project_id,
    issuer: `https://securetoken.google.com/${serviceAccount.project_id}`,
  }) as jwt.JwtPayload;

  const uid = typeof verified.sub === 'string' ? verified.sub : '';
  const email = typeof verified.email === 'string' ? verified.email.toLowerCase() : '';
  const phone = typeof verified.phone_number === 'string' ? verified.phone_number : '';
  const name =
    typeof verified.name === 'string' && verified.name.trim()
      ? verified.name.trim()
      : email
        ? email.split('@')[0]
        : phone || 'Customer';

  if (!uid) {
    throw new Error('Firebase ID token missing subject');
  }

  return {
    uid,
    email: email || `${uid}@phone.firebase.local`,
    name,
  };
}
