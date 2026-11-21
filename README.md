# Kora & Co. — Unified E-Commerce Monorepo

A consolidated full-stack e-commerce platform built around one authoritative backend API with clear separation of concerns across `frontend/`, `backend/`, `admin/`, and `shared/`.

## Workspace Modules

- `frontend/` — **Astro + React Islands Storefront**: Mobile-first SSR/prerender-safe storefront (`/`, `/checkout`, `/track`, `/account`) with persistent bag state, Stripe & M-Pesa Daraja checkout, and customer pickup updates.
- `backend/` — **Node.js + Express Authoritative API**: Owns product catalog, `scrypt` authentication (with transparent legacy plaintext upgrade), optional Firebase ID token verification, server-side pricing/shipping/currency conversion, Stripe signed webhooks, Safaricom Daraja STK Push & callbacks, and CJ Dropshipping proxy. Connects to MongoDB via `MONGODB_URI` with automatic local persistent fallback when unconfigured.
- `admin/` — **React + Vite Operations Console**: Single-admin dashboard (`/admin`) protected by admin JWT authentication (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, or one-time preview claim when unset) for manual product CRUD, image uploads, CJ Dropshipping import, and verified `PAID` order fulfillment.
- `shared/` — **Shared Domain Contracts**: TypeScript interfaces, Zod validators, pickup station registry, and bundled sample catalog seed.

## Setup & Commands

1. Copy `.env.example` (plus module `.env.example` templates if deploying modules separately) and configure your secrets in environment variables / Secrets panel.
2. Run development gateway on port 3000:
   ```bash
   npm run dev
   ```
3. Build all workspace modules (`frontend` Astro static site, `admin` React SPA, and TypeScript verification):
   ```bash
   npm run build
   ```
4. Run automated unit & integration tests (auth, server-side pricing, Stripe webhooks, M-Pesa callbacks, and `/track` pickup locks):
   ```bash
   npm test
   ```
5. Start production server:
   ```bash
   npm start
   ```

## Environment Variables: What They Mean & Where to Get Them

> **Security Boundary**: Private secrets (`MONGODB_URI`, `JWT_SECRET`, `ADMIN_PASSWORD`, `STRIPE_*`, `MPESA_*`, `CJ_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_BASE64`) must stay strictly on `backend/` / server environment variables. Never prefix private secrets with `VITE_` or `PUBLIC_` and never commit `.env` files.

### 1. Core Security, Database & Routing

| Variable | Scope | What It Means & Where to Get It |
| :--- | :--- | :--- |
| `PORT` | Server | HTTP port for the backend / unified gateway (defaults to `3000`). |
| `NODE_ENV` | Server | Runtime mode (`development`, `test`, or `production`). |
| `APP_URL` | Server | Public base URL of the app (automatically injected in AI Studio; used for Stripe redirect URLs and CORS). |
| `ALLOWED_ORIGINS` | Server | Comma-separated list of allowed frontend origins (e.g. `https://your-app.run.app,http://localhost:3000`). |
| `MONGODB_URI` | Server-only | MongoDB Atlas connection string (`mongodb+srv://...`). **Where to get**: MongoDB Atlas (`cloud.mongodb.com`) → *Database* → *Connect* → *Drivers (Node.js)*. Ensure Atlas *Network Access* allows your server IP (`0.0.0.0/0` for serverless/Cloud Run). Falls back to `.data/store.json` when left blank. |
| `JWT_SECRET` | Server-only | Symmetric key (`>= 16` chars, recommended 32+ random bytes) used to sign customer and admin JWTs. **How to generate**: run `openssl rand -hex 32`. If omitted in dev, an ephemeral per-process key is used. |
| `ADMIN_EMAIL` | Server-only | Administrator login email for `/admin`. When set with `ADMIN_PASSWORD`, overrides any preview-claimed admin credentials. |
| `ADMIN_PASSWORD` | Server-only | Administrator login password for `/admin`. If omitted in preview, `/admin` renders a one-time setup form to claim the console. |

### 2. Stripe Payments

| Variable | Scope | What It Means & Where to Get It |
| :--- | :--- | :--- |
| `STRIPE_SECRET_KEY` | Server-only | Stripe secret API key (`sk_test_...` for test mode, `sk_live_...` for production). **Where to get / roll**: Stripe Dashboard (`dashboard.stripe.com`) → *Developers* → *API keys* → *Secret key*. |
| `STRIPE_WEBHOOK_SECRET` | Server-only | HMAC signing secret (`whsec_...`) used by `POST /api/payments/stripe/webhook` to verify webhook signatures before marking an order `PAID`. **Where to get**: Stripe Dashboard → *Developers* → *Webhooks* → *Add endpoint* pointing to `<APP_URL>/api/payments/stripe/webhook` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired` (or via `stripe listen --forward-to localhost:3000/api/payments/stripe/webhook` locally). |

### 3. Safaricom Daraja M-Pesa

| Variable | Scope | What It Means & Where to Get It |
| :--- | :--- | :--- |
| `MPESA_ENV` | Server-only | `sandbox` (`sandbox.safaricom.co.ke`) or `production` (`api.safaricom.co.ke`). |
| `MPESA_CONSUMER_KEY` | Server-only | Daraja OAuth2 app consumer key. **Where to get**: Safaricom Developer Portal (`developer.safaricom.co.ke`) → *My Apps* → create/open app with *Lipa Na M-Pesa* enabled. |
| `MPESA_CONSUMER_SECRET` | Server-only | Daraja OAuth2 app consumer secret (paired with `MPESA_CONSUMER_KEY` in the same Daraja app). |
| `MPESA_SHORTCODE` | Server-only | Paybill or Till business shortcode (`174379` for Daraja sandbox; your live Paybill/Till for production). Found under Daraja *APIs* → *M-Pesa Express (STK Push)* → *Test Credentials* (or your Go-Live email). |
| `MPESA_PASSKEY` | Server-only | Lipa Na M-Pesa Online passkey used to generate the STK Push password. Found in Daraja *M-Pesa Express* sandbox test credentials or issued by Safaricom upon Go-Live approval. |
| `MPESA_CALLBACK_URL` | Server-only | Public **HTTPS** endpoint where Daraja posts payment results: `<APP_URL>/api/payments/mpesa/callback`. Daraja rejects non-HTTPS or `localhost` URLs. |
| `MPESA_USD_TO_KES_RATE` | Server-only | Explicit USD→KES conversion rate (e.g. `130`). Because catalog prices are in USD and Daraja settles in KES, M-Pesa checkout refuses conversion if this is unset or `<= 0`. |

### 4. CJ Dropshipping

| Variable | Scope | What It Means & Where to Get It |
| :--- | :--- | :--- |
| `CJ_API_KEY` | Server-only | Access token (`CJ-Access-Token`) for searching live CJ Dropshipping products and rechecking variant stock/cost before checkout. **Where to get / refresh**: CJ Dropshipping (`developers.cjdropshipping.com`) → *Authorization / API Key*. Uses a preview catalog fallback when blank. |

### 5. Optional Firebase Authentication

| Variable | Scope | What It Means & Where to Get It |
| :--- | :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Server-only | Base64-encoded Firebase Admin Service Account JSON used by `POST /api/auth/firebase` to verify Firebase ID tokens. **Where to get**: Firebase Console (`console.firebase.google.com`) → *Project Settings* → *Service accounts* → *Generate new private key* → encode with `base64 -w 0 service-account.json` (Linux) or `base64 -i service-account.json` (macOS). |
| `PUBLIC_FIREBASE_API_KEY` | Client-safe | Public Firebase Web API key from Firebase Console → *Project Settings* → *General* → *Your apps (Web)*. |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | Client-safe | Firebase Auth domain (e.g. `your-project.firebaseapp.com`) from the same Web app config. |
| `PUBLIC_FIREBASE_PROJECT_ID` | Client-safe | Firebase Project ID matching your `FIREBASE_SERVICE_ACCOUNT_BASE64` `project_id`. |
| `PUBLIC_FIREBASE_APP_ID` | Client-safe | Firebase Web App ID from the same Web app config. |

