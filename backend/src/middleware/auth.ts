import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken, type JwtClaims } from '../utils/security.ts';

declare global {
  namespace Express {
    interface Request {
      authUser?: JwtClaims;
    }
  }
}

export const SESSION_COOKIE_NAME = 'kora_session';

function parseCookieHeader(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function isSameOriginMutation(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return true;
  }
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(String(origin)).host;
      const expectedHost = String(host).split(',')[0].trim();
      if (originHost === expectedHost) return true;
    } catch {
      return false;
    }
  }
  return req.headers['x-requested-with'] === 'XMLHttpRequest';
}

function extractToken(req: Request): { token: string | null; viaCookie: boolean } {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return { token, viaCookie: false };
  }
  const cookieToken = parseCookieHeader(req.headers.cookie, SESSION_COOKIE_NAME);
  if (cookieToken) {
    return { token: cookieToken, viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

export function createAuthMiddleware(jwtSecret: string) {
  function optionalUserAuth(req: Request, _res: Response, next: NextFunction): void {
    const { token, viaCookie } = extractToken(req);
    if (token && (!viaCookie || isSameOriginMutation(req))) {
      const claims = verifyAuthToken(token, jwtSecret);
      if (claims) {
        req.authUser = claims;
      }
    }
    next();
  }

  function requireUserAuth(req: Request, res: Response, next: NextFunction): void {
    const { token, viaCookie } = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (viaCookie && !isSameOriginMutation(req)) {
      res.status(403).json({ error: 'Cross-origin cookie mutation blocked' });
      return;
    }
    const claims = verifyAuthToken(token, jwtSecret);
    if (!claims) {
      res.status(401).json({ error: 'Invalid or expired session token' });
      return;
    }
    req.authUser = claims;
    next();
  }

  function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Admin authentication required' });
      return;
    }
    const claims = verifyAuthToken(token, jwtSecret);
    if (!claims || claims.role !== 'admin') {
      res.status(403).json({ error: 'Admin privileges required' });
      return;
    }
    req.authUser = claims;
    next();
  }

  return { optionalUserAuth, requireUserAuth, requireAdminAuth };
}
