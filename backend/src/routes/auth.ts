import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { loginSchema, registerSchema } from '../../../shared/src/validators.ts';
import type { PublicUser, UserRecord } from '../../../shared/src/types.ts';
import type { BackendEnv } from '../config/env.ts';
import type { DataStore } from '../db/store.ts';
import { createAuthMiddleware, SESSION_COOKIE_NAME } from '../middleware/auth.ts';
import {
  hashPassword,
  isLegacyPlaintextHash,
  signAuthToken,
  verifyFirebaseIdToken,
  verifyPassword,
} from '../utils/security.ts';

function emitSessionCookie(req: import('express').Request, res: import('express').Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    partitioned: isHttps,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

const adminSetupSchema = z.object({
  email: z.string().trim().email('Enter a valid admin email').toLowerCase(),
  password: z.string().min(8, 'Admin password must be at least 8 characters').max(128),
});

const firebaseAuthSchema = z.object({
  idToken: z.string().min(10, 'Firebase idToken is required'),
});

export function createAuthRouter(store: DataStore, env: BackendEnv): Router {
  const router = Router();
  const { requireUserAuth } = createAuthMiddleware(env.jwtSecret);

  router.post('/api/auth/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data' });
      return;
    }

    const { name, email, password } = parsed.data;
    const existing = await store.findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const now = new Date().toISOString();
    const user: UserRecord = {
      id: `usr-${crypto.randomUUID()}`,
      name,
      email,
      passwordHash: hashPassword(password),
      role: 'customer',
      createdAt: now,
      updatedAt: now,
    };

    await store.createUser(user);
    const pub = toPublicUser(user);
    const token = signAuthToken(pub, env.jwtSecret);
    emitSessionCookie(req, res, token);
    res.status(201).json({ token, user: pub });
  });

  router.post('/api/auth/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid login credentials' });
      return;
    }

    const { email, password } = parsed.data;
    const user = await store.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Transparently upgrade legacy plaintext passwords to salted scrypt on successful login
    if (isLegacyPlaintextHash(user.passwordHash)) {
      const upgradedHash = hashPassword(password);
      await store.updateUserPasswordHash(user.id, upgradedHash);
    }

    const pub = toPublicUser(user);
    const token = signAuthToken(pub, env.jwtSecret);
    emitSessionCookie(req, res, token);
    res.json({ token, user: pub });
  });

  router.post('/api/auth/logout', (req, res) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      partitioned: isHttps,
      path: '/',
    });
    res.json({ ok: true });
  });

  const handleFirebaseAuth = async (req: import('express').Request, res: import('express').Response) => {
    const parsed = firebaseAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Missing Firebase token' });
      return;
    }

    try {
      const identity = await verifyFirebaseIdToken(
        parsed.data.idToken,
        env.firebaseServiceAccountBase64
      );
      let user =
        (await store.findUserByFirebaseUid(identity.uid)) ||
        (await store.findUserByEmail(identity.email));

      if (!user) {
        const now = new Date().toISOString();
        user = await store.createUser({
          id: `usr-${crypto.randomUUID()}`,
          name: identity.name,
          email: identity.email,
          passwordHash: hashPassword(crypto.randomBytes(32).toString('hex')),
          firebaseUid: identity.uid,
          role: 'customer',
          createdAt: now,
          updatedAt: now,
        });
      }

      const pub = toPublicUser(user);
      const token = signAuthToken(pub, env.jwtSecret);
      emitSessionCookie(req, res, token);
      res.json({ token, user: pub });
    } catch (err) {
      const message = (err as Error).message || 'Firebase authentication failed';
      const status = message.includes('not configured') ? 503 : 401;
      res.status(status).json({ error: message });
    }
  };

  router.post('/api/auth/firebase', handleFirebaseAuth);
  router.post('/auth/firebase', handleFirebaseAuth);

  router.get('/api/auth/me', requireUserAuth, async (req, res) => {
    const claims = req.authUser!;
    const user = await store.findUserById(claims.sub);
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json({ user: toPublicUser(user) });
  });

  router.get('/api/admin/setup-status', async (_req, res) => {
    const configuredViaEnv = Boolean(env.adminEmail && env.adminPassword);
    const claimed = await store.getClaimedAdmin();
    res.json({
      configuredViaEnv,
      claimed: Boolean(claimed),
      needsFirstRunSetup: !configuredViaEnv && !claimed,
    });
  });

  router.post('/api/admin/setup', async (req, res) => {
    if (env.adminEmail && env.adminPassword) {
      res.status(409).json({
        error: 'Admin credentials are managed by environment variables (ADMIN_EMAIL / ADMIN_PASSWORD)',
      });
      return;
    }

    const parsed = adminSetupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid admin setup data' });
      return;
    }

    const claimed = await store.claimAdmin(parsed.data.email, hashPassword(parsed.data.password));
    if (!claimed) {
      res.status(409).json({ error: 'Admin account has already been claimed' });
      return;
    }

    const adminUser: PublicUser = {
      id: 'admin-primary',
      name: 'Store Administrator',
      email: parsed.data.email,
      role: 'admin',
    };
    const token = signAuthToken(adminUser, env.jwtSecret, '12h');
    res.status(201).json({ token, admin: adminUser });
  });

  router.post('/api/admin/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid admin credentials' });
      return;
    }

    const { email, password } = parsed.data;

    // Configured env ADMIN_EMAIL / ADMIN_PASSWORD always overrides any claimed fallback
    if (env.adminEmail && env.adminPassword) {
      const emailMatches = email === env.adminEmail;
      const a = Buffer.from(password, 'utf8');
      const b = Buffer.from(env.adminPassword, 'utf8');
      const passMatches = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!emailMatches || !passMatches) {
        res.status(401).json({ error: 'Invalid administrator email or password' });
        return;
      }
      const adminUser: PublicUser = {
        id: 'admin-env',
        name: 'Store Administrator',
        email: env.adminEmail,
        role: 'admin',
      };
      const token = signAuthToken(adminUser, env.jwtSecret, '12h');
      res.json({ token, admin: adminUser });
      return;
    }

    const claimed = await store.getClaimedAdmin();
    if (!claimed) {
      res.status(403).json({
        error: 'Administrator account is not set up yet. Complete first-run admin setup first.',
      });
      return;
    }

    if (email !== claimed.email || !verifyPassword(password, claimed.passwordHash)) {
      res.status(401).json({ error: 'Invalid administrator email or password' });
      return;
    }

    const adminUser: PublicUser = {
      id: 'admin-claimed',
      name: 'Store Administrator',
      email: claimed.email,
      role: 'admin',
    };
    const token = signAuthToken(adminUser, env.jwtSecret, '12h');
    res.json({ token, admin: adminUser });
  });

  return router;
}
