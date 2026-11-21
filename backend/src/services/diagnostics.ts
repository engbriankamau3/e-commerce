import mongoose from 'mongoose';
import Stripe from 'stripe';
import type { BackendEnv } from '../config/env.ts';

export type DiagnosticStatus =
  | 'WORKING'
  | 'CONFIGURED'
  | 'UNCONFIGURED'
  | 'MISCONFIGURED'
  | 'INVALID'
  | 'BLOCKED';

export interface DiagnosticEntry {
  name: string;
  status: DiagnosticStatus;
  detail: string;
}

export interface DarajaSandboxCheckResult {
  endpoint: string;
  mpesaEnvConfigured: 'sandbox' | 'production';
  status: DiagnosticStatus;
  oauthAuthorized: boolean;
  stkAuthorized: boolean;
  oauthHttpStatus?: number;
  stkHttpStatus?: number;
  darajaCode?: string;
  detail: string;
}

function sanitizeErrorMessage(err: unknown, env?: BackendEnv): string {
  let msg = String((err as Error)?.message || err || 'Unknown error')
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://***@')
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, 'sk_$1_***')
    .replace(/whsec_[A-Za-z0-9]+/g, 'whsec_***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic ***');

  if (env) {
    const secrets = [
      env.mpesaConsumerKey,
      env.mpesaConsumerSecret,
      env.mpesaPasskey,
      env.stripeSecretKey,
      env.stripeWebhookSecret,
      env.cjApiKey,
      env.jwtSecret,
      env.adminPassword,
    ].filter((s) => Boolean(s && s.length >= 6));
    for (const secret of secrets) {
      msg = msg.split(secret).join('***');
    }
  }

  return msg.slice(0, 220);
}

function formatDarajaTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

const DARAJA_SANDBOX_BASE = 'https://sandbox.safaricom.co.ke';

/**
 * Queries the Safaricom Daraja sandbox API (`sandbox.safaricom.co.ke`) in two stages:
 * 1. OAuth client_credentials (`MPESA_CONSUMER_KEY` + `MPESA_CONSUMER_SECRET`)
 * 2. Read-only STK Push Query (`POST /mpesa/stkpushquery/v1/query`) signed with
 *    `BusinessShortCode` + `MPESA_PASSKEY` + `Timestamp` to verify whether the app and
 *    passkey are authorized to initiate Lipa Na M-Pesa requests without triggering a phone prompt.
 */
export async function verifyDarajaSandboxAuthorization(
  env: BackendEnv,
  fetchFn: typeof fetch = fetch
): Promise<DarajaSandboxCheckResult> {
  const missing: string[] = [];
  if (!env.mpesaConsumerKey) missing.push('MPESA_CONSUMER_KEY');
  if (!env.mpesaConsumerSecret) missing.push('MPESA_CONSUMER_SECRET');
  if (!env.mpesaShortcode) missing.push('MPESA_SHORTCODE');
  if (!env.mpesaPasskey) missing.push('MPESA_PASSKEY');

  if (missing.length > 0) {
    const anyPresent = Boolean(
      env.mpesaConsumerKey || env.mpesaConsumerSecret || env.mpesaShortcode || env.mpesaPasskey
    );
    return {
      endpoint: DARAJA_SANDBOX_BASE,
      mpesaEnvConfigured: env.mpesaEnv,
      status: anyPresent ? 'MISCONFIGURED' : 'UNCONFIGURED',
      oauthAuthorized: false,
      stkAuthorized: false,
      detail: `Missing required variable(s) for Daraja sandbox authorization check: ${missing.join(', ')}.`,
    };
  }

  // Step 1: Verify MPESA_CONSUMER_KEY (+ MPESA_CONSUMER_SECRET) via Daraja Sandbox OAuth
  const creds = Buffer.from(`${env.mpesaConsumerKey}:${env.mpesaConsumerSecret}`).toString(
    'base64'
  );

  let accessToken = '';
  let oauthHttpStatus: number | undefined;
  try {
    const oauthResp = await fetchFn(
      `${DARAJA_SANDBOX_BASE}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${creds}` },
        signal: AbortSignal.timeout(6000),
      }
    );
    oauthHttpStatus = oauthResp.status;

    const oauthBody = (await oauthResp.json().catch(() => ({}))) as {
      access_token?: string;
      errorMessage?: string;
      errorCode?: string;
    };

    if (!oauthResp.ok || !oauthBody.access_token) {
      const errDetail = sanitizeErrorMessage(
        oauthBody.errorMessage || `HTTP ${oauthResp.status}`,
        env
      );
      return {
        endpoint: DARAJA_SANDBOX_BASE,
        mpesaEnvConfigured: env.mpesaEnv,
        status:
          oauthResp.status === 400 || oauthResp.status === 401 || oauthResp.status === 403
            ? 'INVALID'
            : 'BLOCKED',
        oauthAuthorized: false,
        stkAuthorized: false,
        oauthHttpStatus,
        darajaCode: oauthBody.errorCode ? sanitizeErrorMessage(oauthBody.errorCode, env) : undefined,
        detail: `Daraja sandbox OAuth rejected MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET (${errDetail}).`,
      };
    }

    accessToken = oauthBody.access_token;
  } catch (err) {
    return {
      endpoint: DARAJA_SANDBOX_BASE,
      mpesaEnvConfigured: env.mpesaEnv,
      status: 'BLOCKED',
      oauthAuthorized: false,
      stkAuthorized: false,
      detail: `Unable to reach Daraja sandbox OAuth endpoint: ${sanitizeErrorMessage(err, env)}`,
    };
  }

  // Step 2: Verify Lipa Na M-Pesa STK initiation authorization using BusinessShortCode + MPESA_PASSKEY
  const timestamp = formatDarajaTimestamp();
  const password = Buffer.from(`${env.mpesaShortcode}${env.mpesaPasskey}${timestamp}`).toString(
    'base64'
  );

  try {
    const stkResp = await fetchFn(`${DARAJA_SANDBOX_BASE}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: env.mpesaShortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: 'ws_CO_00000000000000000000',
      }),
      signal: AbortSignal.timeout(6500),
    });

    const stkHttpStatus = stkResp.status;
    const stkBody = (await stkResp.json().catch(() => ({}))) as {
      ResponseCode?: string;
      ResultCode?: string | number;
      ResultDesc?: string;
      errorCode?: string;
      errorMessage?: string;
    };

    const rawDarajaMessage = String(stkBody.errorMessage || stkBody.ResultDesc || '');
    const safeMsg = sanitizeErrorMessage(rawDarajaMessage || `HTTP ${stkHttpStatus}`, env);
    const safeCode = stkBody.errorCode
      ? sanitizeErrorMessage(stkBody.errorCode, env)
      : stkBody.ResponseCode
        ? sanitizeErrorMessage(stkBody.ResponseCode, env)
        : undefined;

    // Explicit auth / passkey rejection checks BEFORE transaction-not-found check
    const tokenRejected =
      stkHttpStatus === 401 ||
      stkHttpStatus === 403 ||
      /^(401|403|404\.001)/i.test(stkBody.errorCode || '') ||
      /invalid access token|unauthorized|forbidden|not subscribed|product/i.test(rawDarajaMessage);

    if (tokenRejected) {
      return {
        endpoint: DARAJA_SANDBOX_BASE,
        mpesaEnvConfigured: env.mpesaEnv,
        status: 'INVALID',
        oauthAuthorized: true,
        stkAuthorized: false,
        oauthHttpStatus,
        stkHttpStatus,
        darajaCode: safeCode,
        detail: `MPESA_CONSUMER_KEY obtained an OAuth token, but Daraja sandbox denied STK API access (${safeMsg}). Check Lipa Na M-Pesa Sandbox product subscription on your Daraja app.`,
      };
    }

    const passkeyOrShortcodeRejected =
      /^400\.002/i.test(stkBody.errorCode || '') ||
      /wrong credentials|invalid password|invalid passkey|invalid shortcode|invalid businessshortcode|merchant does not exist|shortcode does not exist|signature/i.test(
        rawDarajaMessage
      );

    if (passkeyOrShortcodeRejected) {
      return {
        endpoint: DARAJA_SANDBOX_BASE,
        mpesaEnvConfigured: env.mpesaEnv,
        status: 'INVALID',
        oauthAuthorized: true,
        stkAuthorized: false,
        oauthHttpStatus,
        stkHttpStatus,
        darajaCode: safeCode,
        detail: `OAuth succeeded, but Daraja sandbox rejected MPESA_PASSKEY / MPESA_SHORTCODE signing (${safeMsg}).`,
      };
    }

    const authorizedPassedThrough =
      stkResp.ok ||
      stkBody.ResultCode !== undefined ||
      /transaction does not exist|the transaction does not exist|transaction not found/i.test(
        rawDarajaMessage
      );

    if (authorizedPassedThrough) {
      const envNote =
        env.mpesaEnv === 'production'
          ? ' Note: MPESA_ENV is currently set to "production", while this check targeted Daraja sandbox.'
          : '';
      return {
        endpoint: DARAJA_SANDBOX_BASE,
        mpesaEnvConfigured: env.mpesaEnv,
        status: 'WORKING',
        oauthAuthorized: true,
        stkAuthorized: true,
        oauthHttpStatus,
        stkHttpStatus,
        darajaCode: safeCode,
        detail: `Authorized on Daraja sandbox: MPESA_CONSUMER_KEY (OAuth) and MPESA_PASSKEY (STK signing) passed validation (${safeMsg}).${envNote}`,
      };
    }

    return {
      endpoint: DARAJA_SANDBOX_BASE,
      mpesaEnvConfigured: env.mpesaEnv,
      status: stkHttpStatus >= 500 ? 'BLOCKED' : 'INVALID',
      oauthAuthorized: true,
      stkAuthorized: false,
      oauthHttpStatus,
      stkHttpStatus,
      darajaCode: safeCode,
      detail: `Daraja sandbox returned HTTP ${stkHttpStatus} (${safeMsg}).`,
    };
  } catch (err) {
    return {
      endpoint: DARAJA_SANDBOX_BASE,
      mpesaEnvConfigured: env.mpesaEnv,
      status: 'BLOCKED',
      oauthAuthorized: true,
      stkAuthorized: false,
      oauthHttpStatus,
      detail: `OAuth succeeded, but Daraja sandbox STK Query endpoint could not be reached: ${sanitizeErrorMessage(err, env)}`,
    };
  }
}

export async function runLiveEnvDiagnostics(
  env: BackendEnv,
  fetchFn: typeof fetch = fetch
): Promise<DiagnosticEntry[]> {
  const results: DiagnosticEntry[] = [];

  // 1. Admin & JWT
  results.push({
    name: 'ADMIN_EMAIL & ADMIN_PASSWORD',
    status: env.adminEmail && env.adminPassword ? 'CONFIGURED' : 'UNCONFIGURED',
    detail:
      env.adminEmail && env.adminPassword
        ? 'Environment-managed admin credentials active.'
        : 'Unset; preview first-run claim fallback is used.',
  });

  results.push({
    name: 'JWT_SECRET',
    status: process.env.JWT_SECRET?.trim() ? 'CONFIGURED' : 'UNCONFIGURED',
    detail: process.env.JWT_SECRET?.trim()
      ? 'Persistent JWT signing key configured.'
      : 'Using ephemeral per-process key (sessions reset on restart).',
  });

  // 2. MongoDB
  if (!env.mongodbUri) {
    results.push({
      name: 'MONGODB_URI',
      status: 'UNCONFIGURED',
      detail: 'Unset; using local .data/store.json persistence fallback.',
    });
  } else if (!env.mongodbUri.startsWith('mongodb://') && !env.mongodbUri.startsWith('mongodb+srv://')) {
    results.push({
      name: 'MONGODB_URI',
      status: 'INVALID',
      detail: 'Must start with mongodb:// or mongodb+srv://.',
    });
  } else {
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db?.admin().ping();
        results.push({
          name: 'MONGODB_URI',
          status: 'WORKING',
          detail: 'Connected and responding to ping.',
        });
      } else {
        const conn = await mongoose
          .createConnection(env.mongodbUri, { serverSelectionTimeoutMS: 4500 })
          .asPromise();
        await conn.close();
        results.push({
          name: 'MONGODB_URI',
          status: 'WORKING',
          detail: 'Handshake succeeded.',
        });
      }
    } catch (err) {
      const msg = sanitizeErrorMessage(err, env);
      const isBlocked = /timed out|ETIMEDOUT|ECONNREFUSED|whitelist|IP|Server selection/i.test(msg);
      results.push({
        name: 'MONGODB_URI',
        status: isBlocked ? 'BLOCKED' : 'INVALID',
        detail: msg,
      });
    }
  }

  // 3. Stripe
  if (!env.stripeSecretKey) {
    results.push({
      name: 'STRIPE_SECRET_KEY',
      status: 'UNCONFIGURED',
      detail: 'Stripe card checkout is disabled until configured.',
    });
  } else if (
    !env.stripeSecretKey.startsWith('sk_test_') &&
    !env.stripeSecretKey.startsWith('sk_live_') &&
    !env.stripeSecretKey.startsWith('rk_')
  ) {
    results.push({
      name: 'STRIPE_SECRET_KEY',
      status: 'INVALID',
      detail: 'Expected key starting with sk_test_, sk_live_, or rk_.',
    });
  } else {
    try {
      const stripe = new Stripe(env.stripeSecretKey);
      await stripe.balance.retrieve();
      results.push({
        name: 'STRIPE_SECRET_KEY',
        status: 'WORKING',
        detail: env.stripeSecretKey.startsWith('sk_live_')
          ? 'Verified live-mode Stripe API key.'
          : 'Verified test/restricted Stripe API key.',
      });
    } catch (err) {
      results.push({
        name: 'STRIPE_SECRET_KEY',
        status: 'INVALID',
        detail: sanitizeErrorMessage(err, env),
      });
    }
  }

  results.push({
    name: 'STRIPE_WEBHOOK_SECRET',
    status: !env.stripeWebhookSecret
      ? 'UNCONFIGURED'
      : env.stripeWebhookSecret.startsWith('whsec_')
        ? 'CONFIGURED'
        : 'MISCONFIGURED',
    detail: !env.stripeWebhookSecret
      ? 'Webhook signature verification disabled until configured.'
      : env.stripeWebhookSecret.startsWith('whsec_')
        ? 'Valid whsec_ signing secret format.'
        : 'Expected secret starting with whsec_.',
  });

  // 4. M-Pesa Daraja
  results.push({
    name: 'MPESA_USD_TO_KES_RATE',
    status: env.mpesaUsdToKesRate ? 'CONFIGURED' : 'UNCONFIGURED',
    detail: env.mpesaUsdToKesRate
      ? `Explicit conversion rate active (1 USD = ${env.mpesaUsdToKesRate} KES).`
      : 'Unset; M-Pesa USD-to-KES conversion is refused.',
  });

  if (!env.mpesaCallbackUrl) {
    results.push({
      name: 'MPESA_CALLBACK_URL',
      status: 'UNCONFIGURED',
      detail: 'Required for Daraja STK Push callbacks.',
    });
  } else {
    try {
      const u = new URL(env.mpesaCallbackUrl);
      const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      results.push({
        name: 'MPESA_CALLBACK_URL',
        status: u.protocol === 'https:' && !isLocal ? 'CONFIGURED' : 'MISCONFIGURED',
        detail:
          u.protocol === 'https:' && !isLocal
            ? 'Valid public HTTPS callback URL.'
            : 'Daraja requires a public HTTPS URL (cannot be localhost or plain HTTP).',
      });
    } catch {
      results.push({
        name: 'MPESA_CALLBACK_URL',
        status: 'INVALID',
        detail: 'Malformed callback URL.',
      });
    }
  }

  results.push({
    name: 'MPESA_SHORTCODE & MPESA_PASSKEY',
    status:
      env.mpesaShortcode && env.mpesaPasskey
        ? 'CONFIGURED'
        : env.mpesaShortcode || env.mpesaPasskey
          ? 'MISCONFIGURED'
          : 'UNCONFIGURED',
    detail:
      env.mpesaShortcode && env.mpesaPasskey
        ? 'Shortcode and passkey present.'
        : env.mpesaShortcode || env.mpesaPasskey
          ? 'Both MPESA_SHORTCODE and MPESA_PASSKEY must be provided together.'
          : 'Not set.',
  });

  const darajaSandboxCheck = await verifyDarajaSandboxAuthorization(env, fetchFn);
  results.push({
    name: 'DARAJA_SANDBOX_AUTH (CONSUMER_KEY + PASSKEY)',
    status: darajaSandboxCheck.status,
    detail: darajaSandboxCheck.detail,
  });

  // 5. CJ Dropshipping
  if (!env.cjApiKey) {
    results.push({
      name: 'CJ_API_KEY',
      status: 'UNCONFIGURED',
      detail: 'Using bundled CJ preview catalog.',
    });
  } else {
    try {
      const resp = await fetchFn(
        'https://developers.cjdropshipping.com/api2.0/v1/product/list?pageNum=1&pageSize=1',
        {
          headers: { 'CJ-Access-Token': env.cjApiKey },
          signal: AbortSignal.timeout(5500),
        }
      );
      const body = (await resp.json().catch(() => ({}))) as { result?: boolean; message?: string };
      results.push({
        name: 'CJ_API_KEY',
        status: resp.ok && body.result ? 'WORKING' : 'INVALID',
        detail:
          resp.ok && body.result
            ? 'Authenticated with CJ Dropshipping API.'
            : `CJ API rejected token (HTTP ${resp.status}: ${sanitizeErrorMessage(body.message || 'invalid or expired', env)}).`,
      });
    } catch (err) {
      results.push({
        name: 'CJ_API_KEY',
        status: 'BLOCKED',
        detail: sanitizeErrorMessage(err, env),
      });
    }
  }

  // 6. Firebase Server Account
  if (!env.firebaseServiceAccountBase64) {
    results.push({
      name: 'FIREBASE_SERVICE_ACCOUNT_BASE64',
      status: 'UNCONFIGURED',
      detail: 'Optional Firebase ID token verification is disabled.',
    });
  } else {
    try {
      const decoded = JSON.parse(
        Buffer.from(env.firebaseServiceAccountBase64, 'base64').toString('utf8')
      ) as { project_id?: string; client_email?: string; private_key?: string };
      const valid = Boolean(decoded.project_id && decoded.client_email && decoded.private_key);
      results.push({
        name: 'FIREBASE_SERVICE_ACCOUNT_BASE64',
        status: valid ? 'CONFIGURED' : 'MISCONFIGURED',
        detail: valid
          ? `Valid service account JSON (project: ${decoded.project_id}).`
          : 'Decoded JSON is missing project_id, client_email, or private_key.',
      });
    } catch {
      results.push({
        name: 'FIREBASE_SERVICE_ACCOUNT_BASE64',
        status: 'INVALID',
        detail: 'Could not decode as Base64 JSON.',
      });
    }
  }

  return results;
}
