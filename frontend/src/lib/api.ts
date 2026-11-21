import { getAuthSession } from './store.ts';

export function getApiBase(): string {
  if (typeof window === 'undefined') return '';
  const configured = (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_API_BASE_URL;
  return configured ? configured.replace(/\/+$/, '') : '';
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const base = getApiBase();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const activeToken = options.token ?? getAuthSession().token;
  if (activeToken) {
    headers.set('Authorization', `Bearer ${activeToken}`);
  }

  const resp = await fetch(`${base}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { error: text || 'Unexpected response from server' };
  }

  if (!resp.ok) {
    throw new Error(
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : `Request failed with status ${resp.status}`
    );
  }

  return data as T;
}
