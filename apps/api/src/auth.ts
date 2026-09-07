// auth.ts — per-client API-key auth, per-client rate limiting, per-client audit.
// Bearer token only (never query string). Each client key hashes to a row in api_keys.

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from './db.js';

export function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

interface KeyRow { id: string; client: string; rate_limit_per_min: number; enabled: boolean; }

// simple in-memory sliding-window counter per api key
const windows = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(keyId: string, limit: number): boolean {
  const now = Date.now();
  const w = windows.get(keyId);
  if (!w || now >= w.resetAt) {
    windows.set(keyId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

declare module 'fastify' {
  interface FastifyRequest {
    client?: string;
    apiKeyId?: string;
  }
}

export function registerAuth(app: FastifyInstance) {
  // Authenticate + rate-limit every /v1 route except health.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/v1/')) return;

    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: { code: 'unauthorized', message: 'Missing Bearer API key in Authorization header.' },
      });
    }
    const raw = auth.slice('Bearer '.length).trim();
    const res = await query<KeyRow>(
      `SELECT id, client, rate_limit_per_min, enabled FROM api_keys WHERE key_hash = $1`,
      [hashKey(raw)],
    );
    const row = res.rows[0];
    if (!row || !row.enabled) {
      return reply.code(401).send({
        error: { code: 'invalid_key', message: 'API key not recognized or disabled.' },
      });
    }
    req.client = row.client;
    req.apiKeyId = row.id;

    if (!checkRateLimit(row.id, row.rate_limit_per_min)) {
      return reply.code(429).send({
        error: { code: 'rate_limited', message: `Rate limit of ${row.rate_limit_per_min}/min exceeded for client ${row.client}.` },
      });
    }
  });

  // Audit every /v1 response, per client.
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/v1/')) return;
    await query(
      `INSERT INTO api_audit_log (client, api_key_id, method, path, status_code, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.client ?? null, req.apiKeyId ?? null, req.method, req.url, reply.statusCode, req.ip],
    ).catch(() => { /* never let auditing break a request */ });
  });
}
