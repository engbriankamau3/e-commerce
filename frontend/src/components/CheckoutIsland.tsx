import React, { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, MapPin, RefreshCw, Smartphone } from 'lucide-react';
import type { PickupStation, PricedCartItem } from '../../../shared/src/types.ts';
import { PICKUP_STATIONS } from '../../../shared/src/pickupStations.ts';
import { formatMoney } from '../../../shared/src/validators.ts';
import { apiRequest } from '../lib/api.ts';
import { clearBag, readBagFromBrowser, type StoredCartEntry } from '../lib/store.ts';
import { SafeImage } from './SafeImage.tsx';

interface QuoteResponse {
  items: PricedCartItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  currency: 'USD';
  mpesaEstimate: { kesWhole: number; rate: number } | null;
}

export const CheckoutIsland: React.FC = () => {
  const [bag, setBag] = useState<StoredCartEntry[]>([]);
  const [stations, setStations] = useState<PickupStation[]>(PICKUP_STATIONS);
  const [mpesaConversionEnabled, setMpesaConversionEnabled] = useState(true);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [stationId, setStationId] = useState(PICKUP_STATIONS[0].id);
  const [customArea, setCustomArea] = useState(PICKUP_STATIONS[0].area);
  const [pickupNotes, setPickupNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'mpesa'>('stripe');
  const [phoneNumber, setPhoneNumber] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mpesaPending, setMpesaPending] = useState<{
    orderReference: string;
    amountKesWhole: number;
    customerMessage: string;
    paymentStatus: string;
  } | null>(null);

  useEffect(() => {
    const items = readBagFromBrowser();
    setBag(items);

    apiRequest<{
      stations: PickupStation[];
      mpesaConversionEnabled: boolean;
    }>('/api/pickup-stations')
      .then((res) => {
        if (Array.isArray(res.stations) && res.stations.length > 0) {
          setStations(res.stations);
        }
        setMpesaConversionEnabled(Boolean(res.mpesaConversionEnabled));
      })
      .catch(() => {});

    apiRequest<{ user: { name: string; email: string } }>('/api/auth/me')
      .then((res) => {
        if (res.user) {
          setCustomerName((prev) => prev || res.user.name);
          setEmail((prev) => prev || res.user.email);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (bag.length === 0) {
      setQuote(null);
      return;
    }
    setQuoteLoading(true);
    setErrorMsg(null);

    apiRequest<QuoteResponse>('/api/cart/quote', {
      method: 'POST',
      body: JSON.stringify({
        items: bag.map((i) => ({
          productId: i.productId,
          variantSku: i.variantSku,
          quantity: i.quantity,
        })),
        pickupPoint: {
          stationId,
          area: customArea,
          notes: pickupNotes || undefined,
        },
      }),
    })
      .then((res) => setQuote(res))
      .catch((err) => setErrorMsg((err as Error).message))
      .finally(() => setQuoteLoading(false));
  }, [bag, stationId, customArea, pickupNotes]);

  const handleStationChange = (nextId: string) => {
    setStationId(nextId);
    const match = stations.find((s) => s.id === nextId);
    if (match) {
      setCustomArea(match.id === 'custom-courier' ? '' : match.area);
    }
  };

  const handleStripeCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{
        orderReference: string;
        checkoutUrl: string;
      }>('/api/checkout/stripe', {
        method: 'POST',
        body: JSON.stringify({
          customerName,
          email,
          items: bag.map((i) => ({
            productId: i.productId,
            variantSku: i.variantSku,
            quantity: i.quantity,
          })),
          pickupPoint: {
            stationId,
            area: customArea,
            notes: pickupNotes || undefined,
          },
        }),
      });
      clearBag();
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMpesaCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{
        orderReference: string;
        amountKesWhole: number;
        customerMessage: string;
        paymentStatus: string;
      }>('/api/checkout/mpesa', {
        method: 'POST',
        body: JSON.stringify({
          customerName,
          email,
          phoneNumber,
          items: bag.map((i) => ({
            productId: i.productId,
            variantSku: i.variantSku,
            quantity: i.quantity,
          })),
          pickupPoint: {
            stationId,
            area: customArea,
            notes: pickupNotes || undefined,
          },
        }),
      });
      clearBag();
      setBag([]);
      setMpesaPending(res);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePollMpesaStatus = async () => {
    if (!mpesaPending) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ paymentStatus: string; message: string }>(
        '/api/payments/mpesa/query',
        {
          method: 'POST',
          body: JSON.stringify({ orderReference: mpesaPending.orderReference }),
        }
      );
      setMpesaPending({
        ...mpesaPending,
        paymentStatus: res.paymentStatus || mpesaPending.paymentStatus,
        customerMessage: res.message || mpesaPending.customerMessage,
      });
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (mpesaPending) {
    return (
      <div className="max-w-xl mx-auto bg-white border border-[#141413]/15 rounded-lg p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-3 text-[#1B4332]">
          <CheckCircle2 className="w-6 h-6 shrink-0" />
          <h2 className="font-display text-2xl font-semibold text-[#141413]">
            M-Pesa STK Prompt Sent
          </h2>
        </div>

        <p className="text-sm text-[#5C5B57] leading-relaxed">
          Order <span className="font-mono font-semibold text-[#141413]">{mpesaPending.orderReference}</span> is{' '}
          <strong className="text-[#141413]">{mpesaPending.paymentStatus}</strong>. Approve the prompt for{' '}
          <span className="font-mono font-semibold text-[#141413]">
            KES {mpesaPending.amountKesWhole.toLocaleString()}
          </span>{' '}
          on your phone. Your order is marked <span className="font-mono">PAID</span> only after Daraja confirms the exact settlement.
        </p>

        <div className="p-4 rounded-md bg-[#F3F2EE] text-xs text-[#141413]">
          {mpesaPending.customerMessage}
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-md border border-red-300 bg-red-50 text-xs text-red-800">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={handlePollMpesaStatus}
            className="min-h-[44px] px-5 py-2.5 text-sm font-medium bg-[#1B4332] text-white rounded-md hover:bg-[#143326] inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
            <span>Check Payment Status</span>
          </button>
          <a
            href={`/track?order=${encodeURIComponent(mpesaPending.orderReference)}&email=${encodeURIComponent(email)}`}
            className="min-h-[44px] px-5 py-2.5 text-sm font-medium border border-[#141413]/20 text-[#141413] rounded-md inline-flex items-center justify-center hover:bg-[#F3F2EE]"
          >
            Track Order &amp; Pickup Point
          </a>
        </div>
      </div>
    );
  }

  if (bag.length === 0) {
    return (
      <div className="max-w-xl mx-auto bg-white border border-[#141413]/10 rounded-lg p-8 text-center">
        <h2 className="font-display text-2xl font-semibold text-[#141413] mb-2">
          Your Bag is Empty
        </h2>
        <p className="text-sm text-[#5C5B57] mb-6">
          Add curated objects from the storefront before proceeding to authoritative server checkout.
        </p>
        <a
          href="/"
          className="inline-flex items-center justify-center min-h-[44px] px-6 py-3 text-sm font-medium bg-[#1B4332] text-white rounded-md hover:bg-[#143326]"
        >
          Return to Shop
        </a>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <form
        onSubmit={paymentMethod === 'stripe' ? handleStripeCheckout : handleMpesaCheckout}
        className="lg:col-span-7 bg-white border border-[#141413]/10 rounded-lg p-5 sm:p-8 space-y-6"
      >
        <div>
          <h2 className="font-display text-xl font-semibold text-[#141413]">1. Customer Details</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="chk-name" className="block text-xs font-medium text-[#141413] mb-1.5">
                Full Name
              </label>
              <input
                id="chk-name"
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Amina Odhiambo"
                className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="chk-email" className="block text-xs font-medium text-[#141413] mb-1.5">
                Email (used for /track lookup)
              </label>
              <input
                id="chk-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="amina@example.com"
                className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
              />
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-[#141413]/10">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#1B4332]" />
            <h2 className="font-display text-xl font-semibold text-[#141413]">
              2. Preferred Pickup Station
            </h2>
          </div>
          <p className="text-xs text-[#5C5B57] mt-1">
            Store-managed collection workflow. You can update this station at /track until your order is marked Ready for Pickup.
          </p>

          <div className="mt-4 space-y-3">
            <label htmlFor="chk-station" className="block text-xs font-medium text-[#141413]">
              Select Collection Hub
            </label>
            <select
              id="chk-station"
              value={stationId}
              onChange={(e) => handleStationChange(e.target.value)}
              className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
            >
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.area} ({s.shippingCents === 0 ? 'Free Pickup' : formatMoney(s.shippingCents, 'USD')})
                </option>
              ))}
            </select>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="chk-area" className="block text-xs font-medium text-[#141413] mb-1.5">
                  Neighborhood / Area
                </label>
                <input
                  id="chk-area"
                  type="text"
                  required
                  value={customArea}
                  onChange={(e) => setCustomArea(e.target.value)}
                  placeholder="e.g. Kilimani, Yaya"
                  className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="chk-notes" className="block text-xs font-medium text-[#141413] mb-1.5">
                  Collection Note (Optional)
                </label>
                <input
                  id="chk-notes"
                  type="text"
                  value={pickupNotes}
                  onChange={(e) => setPickupNotes(e.target.value)}
                  placeholder="Weekend pickup preferred"
                  className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-[#141413]/10">
          <h2 className="font-display text-xl font-semibold text-[#141413]">3. Payment Method</h2>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPaymentMethod('stripe')}
              className={`min-h-[52px] p-3.5 rounded-md border text-left flex items-center gap-3 cursor-pointer ${
                paymentMethod === 'stripe'
                  ? 'border-[#1B4332] bg-[#1B4332]/5'
                  : 'border-[#141413]/15 bg-white'
              }`}
            >
              <CreditCard className="w-5 h-5 text-[#1B4332] shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#141413]">Card (Stripe Checkout)</p>
                <p className="text-xs text-[#5C5B57]">Verified USD settlement</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('mpesa')}
              className={`min-h-[52px] p-3.5 rounded-md border text-left flex items-center gap-3 cursor-pointer ${
                paymentMethod === 'mpesa'
                  ? 'border-[#1B4332] bg-[#1B4332]/5'
                  : 'border-[#141413]/15 bg-white'
              }`}
            >
              <Smartphone className="w-5 h-5 text-[#1B4332] shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#141413]">M-Pesa STK Push</p>
                <p className="text-xs text-[#5C5B57]">
                  {mpesaConversionEnabled ? 'Daraja KES prompt' : 'Rate unconfigured'}
                </p>
              </div>
            </button>
          </div>

          {paymentMethod === 'mpesa' && (
            <div className="mt-4 space-y-2">
              <label htmlFor="chk-phone" className="block text-xs font-medium text-[#141413]">
                M-Pesa Phone Number (Safaricom)
              </label>
              <input
                id="chk-phone"
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="0712345678 or 254712345678"
                className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md font-mono"
              />
              {quote?.mpesaEstimate ? (
                <p className="text-xs text-[#5C5B57]">
                  Converted total:{' '}
                  <strong className="font-mono text-[#141413]">
                    KES {quote.mpesaEstimate.kesWhole.toLocaleString()}
                  </strong>{' '}
                  (1 USD = {quote.mpesaEstimate.rate} KES)
                </p>
              ) : (
                <p className="text-xs text-amber-800">
                  Server USD-to-KES conversion rate is not configured; M-Pesa requests will be rejected by the server.
                </p>
              )}
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-md border border-red-300 bg-red-50 text-xs text-red-800" role="alert">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || quoteLoading}
          className="w-full min-h-[48px] px-6 py-3 text-sm font-semibold bg-[#1B4332] text-white rounded-md hover:bg-[#143326] disabled:opacity-50 transition-colors cursor-pointer"
        >
          {submitting
            ? 'Creating Authoritative Order...'
            : paymentMethod === 'stripe'
              ? `Pay ${quote ? formatMoney(quote.totalCents, 'USD') : ''} via Stripe`
              : `Send M-Pesa Prompt${quote?.mpesaEstimate ? ` (KES ${quote.mpesaEstimate.kesWhole.toLocaleString()})` : ''}`}
        </button>
      </form>

      {/* Authoritative Server Order Summary */}
      <aside className="lg:col-span-5 bg-white border border-[#141413]/10 rounded-lg p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-[#141413]">Server-Verified Summary</h3>
          <span className="text-xs text-[#5C5B57]">USD</span>
        </div>

        <div className="divide-y divide-[#141413]/10">
          {(quote?.items || bag).map((item) => (
            <div key={`${item.productId}-${item.variantSku}`} className="py-3 flex items-center gap-3">
              <div className="w-14 h-14 rounded overflow-hidden bg-[#F3F2EE] shrink-0">
                <SafeImage src={item.image} alt={item.name} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#141413] truncate">{item.name}</p>
                <p className="text-xs text-[#5C5B57]">
                  {item.variantLabel} · Qty {item.quantity}
                </p>
              </div>
              <span className="text-sm font-mono tabular-nums text-[#141413]">
                {formatMoney(item.unitPriceCents * item.quantity, 'USD')}
              </span>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-[#141413]/10 space-y-2 text-sm">
          <div className="flex justify-between text-[#5C5B57]">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">
              {quote ? formatMoney(quote.subtotalCents, 'USD') : 'Calculating...'}
            </span>
          </div>
          <div className="flex justify-between text-[#5C5B57]">
            <span>Pickup / Dispatch</span>
            <span className="font-mono tabular-nums">
              {quote
                ? quote.shippingCents === 0
                  ? 'Free'
                  : formatMoney(quote.shippingCents, 'USD')
                : '...'}
            </span>
          </div>
          <div className="flex justify-between font-semibold text-[#141413] pt-2 border-t border-[#141413]/10">
            <span>Authoritative Total</span>
            <span className="font-mono tabular-nums">
              {quote ? formatMoney(quote.totalCents, 'USD') : '...'}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
};
