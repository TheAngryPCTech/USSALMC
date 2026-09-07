// admin-auth.ts — DB-backed admin login with sessions + forced first-login
// password change. Replaces the old static HTTP Basic auth.
//
// Flow:
//   - bootstrap: on start, if the admin user doesn't exist, create it from
//     ADMIN_USER / ADMIN_PASSWORD with must_change_password=true (dev credential).
//   - login: POST /admin/login sets an HttpOnly session cookie.
//   - gate: all /admin/* API routes require a valid session; while the session's
//     account still must_change_password, everything except change-password is
//     blocked. Static assets (the SPA + login screen) load unauthenticated.
//   - change: POST /admin/change-password updates the hash + clears the flag.
//
// Behind nginx TLS the cookie is Secure (set COOKIE_SECURE=true in prod).

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../../api/src/db.js';

const COOKIE = 'ussalmc_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export type AdminRole = 'admin' | 'super_admin';

// ---- password hashing (scrypt, stdlib only) ----
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- in-memory session store (cleared on restart; users just log in again) ----
interface Session { username: string; role: AdminRole; expires: number; }
const sessions = new Map<string, Session>();

export function createSession(username: string, role: AdminRole): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, role, expires: Date.now() + SESSION_TTL_MS });
  return token;
}
export function destroySession(token: string) { sessions.delete(token); }
function getSession(token: string | undefined): Session | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(token); return null; }
  return s;
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers['cookie'];
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

function setSessionCookie(reply: FastifyReply, token: string) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  reply.header('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}
export function clearSessionCookie(reply: FastifyReply) {
  reply.header('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// ---- bootstrap the initial admin account ----
// The bootstrap account is always a super_admin (someone has to be able to
// hard-delete without type-to-confirm and create other admin accounts).
// ADMIN_EMAIL is optional; set it to enable the SSO handoff for this account
// (must match the WordPress user's email exactly).
export async function bootstrapAdmin() {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) {
    // eslint-disable-next-line no-console
    console.error('ADMIN_USER and ADMIN_PASSWORD must be set to bootstrap the admin login.');
    process.exit(1);
  }
  const email = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.trim().toLowerCase() : null;
  await query(
    `INSERT INTO admin_users (username, password_hash, must_change_password, is_dev_credential, role, email)
     VALUES ($1, $2, true, true, 'super_admin', $3)
     ON CONFLICT (username) DO UPDATE SET role = 'super_admin', email = COALESCE(admin_users.email, EXCLUDED.email)`,
    [user, hashPassword(pass), email],
  );
}

export async function getAdminRole(username: string): Promise<AdminRole | null> {
  const res = await query(`SELECT role FROM admin_users WHERE username=$1`, [username]);
  return res.rows[0]?.role ?? null;
}

// ---- SSO token verification (WordPress -> admin tool handoff) ----
// Token format: base64url(JSON payload) + '.' + hex HMAC-SHA256 of that
// base64url string, using the shared secret ADMIN_SSO_SECRET (also held by
// the WordPress plugin as `ussalmc_sso_secret` / env ADMIN_SSO_SECRET).
export interface SsoPayload { email: string; display_name?: string; exp: number; }

export function verifySsoToken(token: string): SsoPayload | null {
  const secret = process.env.ADMIN_SSO_SECRET;
  if (!secret || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: SsoPayload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.email || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// ---- attach req.adminUser + gate /admin/* API routes ----
declare module 'fastify' {
  interface FastifyRequest { adminUser?: string; adminRole?: AdminRole; adminMustChange?: boolean; }
}

// Endpoints reachable WITHOUT a session (login + the SPA static assets).
const OPEN_PATHS = new Set(['/admin/login', '/admin/session']);

export function registerAdminAuth(app: FastifyInstance) {
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
    app.log.error('ADMIN_USER and ADMIN_PASSWORD must be set — refusing to start.');
    process.exit(1);
  }

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // resolve session (if any) for every request
    const token = readCookie(req, COOKIE);
    const s = getSession(token);
    if (s) { req.adminUser = s.username; req.adminRole = s.role; }

    // static assets + login/session endpoints are open (SPA renders the login form)
    if (!req.url.startsWith('/admin/')) return;
    if (OPEN_PATHS.has(req.url.split('?')[0])) return;

    // everything else under /admin/* needs a session
    if (!req.adminUser) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Admin login required.' } });
    }

    // if the account still must change its password, only allow the change endpoint
    const mustRes = await query(`SELECT must_change_password FROM admin_users WHERE username=$1`, [req.adminUser]);
    const mustChange = mustRes.rows[0]?.must_change_password ?? false;
    req.adminMustChange = mustChange;
    if (mustChange && req.url.split('?')[0] !== '/admin/change-password') {
      return reply.code(403).send({ error: { code: 'must_change_password', message: 'You must change your password before continuing.' } });
    }
  });
}

export { setSessionCookie, COOKIE, readCookie, getSession };

