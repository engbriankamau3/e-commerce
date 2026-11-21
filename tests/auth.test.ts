import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { loadBackendEnv } from '../backend/src/config/env.ts';
import { LocalDataStore } from '../backend/src/db/store.ts';
import { createBackendApp } from '../backend/src/app.ts';
import { verifyDarajaSandboxAuthorization } from '../backend/src/services/diagnostics.ts';
import { isLegacyPlaintextHash } from '../backend/src/utils/security.ts';

function setupTestServer(envOverrides: Record<string, string | undefined> = {}) {
  const store = new LocalDataStore({ persistFile: null });
  const env = loadBackendEnv({
    NODE_ENV: 'test',
    JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
    ADMIN_EMAIL: 'admin@kora.test',
    ADMIN_PASSWORD: 'admin-password-123',
    MPESA_USD_TO_KES_RATE: '130',
    ...envOverrides,
  });
  const app = createBackendApp({ store, env });
  return { app, store, env };
}

describe('Authentication, scrypt hashing, and Admin RBAC', () => {
  it('registers with consistent name/email/password, hashes with scrypt, and logs in', async () => {
    const { app, store } = setupTestServer();

    const reg = await request(app).post('/api/auth/register').send({
      name: 'Amina Odhiambo',
      email: 'amina@example.com',
      password: 'strong-password-99',
    });

    expect(reg.status).toBe(201);
    expect(reg.body.user.name).toBe('Amina Odhiambo');
    expect(reg.body.user.email).toBe('amina@example.com');
    expect(reg.body.token).toBeTruthy();

    const stored = await store.findUserByEmail('amina@example.com');
    expect(stored).toBeTruthy();
    expect(stored!.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(stored!.passwordHash).not.toContain('strong-password-99');

    const badLogin = await request(app).post('/api/auth/login').send({
      email: 'amina@example.com',
      password: 'wrong-password',
    });
    expect(badLogin.status).toBe(401);
    expect(badLogin.body.error).toMatch(/invalid/i);

    const okLogin = await request(app).post('/api/auth/login').send({
      email: 'amina@example.com',
      password: 'strong-password-99',
    });
    expect(okLogin.status).toBe(200);
    expect(okLogin.body.token).toBeTruthy();
  });

  it('transparently upgrades legacy plaintext passwords to salted scrypt on successful login', async () => {
    const { app, store } = setupTestServer();

    await store.createUser({
      id: 'usr-legacy-1',
      name: 'Legacy User',
      email: 'legacy@example.com',
      passwordHash: 'legacy-plain-pass',
      role: 'customer',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const before = await store.findUserByEmail('legacy@example.com');
    expect(isLegacyPlaintextHash(before!.passwordHash)).toBe(true);

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'legacy@example.com',
      password: 'legacy-plain-pass',
    });
    expect(loginRes.status).toBe(200);

    const after = await store.findUserByEmail('legacy@example.com');
    expect(isLegacyPlaintextHash(after!.passwordHash)).toBe(false);
    expect(after!.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('protects admin product, CJ, upload, and paid-order routes with admin JWT middleware', async () => {
    const { app } = setupTestServer();

    // Unauthenticated requests must be rejected
    const unauthAdd = await request(app).post('/addproduct').send({ name: 'Test' });
    expect(unauthAdd.status).toBe(401);

    const unauthCj = await request(app).get('/admin/cj/products');
    expect(unauthCj.status).toBe(401);

    const unauthPaid = await request(app).get('/admin/orders/paid');
    expect(unauthPaid.status).toBe(401);

    // Customer token must be rejected with 403
    const custReg = await request(app).post('/api/auth/register').send({
      name: 'Regular Shopper',
      email: 'shopper@example.com',
      password: 'password1234',
    });
    const custAttempt = await request(app)
      .get('/admin/orders/paid')
      .set('Authorization', `Bearer ${custReg.body.token}`);
    expect(custAttempt.status).toBe(403);

    // Valid admin login succeeds and grants access
    const adminLogin = await request(app).post('/api/admin/login').send({
      email: 'admin@kora.test',
      password: 'admin-password-123',
    });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.token;

    const addRes = await request(app)
      .post('/addproduct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Field Brass Compass',
        category: 'Objects',
        description: 'Solid turned brass pocket compass with oil-damped dial.',
        images: ['/src/assets/images/prod_titanium_watch_1795286029771.jpg'],
        retailPriceCents: 6500,
        variants: [{ sku: 'KRA-CMP-01', label: 'Brushed Brass', stock: 12 }],
      });
    expect(addRes.status).toBe(201);
    expect(addRes.body.product.retailPriceCents).toBe(6500);

    const paidRes = await request(app)
      .get('/admin/orders/paid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(paidRes.status).toBe(200);
    expect(Array.isArray(paidRes.body.orders)).toBe(true);
  });

  it('rejects Firebase auth cleanly when FIREBASE_SERVICE_ACCOUNT_BASE64 is unconfigured', async () => {
    const { app } = setupTestServer({ FIREBASE_SERVICE_ACCOUNT_BASE64: '' });
    const res = await request(app)
      .post('/auth/firebase')
      .send({ idToken: 'header.payload.signature_mock_token' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/FIREBASE_SERVICE_ACCOUNT_BASE64/i);
  });

  it('protects /admin/diagnostics with admin JWT and never exposes raw secret values', async () => {
    const { app } = setupTestServer({
      STRIPE_WEBHOOK_SECRET: 'whsec_test_super_secret_do_not_expose',
    });

    const unauth = await request(app).get('/admin/diagnostics');
    expect(unauth.status).toBe(401);

    const custReg = await request(app).post('/api/auth/register').send({
      name: 'Shopper Two',
      email: 'shopper2@example.com',
      password: 'password1234',
    });
    const custTry = await request(app)
      .get('/admin/diagnostics')
      .set('Authorization', `Bearer ${custReg.body.token}`);
    expect(custTry.status).toBe(403);

    const adminLogin = await request(app).post('/api/admin/login').send({
      email: 'admin@kora.test',
      password: 'admin-password-123',
    });
    const diagRes = await request(app)
      .get('/admin/diagnostics')
      .set('Authorization', `Bearer ${adminLogin.body.token}`);

    expect(diagRes.status).toBe(200);
    expect(diagRes.body.dbMode).toBe('local');
    expect(Array.isArray(diagRes.body.entries)).toBe(true);
    const serialized = JSON.stringify(diagRes.body);
    expect(serialized).not.toContain('admin-password-123');
    expect(serialized).not.toContain('whsec_test_super_secret_do_not_expose');
    expect(serialized).not.toContain('test_jwt_secret_minimum_32_characters_long');
  });

  it('verifies Daraja sandbox authorization for MPESA_CONSUMER_KEY and MPESA_PASSKEY without leaking secrets', async () => {
    const baseOverrides = {
      NODE_ENV: 'test',
      JWT_SECRET: 'test_jwt_secret_minimum_32_characters_long',
      ADMIN_EMAIL: 'admin@kora.test',
      ADMIN_PASSWORD: 'admin-password-123',
      MPESA_CONSUMER_KEY: 'sandbox_consumer_key_secret_123',
      MPESA_CONSUMER_SECRET: 'sandbox_consumer_sec_secret_456',
      MPESA_SHORTCODE: '174379',
      MPESA_PASSKEY: 'sandbox_passkey_secret_789012',
    };

    // 1. Authorized OAuth + Passkey STK query pass-through ("The transaction does not exist.")
    const okFetch = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.includes('/oauth/v1/generate')) {
        return new Response(JSON.stringify({ access_token: 'daraja_tok_live_secret_abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          errorCode: '500.001.1001',
          errorMessage: 'The transaction does not exist.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const okResult = await verifyDarajaSandboxAuthorization(
      loadBackendEnv(baseOverrides),
      okFetch
    );
    expect(okResult.endpoint).toBe('https://sandbox.safaricom.co.ke');
    expect(okResult.status).toBe('WORKING');
    expect(okResult.oauthAuthorized).toBe(true);
    expect(okResult.stkAuthorized).toBe(true);
    expect(JSON.stringify(okResult)).not.toContain('sandbox_consumer_key_secret_123');
    expect(JSON.stringify(okResult)).not.toContain('sandbox_passkey_secret_789012');
    expect(JSON.stringify(okResult)).not.toContain('daraja_tok_live_secret_abc');

    // 2. Consumer key rejected on OAuth
    const badKeyFetch = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({ errorCode: '400.008.02', errorMessage: 'Invalid Authentication' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const badKeyResult = await verifyDarajaSandboxAuthorization(
      loadBackendEnv(baseOverrides),
      badKeyFetch
    );
    expect(badKeyResult.status).toBe('INVALID');
    expect(badKeyResult.oauthAuthorized).toBe(false);
    expect(badKeyResult.stkAuthorized).toBe(false);

    // 3. OAuth ok, Passkey / Shortcode rejected ("Wrong credentials")
    const badPasskeyFetch = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.includes('/oauth/v1/generate')) {
        return new Response(JSON.stringify({ access_token: 'daraja_tok_abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ errorCode: '500.001.1001', errorMessage: 'Wrong credentials' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const badPasskeyResult = await verifyDarajaSandboxAuthorization(
      loadBackendEnv(baseOverrides),
      badPasskeyFetch
    );
    expect(badPasskeyResult.status).toBe('INVALID');
    expect(badPasskeyResult.oauthAuthorized).toBe(true);
    expect(badPasskeyResult.stkAuthorized).toBe(false);

    // 4. Route RBAC on POST /admin/diagnostics/daraja-sandbox
    const { app } = setupTestServer();
    const unauth = await request(app).post('/admin/diagnostics/daraja-sandbox');
    expect(unauth.status).toBe(401);

    const adminLogin = await request(app).post('/api/admin/login').send({
      email: 'admin@kora.test',
      password: 'admin-password-123',
    });
    const adminCheck = await request(app)
      .post('/admin/diagnostics/daraja-sandbox')
      .set('Authorization', `Bearer ${adminLogin.body.token}`);
    expect(adminCheck.status).toBe(200);
    expect(adminCheck.body.status).toBe('UNCONFIGURED');
    expect(adminCheck.body.oauthAuthorized).toBe(false);
    expect(adminCheck.body.stkAuthorized).toBe(false);
  });
});
