import crypto from 'node:crypto';
import type { BackendEnv } from '../config/env.ts';
import type { DataStore } from '../db/store.ts';

function darajaBaseUrl(env: BackendEnv): string {
  return env.mpesaEnv === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
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

async function getDarajaAccessToken(env: BackendEnv): Promise<string> {
  const creds = Buffer.from(`${env.mpesaConsumerKey}:${env.mpesaConsumerSecret}`).toString(
    'base64'
  );
  const resp = await fetch(
    `${darajaBaseUrl(env)}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${creds}` },
    }
  );
  if (!resp.ok) {
    throw new Error(`Daraja OAuth failed (${resp.status})`);
  }
  const json = (await resp.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Daraja OAuth did not return an access_token');
  }
  return json.access_token;
}

export async function initiateDarajaStkPush(options: {
  env: BackendEnv;
  orderReference: string;
  phoneNumber: string;
  amountKesWhole: number;
}): Promise<{ checkoutRequestId: string; merchantRequestId: string; customerMessage: string }> {
  const { env, orderReference, phoneNumber, amountKesWhole } = options;

  if (
    !env.mpesaConsumerKey ||
    !env.mpesaConsumerSecret ||
    !env.mpesaShortcode ||
    !env.mpesaPasskey ||
    !env.mpesaCallbackUrl
  ) {
    throw new Error(
      'Safaricom Daraja M-Pesa is not configured (missing consumer credentials, shortcode, passkey, or callback URL)'
    );
  }

  const token = await getDarajaAccessToken(env);
  const timestamp = formatDarajaTimestamp();
  const password = Buffer.from(`${env.mpesaShortcode}${env.mpesaPasskey}${timestamp}`).toString(
    'base64'
  );

  const payload = {
    BusinessShortCode: env.mpesaShortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amountKesWhole),
    PartyA: phoneNumber,
    PartyB: env.mpesaShortcode,
    PhoneNumber: phoneNumber,
    CallBackURL: env.mpesaCallbackUrl,
    AccountReference: orderReference,
    TransactionDesc: `Kora Order ${orderReference}`,
  };

  const resp = await fetch(`${darajaBaseUrl(env)}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = (await resp.json()) as {
    ResponseCode?: string;
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    CustomerMessage?: string;
    errorMessage?: string;
  };

  if (!resp.ok || body.ResponseCode !== '0' || !body.CheckoutRequestID) {
    throw new Error(body.errorMessage || body.CustomerMessage || 'M-Pesa STK Push initiation failed');
  }

  return {
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID || '',
    customerMessage: body.CustomerMessage || 'STK Push sent to phone',
  };
}

export interface ParsedMpesaCallback {
  checkoutRequestId: string;
  merchantRequestId?: string;
  resultCode: number;
  resultDesc: string;
  amountKesWhole?: number;
  mpesaReceiptNumber?: string;
  phoneNumber?: string;
}

/**
 * Normalizes both Daraja JSON callbacks (`Body.stkCallback`) and URL-encoded form payloads.
 */
export function parseMpesaCallbackPayload(rawBody: unknown): ParsedMpesaCallback | null {
  if (!rawBody || typeof rawBody !== 'object') return null;

  let root = rawBody as Record<string, unknown>;

  // Support form-encoded wrapper where payload is passed as `payload` or `stkCallback` JSON string
  if (typeof root.payload === 'string') {
    try {
      root = JSON.parse(root.payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof root.stkCallback === 'string') {
    try {
      root = { Body: { stkCallback: JSON.parse(root.stkCallback) } };
    } catch {
      return null;
    }
  }

  const bodyObj = (root.Body as Record<string, unknown> | undefined) || root;
  const stk = (bodyObj.stkCallback as Record<string, unknown> | undefined) || bodyObj;

  // Flat form-encoded fallback (e.g. CheckoutRequestID=...&ResultCode=0&Amount=1300&MpesaReceiptNumber=...)
  const checkoutRequestId = String(stk.CheckoutRequestID || stk.checkoutRequestId || '').trim();
  const resultCodeRaw = stk.ResultCode ?? stk.resultCode;
  if (!checkoutRequestId || resultCodeRaw === undefined || resultCodeRaw === null) {
    return null;
  }

  const resultCode = Number(resultCodeRaw);
  const resultDesc = String(stk.ResultDesc || stk.resultDesc || '');
  const merchantRequestId = stk.MerchantRequestID ? String(stk.MerchantRequestID) : undefined;

  let amountKesWhole: number | undefined;
  let mpesaReceiptNumber: string | undefined;
  let phoneNumber: string | undefined;

  const meta = stk.CallbackMetadata as
    | { Item?: Array<{ Name: string; Value?: unknown }> }
    | undefined;
  if (meta && Array.isArray(meta.Item)) {
    for (const item of meta.Item) {
      if (item.Name === 'Amount' && item.Value !== undefined) {
        amountKesWhole = Number(item.Value);
      } else if (item.Name === 'MpesaReceiptNumber' && item.Value !== undefined) {
        mpesaReceiptNumber = String(item.Value);
      } else if (item.Name === 'PhoneNumber' && item.Value !== undefined) {
        phoneNumber = String(item.Value);
      }
    }
  } else {
    if (stk.Amount !== undefined) amountKesWhole = Number(stk.Amount);
    if (stk.MpesaReceiptNumber !== undefined) mpesaReceiptNumber = String(stk.MpesaReceiptNumber);
    if (stk.PhoneNumber !== undefined) phoneNumber = String(stk.PhoneNumber);
  }

  return {
    checkoutRequestId,
    merchantRequestId,
    resultCode,
    resultDesc,
    amountKesWhole,
    mpesaReceiptNumber,
    phoneNumber,
  };
}

export async function processMpesaVerification(options: {
  parsed: ParsedMpesaCallback;
  store: DataStore;
}): Promise<{
  found: boolean;
  orderReference?: string;
  paymentStatus?: string;
  message: string;
}> {
  const { parsed, store } = options;
  const order = await store.getOrderByMpesaCheckoutRequestId(parsed.checkoutRequestId);
  if (!order) {
    return { found: false, message: 'Order not found for CheckoutRequestID' };
  }

  const expectedKesWhole = Math.round(order.chargedAmountMinor / 100);

  if (parsed.resultCode !== 0) {
    if (order.paymentStatus === 'PENDING') {
      order.paymentStatus = 'FAILED';
      order.updatedAt = new Date().toISOString();
      await store.updateOrder(order);
    }
    await store.recordPaymentAttempt({
      id: `pa-${crypto.randomUUID()}`,
      orderReference: order.orderReference,
      provider: 'mpesa',
      expectedAmountMinor: order.chargedAmountMinor,
      expectedCurrency: 'KES',
      receivedAmountMinor:
        parsed.amountKesWhole !== undefined ? Math.round(parsed.amountKesWhole * 100) : undefined,
      receivedCurrency: 'KES',
      status: 'FAILED',
      message: parsed.resultDesc || `Daraja ResultCode=${parsed.resultCode}`,
      createdAt: new Date().toISOString(),
    });
    return {
      found: true,
      orderReference: order.orderReference,
      paymentStatus: order.paymentStatus,
      message: parsed.resultDesc || 'M-Pesa payment failed or cancelled',
    };
  }

  const receivedKesWhole =
    parsed.amountKesWhole !== undefined ? Math.round(parsed.amountKesWhole) : -1;

  if (receivedKesWhole !== expectedKesWhole) {
    // Keep order PENDING — never falsely mark PAID on amount mismatch
    await store.recordPaymentAttempt({
      id: `pa-${crypto.randomUUID()}`,
      orderReference: order.orderReference,
      provider: 'mpesa',
      expectedAmountMinor: order.chargedAmountMinor,
      expectedCurrency: 'KES',
      receivedAmountMinor: receivedKesWhole >= 0 ? receivedKesWhole * 100 : undefined,
      receivedCurrency: 'KES',
      status: 'AMOUNT_MISMATCH',
      message: `M-Pesa amount mismatch: expected KES ${expectedKesWhole}, received KES ${receivedKesWhole}`,
      createdAt: new Date().toISOString(),
    });
    return {
      found: true,
      orderReference: order.orderReference,
      paymentStatus: order.paymentStatus,
      message: `Amount mismatch: expected KES ${expectedKesWhole}`,
    };
  }

  if (order.paymentStatus !== 'PAID') {
    order.paymentStatus = 'PAID';
    if (order.fulfillmentStatus === 'AWAITING_PAYMENT') {
      order.fulfillmentStatus = 'PROCESSING';
    }
    if (parsed.mpesaReceiptNumber) {
      order.providerRefs.mpesaReceiptNumber = parsed.mpesaReceiptNumber;
    }
    if (parsed.phoneNumber) {
      order.providerRefs.mpesaPhoneNumber = parsed.phoneNumber;
    }
    order.updatedAt = new Date().toISOString();
    await store.updateOrder(order);
  }

  await store.recordPaymentAttempt({
    id: `pa-${crypto.randomUUID()}`,
    orderReference: order.orderReference,
    provider: 'mpesa',
    expectedAmountMinor: order.chargedAmountMinor,
    expectedCurrency: 'KES',
    receivedAmountMinor: receivedKesWhole * 100,
    receivedCurrency: 'KES',
    status: 'VERIFIED',
    message: `Verified M-Pesa payment (${parsed.mpesaReceiptNumber || 'no receipt'})`,
    createdAt: new Date().toISOString(),
  });

  return {
    found: true,
    orderReference: order.orderReference,
    paymentStatus: order.paymentStatus,
    message: 'M-Pesa payment verified',
  };
}

export async function queryDarajaStkStatus(options: {
  env: BackendEnv;
  checkoutRequestId: string;
}): Promise<{ resultCode: number; resultDesc: string }> {
  const { env, checkoutRequestId } = options;
  if (!env.mpesaConsumerKey || !env.mpesaConsumerSecret || !env.mpesaShortcode || !env.mpesaPasskey) {
    throw new Error('Safaricom Daraja credentials are not configured');
  }
  const token = await getDarajaAccessToken(env);
  const timestamp = formatDarajaTimestamp();
  const password = Buffer.from(`${env.mpesaShortcode}${env.mpesaPasskey}${timestamp}`).toString(
    'base64'
  );

  const resp = await fetch(`${darajaBaseUrl(env)}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: env.mpesaShortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  const data = (await resp.json()) as {
    ResultCode?: string | number;
    ResultDesc?: string;
    errorMessage?: string;
  };
  if (!resp.ok || data.ResultCode === undefined) {
    throw new Error(data.errorMessage || 'Unable to query M-Pesa transaction status');
  }

  return {
    resultCode: Number(data.ResultCode),
    resultDesc: String(data.ResultDesc || ''),
  };
}
