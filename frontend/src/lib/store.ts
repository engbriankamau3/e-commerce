import type { CartItemInput, PublicUser } from '../../../shared/src/types.ts';

export interface StoredCartEntry extends CartItemInput {
  name: string;
  variantLabel: string;
  unitPriceCents: number;
  image: string;
  slug: string;
}

const CART_STORAGE_KEY = 'kora_bag_items_v1';
const CART_EVENT = 'kora:bag-updated';

// In-memory customer auth state (never persisted in localStorage/sessionStorage)
let memoryAuthToken: string | null = null;
let memoryAuthUser: PublicUser | null = null;
const AUTH_EVENT = 'kora:auth-updated';

export function readBagFromBrowser(): StoredCartEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredCartEntry =>
        Boolean(item && typeof item.productId === 'string' && typeof item.variantSku === 'string' && typeof item.quantity === 'number')
    );
  } catch {
    return [];
  }
}

export function writeBagToBrowser(items: StoredCartEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: items }));
  } catch {
    // Ignore quota or storage restriction errors
  }
}

export function addItemToBag(entry: StoredCartEntry): StoredCartEntry[] {
  const current = readBagFromBrowser();
  const idx = current.findIndex(
    (item) => item.productId === entry.productId && item.variantSku === entry.variantSku
  );
  if (idx >= 0) {
    current[idx] = {
      ...current[idx],
      quantity: Math.min(25, current[idx].quantity + entry.quantity),
      unitPriceCents: entry.unitPriceCents,
    };
  } else {
    current.push({ ...entry, quantity: Math.min(25, Math.max(1, entry.quantity)) });
  }
  writeBagToBrowser(current);
  return current;
}

export function updateBagQuantity(
  productId: string,
  variantSku: string,
  delta: number
): StoredCartEntry[] {
  const current = readBagFromBrowser();
  const next = current
    .map((item) => {
      if (item.productId === productId && item.variantSku === variantSku) {
        return { ...item, quantity: item.quantity + delta };
      }
      return item;
    })
    .filter((item) => item.quantity > 0);
  writeBagToBrowser(next);
  return next;
}

export function clearBag(): void {
  writeBagToBrowser([]);
}

export function subscribeBag(cb: (items: StoredCartEntry[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb(readBagFromBrowser());
  window.addEventListener(CART_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CART_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function getAuthSession(): { token: string | null; user: PublicUser | null } {
  return { token: memoryAuthToken, user: memoryAuthUser };
}

export function setAuthSession(token: string | null, user: PublicUser | null): void {
  memoryAuthToken = token;
  memoryAuthUser = user;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { token, user } }));
  }
}

export function subscribeAuth(
  cb: (session: { token: string | null; user: PublicUser | null }) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb(getAuthSession());
  window.addEventListener(AUTH_EVENT, handler);
  return () => {
    window.removeEventListener(AUTH_EVENT, handler);
  };
}
