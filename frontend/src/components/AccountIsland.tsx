import React, { useEffect, useState } from 'react';
import { LogOut, UserCheck } from 'lucide-react';
import type { PublicUser } from '../../../shared/src/types.ts';
import { formatMoney } from '../../../shared/src/validators.ts';
import { apiRequest } from '../lib/api.ts';
import {
  readBagFromBrowser,
  setAuthSession,
  writeBagToBrowser,
  type StoredCartEntry,
} from '../lib/store.ts';

interface CustomerOrderSummary {
  orderReference: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  chargedAmountMinor: number;
  chargedCurrency: 'USD' | 'KES';
  pickupPoint: { stationName: string; area: string };
  createdAt: string;
}

export const AccountIsland: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAccountData = async () => {
    try {
      const me = await apiRequest<{ user: PublicUser }>('/api/auth/me');
      setUser(me.user);
      const ord = await apiRequest<{ orders: CustomerOrderSummary[] }>('/api/orders/mine');
      setOrders(ord.orders || []);
    } catch {
      setUser(null);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccountData();
  }, []);

  const syncBagAfterAuth = async (token: string) => {
    const localBag = readBagFromBrowser();
    try {
      if (localBag.length > 0) {
        const merged = await apiRequest<{ items: StoredCartEntry[] }>('/api/cart/merge', {
          method: 'POST',
          token,
          body: JSON.stringify({
            items: localBag.map((i) => ({
              productId: i.productId,
              variantSku: i.variantSku,
              quantity: i.quantity,
            })),
          }),
        });
        if (Array.isArray(merged.items)) {
          writeBagToBrowser(merged.items);
        }
      } else {
        const serverCart = await apiRequest<{ items: StoredCartEntry[] }>('/api/cart', { token });
        if (Array.isArray(serverCart.items) && serverCart.items.length > 0) {
          writeBagToBrowser(serverCart.items);
        }
      }
    } catch {
      // keep local bag intact
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login' ? { email, password } : { name, email, password };
      const res = await apiRequest<{ token: string; user: PublicUser }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAuthSession(res.token, res.user);
      setUser(res.user);
      await syncBagAfterAuth(res.token);
      const ord = await apiRequest<{ orders: CustomerOrderSummary[] }>('/api/orders/mine', {
        token: res.token,
      });
      setOrders(ord.orders || []);
      setPassword('');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthSession(null, null);
    setUser(null);
    setOrders([]);
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto bg-white border border-[#141413]/10 rounded-lg p-8 text-sm text-[#5C5B57]">
        Checking account session...
      </div>
    );
  }

  if (user) {
    return (
      <div className="space-y-8">
        <div className="bg-white border border-[#141413]/10 rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <UserCheck className="w-6 h-6 text-[#1B4332]" />
            <div>
              <h2 className="font-display text-xl font-semibold text-[#141413]">{user.name}</h2>
              <p className="text-xs text-[#5C5B57]">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[44px] px-4 py-2 text-sm font-medium border border-[#141413]/15 rounded-md hover:bg-[#F3F2EE] inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="bg-white border border-[#141413]/10 rounded-lg p-6">
          <h3 className="font-display text-lg font-semibold text-[#141413] mb-4">Your Orders</h3>
          {orders.length === 0 ? (
            <p className="text-sm text-[#5C5B57]">You have not placed any orders with this account yet.</p>
          ) : (
            <div className="divide-y divide-[#141413]/10">
              {orders.map((ord) => (
                <div
                  key={ord.orderReference}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[#141413]">
                      {ord.orderReference}
                    </p>
                    <p className="text-xs text-[#5C5B57]">
                      {ord.paymentStatus} · {ord.fulfillmentStatus.replace(/_/g, ' ')} ·{' '}
                      {ord.pickupPoint.stationName}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm tabular-nums text-[#141413]">
                      {formatMoney(ord.chargedAmountMinor, ord.chargedCurrency)}
                    </span>
                    <a
                      href={`/track?order=${encodeURIComponent(ord.orderReference)}&email=${encodeURIComponent(user.email)}`}
                      className="min-h-[44px] px-3.5 py-2 text-xs font-medium border border-[#141413]/15 rounded-md inline-flex items-center hover:bg-[#F3F2EE]"
                    >
                      Track / Pickup
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white border border-[#141413]/10 rounded-lg p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-1 p-1 bg-[#F3F2EE] rounded-md">
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setErrorMsg(null);
          }}
          className={`flex-1 min-h-[44px] text-sm font-medium rounded cursor-pointer ${
            mode === 'login' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5C5B57]'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('register');
            setErrorMsg(null);
          }}
          className={`flex-1 min-h-[44px] text-sm font-medium rounded cursor-pointer ${
            mode === 'register' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5C5B57]'
          }`}
        >
          Create Account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <div>
            <label htmlFor="acc-name" className="block text-xs font-medium text-[#141413] mb-1.5">
              Full Name
            </label>
            <input
              id="acc-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Amina Odhiambo"
              className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
            />
          </div>
        )}

        <div>
          <label htmlFor="acc-email" className="block text-xs font-medium text-[#141413] mb-1.5">
            Email Address
          </label>
          <input
            id="acc-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="amina@example.com"
            className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
          />
        </div>

        <div>
          <label htmlFor="acc-pass" className="block text-xs font-medium text-[#141413] mb-1.5">
            Password
          </label>
          <input
            id="acc-pass"
            type="password"
            required
            minLength={mode === 'register' ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            className="w-full min-h-[44px] px-3.5 text-sm bg-[#FAFAF8] border border-[#141413]/15 rounded-md"
          />
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-md border border-red-300 bg-red-50 text-xs text-red-800" role="alert">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[44px] px-5 py-2.5 text-sm font-semibold bg-[#1B4332] text-white rounded-md hover:bg-[#143326] disabled:opacity-50 cursor-pointer"
        >
          {submitting
            ? 'Please wait...'
            : mode === 'login'
              ? 'Sign In & Sync Bag'
              : 'Create Account'}
        </button>
      </form>
    </div>
  );
};
