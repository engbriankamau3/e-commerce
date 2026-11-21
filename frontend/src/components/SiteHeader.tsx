import React, { useEffect, useState } from 'react';
import { Menu, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { formatMoney } from '../../../shared/src/validators.ts';
import { apiRequest } from '../lib/api.ts';
import {
  readBagFromBrowser,
  subscribeBag,
  updateBagQuantity,
  writeBagToBrowser,
  type StoredCartEntry,
} from '../lib/store.ts';
import { SafeImage } from './SafeImage.tsx';

interface SiteHeaderProps {
  currentPath?: string;
}

export const SiteHeader: React.FC<SiteHeaderProps> = ({ currentPath = '/' }) => {
  const [bag, setBag] = useState<StoredCartEntry[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [signedInName, setSignedInName] = useState<string | null>(null);

  useEffect(() => {
    setBag(readBagFromBrowser());
    const unsub = subscribeBag((next) => setBag(next));

    // Check active server session (HttpOnly cookie) without blocking render
    apiRequest<{ user: { name: string } }>('/api/auth/me')
      .then((res) => setSignedInName(res.user?.name || null))
      .catch(() => setSignedInName(null));

    const openListener = () => setDrawerOpen(true);
    window.addEventListener('kora:open-bag', openListener);
    return () => {
      unsub();
      window.removeEventListener('kora:open-bag', openListener);
    };
  }, []);

  const totalCount = bag.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalCents = bag.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

  const handleQtyChange = async (productId: string, variantSku: string, delta: number) => {
    const next = updateBagQuantity(productId, variantSku, delta);
    setBag(next);
    if (signedInName) {
      try {
        await apiRequest('/api/cart', {
          method: 'PUT',
          body: JSON.stringify({
            items: next.map((i) => ({
              productId: i.productId,
              variantSku: i.variantSku,
              quantity: i.quantity,
            })),
          }),
        });
      } catch {
        // Keep local bag updated if session expired
      }
    }
  };

  const handleClearItem = async (productId: string, variantSku: string) => {
    const next = bag.filter(
      (i) => !(i.productId === productId && i.variantSku === variantSku)
    );
    writeBagToBrowser(next);
    setBag(next);
    if (signedInName) {
      try {
        await apiRequest('/api/cart', {
          method: 'PUT',
          body: JSON.stringify({
            items: next.map((i) => ({
              productId: i.productId,
              variantSku: i.variantSku,
              quantity: i.quantity,
            })),
          }),
        });
      } catch {
        // ignore
      }
    }
  };

  const navLinks = [
    { href: '/', label: 'Shop' },
    { href: '/checkout', label: 'Checkout' },
    { href: '/track', label: 'Track Order' },
    { href: '/account', label: signedInName ? `Account (${signedInName.split(' ')[0]})` : 'Account' },
  ];

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#FAFAF8]/95 backdrop-blur-sm border-b border-[#141413]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-[#141413] whitespace-nowrap shrink-0"
          >
            Kora &amp; Co.
          </a>

          {/* Zone 2: Clean single-line text navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#5C5B57]" aria-label="Primary">
            {navLinks.map((link) => {
              const active = currentPath === link.href;
              return (
                <a
                  key={link.href}
                  href={link.href}
                  className={`whitespace-nowrap shrink-0 py-2 transition-colors hover:text-[#141413] ${
                    active ? 'text-[#141413] underline underline-offset-4 decoration-[#1B4332]' : ''
                  }`}
                >
                  {link.label}
                </a>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action + mobile menu toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-sm font-medium bg-[#1B4332] text-white rounded-md hover:bg-[#143326] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" />
              <span className="tabular-nums">Bag ({totalCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-md border border-[#141413]/15 text-[#141413] bg-white cursor-pointer"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile navigation panel */}
        {mobileNavOpen && (
          <nav
            className="md:hidden border-t border-[#141413]/10 bg-[#FAFAF8] px-4 py-3 flex flex-col gap-1"
            aria-label="Mobile navigation"
          >
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileNavOpen(false)}
                className="min-h-[44px] flex items-center px-2 text-sm font-medium text-[#141413] rounded-md hover:bg-[#F3F2EE]"
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}
      </header>

      {/* Slide-over Shopping Bag Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Shopping bag">
          <div
            className="fixed inset-0 bg-[#141413]/40 transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative z-10 w-full max-w-md bg-[#FAFAF8] h-full flex flex-col border-l border-[#141413]/10 shadow-xl">
            <div className="px-5 py-4 border-b border-[#141413]/10 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-[#141413]">
                Your Bag ({totalCount})
              </h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close bag"
                className="w-11 h-11 inline-flex items-center justify-center rounded-md text-[#141413] hover:bg-[#F3F2EE] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 divide-y divide-[#141413]/10">
              {bag.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-[#5C5B57] mb-4">Your shopping bag is currently empty.</p>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="min-h-[44px] px-5 py-2.5 text-sm font-medium bg-[#141413] text-white rounded-md cursor-pointer"
                  >
                    Continue Browsing
                  </button>
                </div>
              ) : (
                bag.map((item) => (
                  <div key={`${item.productId}-${item.variantSku}`} className="py-4 flex gap-4">
                    <div className="w-20 h-20 rounded-md overflow-hidden shrink-0 bg-[#F3F2EE]">
                      <SafeImage
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-[#141413] truncate">{item.name}</p>
                        <button
                          type="button"
                          onClick={() => handleClearItem(item.productId, item.variantSku)}
                          aria-label={`Remove ${item.name}`}
                          className="min-w-[44px] min-h-[44px] -mt-2 -mr-2 inline-flex items-center justify-center text-[#5C5B57] hover:text-[#141413] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-[#5C5B57] mt-0.5">{item.variantLabel}</p>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="inline-flex items-center border border-[#141413]/15 rounded-md bg-white">
                          <button
                            type="button"
                            aria-label="Decrease quantity"
                            onClick={() => handleQtyChange(item.productId, item.variantSku, -1)}
                            className="w-11 h-11 inline-flex items-center justify-center text-[#141413] hover:bg-[#F3F2EE] cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-mono tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label="Increase quantity"
                            onClick={() => handleQtyChange(item.productId, item.variantSku, 1)}
                            className="w-11 h-11 inline-flex items-center justify-center text-[#141413] hover:bg-[#F3F2EE] cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="text-sm font-mono font-medium tabular-nums text-[#141413]">
                          {formatMoney(item.unitPriceCents * item.quantity, 'USD')}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {bag.length > 0 && (
              <div className="p-5 border-t border-[#141413]/10 bg-white space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#5C5B57]">Estimated Subtotal</span>
                  <span className="font-mono font-semibold tabular-nums text-[#141413]">
                    {formatMoney(subtotalCents, 'USD')}
                  </span>
                </div>
                <p className="text-xs text-[#5C5B57]">
                  Final pricing, pickup dispatch fee, and KES rates are verified by the server at checkout.
                </p>
                <a
                  href="/checkout"
                  className="w-full min-h-[44px] flex items-center justify-center px-5 py-3 text-sm font-semibold bg-[#1B4332] text-white rounded-md hover:bg-[#143326] transition-colors"
                >
                  Proceed to Checkout
                </a>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
};
