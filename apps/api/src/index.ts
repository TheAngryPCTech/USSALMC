// index.ts — USSA Lore Master Core API server entry point.
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { registerAuth } from './auth.js';
import { registerRoutes } from './routes.js';
import { pool } from './db.js';

// trustProxy: when running behind a TLS reverse proxy (nginx), honor
// X-Forwarded-For/Proto so req.ip is the real client, not the proxy. Off by
// default; enable with TRUST_PROXY=true in the proxied deployment.
const app = Fastify({ logger: { level: 'info' }, trustProxy: process.env.TRUST_PROXY === 'true' });

// Self-hosted entity images (Phase 18) — deliberately registered OUTSIDE
// /v1/ so a plain <img src> works with no Authorization header (the /v1/
// auth hook in auth.ts only intercepts paths starting with /v1/, same
// exemption /health already relies on). Downloaded once by the admin
// scraper's media-store.ts into config.media.dir; this just serves that
// directory back out, read-only from the API's side.
fs.mkdirSync(config.media.dir, { recursive: true });
app.register(fastifyStatic, {
  root: config.media.dir,
  prefix: '/media/',
  cacheControl: true,
  maxAge: '30d', // content-addressed filenames (sha256 of the source URL) — never change, safe to cache hard
  immutable: true,
});

// Health check (no auth).
app.get('/health', async () => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', db: 'up', ts: new Date().toISOString() };
  } catch (e: any) {
    return { status: 'degraded', db: 'down', error: e?.message };
  }
});

// Uniform error envelope — never leak stack traces.
app.setErrorHandler((err, _req, reply) => {
  app.log.error(err);
  const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  reply.code(code).send({
    error: {
      code: code === 500 ? 'internal_error' : 'request_error',
      message: code === 500 ? 'An internal error occurred.' : err.message,
    },
  });
});

app.setNotFoundHandler((_req, reply) => {
  reply.code(404).send({ error: { code: 'not_found', message: 'Route not found.' } });
});

registerAuth(app);
registerRoutes(app);

app.listen({ port: config.api.port, host: config.api.host })
  .then((addr) => app.log.info(`USSALMC API listening on ${addr}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
