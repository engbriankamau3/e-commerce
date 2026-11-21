import React, { useEffect, useState } from 'react';
import { CheckCircle2, Lock, MapPin, PackageCheck, Search } from 'lucide-react';
import type { PickupStation } from '../../../shared/src/types.ts';
import { PICKUP_STATIONS } from '../../../shared/src/pickupStations.ts';
import { formatMoney } from '../../../shared/src/validators.ts';
import { apiRequest } from '../lib/api.ts';

interface TrackedOrder {
  orderReference: string;
  email: string;
  customerName: string;
  items: Array<{
    productId: string;
    name: string;
    variantSku: string;
    variantLabel: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  chargedAmountMinor: number;
  chargedCurrency: 'USD' | 'KES';
  paymentMethod: 'stripe' | 'mpesa';
  paymentStatus: string;
  fulfillmentStatus: string;
  pickupPoint: {
    stationId: string;
    stationName: string;
    area: string;
    notes?: string;
    updatedAt: string;
  };
  pickupEditable: boolean;
  mpesaReceiptNumber?: string;
  createdAt: string;
}

export const TrackOrderIsland: React.FC = () => {
  const [orderReference, setOrderReference] = useState('');
  const [email, setEmail] = useState('');
  const [stations, setStations] = useState<PickupStation[]>(PICKUP_STATIONS);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [attempts, setAttempts] = useState<Array<{ status: string; message: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [newStationId, setNewStationId] = useState('');
  const [newArea, setNewArea] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const performLookup = async (ref: string, mail: string) => {
    setLoading(true);
    setErrorMsg(null);
    setSaveNotice(null);
    try {
      const res = await apiRequest<{
        order: TrackedOrder;
        attempts: Array<{ status: string; message: string; createdAt: string }>;
      }>('/api/orders/track', {
        method: 'POST',
        body: JSON.stringify({ orderReference: ref, email: mail }),
      });
      setOrder(res.order);
      setAttempts(res.attempts || []);
      setNewStationId(res.order.pickupPoint.stationId);
      setNewArea(res.order.pickupPoint.area);
      setNewNotes(res.order.pickupPoint.notes || '');
    } catch (err) {
      setOrder(null);
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    apiRequest<{ stations: PickupStation[] }>('/api/pickup-stations')
      .then((res) => {
        if (Array.isArray(res.stations) && res.stations.length > 0) {
          setStations(res.stations);
        }
      })
      .catch(() => {});

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qOrder = params.get('order') || '';
      const qEmail = params.get('email') || '';
      if (qOrder) setOrderReference(qOrder);
      if (qEmail) setEmail(qEmail);
      if (qOrder && qEmail) {
        performLookup(qOrder, qEmail);
      }
    }
  }, []);

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performLookup(orderReference, email);
  };

  const handlePickupUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setLoading(true);
    setErrorMsg(null);
    setSaveNotice(null);
    try {
      const res = await apiRequest<{ order: TrackedOrder }>('/api/orders/track/pickup', {
        method: 'PATCH',
        body: JSON.stringify({
          orderReference: order.orderReference,
          email: order.email,
          pickupPoint: {
            stationId: newStationId,
            area: newArea,
            notes: newNotes || undefined,
          },
        }),
      });
      setOrder(res.order);
      setSaveNotice('Preferred pickup station updated.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <form
        onSubmit={handleLookupSubmit}
        className="bg-white border border-[#141413]/10 rounded-lg p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
      >
        <div className="md:col-span-4">
          <label htmlFor="trk-ref" className="block text-xs font-medium text-[#141413] mb-1.5">
            Order Reference
          </label>
          <input
            id="trk-ref"
            type="text"
            required
            value={orderReference}
            onChange={(e) => setOrderReference(e.target.value.toUpperCase())}
            placeholder="KRA-XXXXXX"
            className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
          />
        </div>
        <div className="md:col-span-5">
          <label htmlFor="trk-email" className="block text-xs font-medium text-[#141413] mb-1.5">
            Customer Email
          </label>
          <input
            id="trk-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="amina@example.com"
            className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
          />
        </div>
        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] px-5 py-2.5 text-sm font-semibold bg-[#1B4332] text-white rounded-md hover:bg-[#143326] inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Search className="w-4 h-4" />
            <span>{loading ? 'Looking up...' : 'Look Up Order'}</span>
          </button>
        </div>
      </form>

      {errorMsg && (
        <div className="p-4 rounded-md border border-red-300 bg-red-50 text-sm text-red-800" role="alert">
          {errorMsg}
        </div>
      )}

      {order && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 bg-white border border-[#141413]/10 rounded-lg p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#141413]/10">
              <div>
                <p className="text-xs text-[#5C5B57]">Store-Managed Fulfillment</p>
                <h2 className="font-display text-2xl font-semibold text-[#141413] font-mono">
                  {order.orderReference}
                </h2>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#5C5B57]">Payment · Fulfillment</p>
                <p className="text-sm font-semibold text-[#1B4332]">
                  {order.paymentStatus} · {order.fulfillmentStatus.replace(/_/g, ' ')}
                </p>
              </div>
            </div>

            <div className="divide-y divide-[#141413]/10">
              {order.items.map((item) => (
                <div key={`${item.productId}-${item.variantSku}`} className="py-3 flex justify-between gap-4 text-sm">
                  <div>
                    <p className="font-medium text-[#141413]">{item.name}</p>
                    <p className="text-xs text-[#5C5B57]">
                      {item.variantLabel} · Qty {item.quantity}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums text-[#141413]">
                    {formatMoney(item.lineTotalCents, 'USD')}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-[#141413]/10 space-y-1.5 text-sm">
              <div className="flex justify-between text-[#5C5B57]">
                <span>Charged Total ({order.paymentMethod.toUpperCase()})</span>
                <span className="font-mono font-semibold tabular-nums text-[#141413]">
                  {formatMoney(order.chargedAmountMinor, order.chargedCurrency)}
                </span>
              </div>
              {order.mpesaReceiptNumber && (
                <div className="flex justify-between text-xs text-[#5C5B57]">
                  <span>M-Pesa Receipt</span>
                  <span className="font-mono text-[#141413]">{order.mpesaReceiptNumber}</span>
                </div>
              )}
            </div>

            {attempts.length > 0 && (
              <div className="pt-4 border-t border-[#141413]/10">
                <p className="text-xs font-semibold text-[#141413] mb-2">Payment Verification Log</p>
                <ul className="space-y-1.5 text-xs text-[#5C5B57]">
                  {attempts.map((a, idx) => (
                    <li key={idx} className="flex items-start justify-between gap-3">
                      <span>
                        <strong className="text-[#141413]">{a.status}</strong> — {a.message}
                      </span>
                      <span className="font-mono shrink-0">
                        {new Date(a.createdAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 bg-white border border-[#141413]/10 rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-2">
              {order.pickupEditable ? (
                <MapPin className="w-5 h-5 text-[#1B4332]" />
              ) : (
                <Lock className="w-5 h-5 text-[#5C5B57]" />
              )}
              <h3 className="font-display text-lg font-semibold text-[#141413]">
                Preferred Pickup Station
              </h3>
            </div>

            <div className="p-3.5 rounded-md bg-[#F3F2EE] text-xs space-y-1">
              <p className="font-semibold text-[#141413]">{order.pickupPoint.stationName}</p>
              <p className="text-[#5C5B57]">{order.pickupPoint.area}</p>
              {order.pickupPoint.notes && <p className="text-[#5C5B57]">Note: {order.pickupPoint.notes}</p>}
            </div>

            {saveNotice && (
              <div className="p-3 rounded-md bg-[#1B4332]/10 text-xs text-[#1B4332] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{saveNotice}</span>
              </div>
            )}

            {order.pickupEditable ? (
              <form onSubmit={handlePickupUpdate} className="space-y-3 pt-2">
                <div>
                  <label htmlFor="upd-station" className="block text-xs font-medium text-[#141413] mb-1">
                    Change Pickup Hub
                  </label>
                  <select
                    id="upd-station"
                    value={newStationId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setNewStationId(id);
                      const found = stations.find((s) => s.id === id);
                      if (found && id !== 'custom-courier') setNewArea(found.area);
                    }}
                    className="w-full min-h-[44px] px-3 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
                  >
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="upd-area" className="block text-xs font-medium text-[#141413] mb-1">
                    Area / Estate
                  </label>
                  <input
                    id="upd-area"
                    type="text"
                    required
                    value={newArea}
                    onChange={(e) => setNewArea(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="upd-notes" className="block text-xs font-medium text-[#141413] mb-1">
                    Pickup Instructions
                  </label>
                  <input
                    id="upd-notes"
                    type="text"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="w-full min-h-[44px] px-3 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold bg-[#1B4332] text-white rounded-md hover:bg-[#143326] cursor-pointer"
                >
                  Update Pickup Point
                </button>
              </form>
            ) : (
              <div className="p-4 rounded-md border border-[#141413]/15 bg-[#FAFAF8] text-xs text-[#5C5B57] flex items-start gap-2.5">
                <PackageCheck className="w-4 h-4 text-[#1B4332] shrink-0 mt-0.5" />
                <span>
                  Pickup updates are locked because this order has reached{' '}
                  <strong className="text-[#141413]">
                    {order.fulfillmentStatus.replace(/_/g, ' ')}
                  </strong>
                  . Contact store support if an urgent redirect is needed.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
