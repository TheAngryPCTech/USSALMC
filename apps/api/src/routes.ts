// routes.ts — all /v1 endpoints.
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import {
  getEntity, listEntities, getRelations, upsertEntity,
} from './entity-repo.js';
import { hybridSearch } from './search.js';
import { query } from './db.js';
import { submitTradeRoute } from './trade-submissions.js';
import { confirmField, flagField } from './field-signals.js';

function notFound(reply: any, what: string) {
  return reply.code(404).send({ error: { code: 'not_found', message: what } });
}

// Removed entities are never served on the public API — this is what makes
// soft-delete actually take effect for readers (wiki/mobile/desktop/bots),
// not just a status label nobody honors.
async function getPublicEntity(id: string) {
  const ent = await getEntity(id);
  if (!ent || ent.status === 'removed') return null;
  return ent;
}

// Public serialization: honor an admin "hide source" toggle. When
// source.hidden is set, suppress the source URL/origin from the public payload
// but keep confidence + last_verified so every fact still carries its confidence
// (per the cross-phase rule). The internal `hidden` flag is never leaked.
function serveEntity<T extends { source?: any }>(ent: T): T {
  const src = ent.source;
  if (src && src.hidden) {
    return { ...ent, source: { origin: null, url: null, confidence: src.confidence ?? null, last_verified: src.last_verified ?? null } };
  }
  if (src && 'hidden' in src) {
    const { hidden, ...rest } = src;
    return { ...ent, source: rest };
  }
  return ent;
}

export function registerRoutes(app: FastifyInstance) {
  // GET /v1/entities?type=&query=&version=
  app.get('/v1/entities', async (req: any) => {
    const { type, query: q, version, limit, offset } = req.query;
    const res = await listEntities({
      type, queryText: q, version,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { total: res.total, items: res.items.map(serveEntity) };
  });

  // GET /v1/entities/:id
  app.get('/v1/entities/:id', async (req: any, reply) => {
    const ent = await getPublicEntity(req.params.id);
    if (!ent) return notFound(reply, `No entity with id ${req.params.id}`);
    return serveEntity(ent);
  });

  // GET /v1/entities/:id/relations
  app.get('/v1/entities/:id/relations', async (req: any, reply) => {
    const ent = await getPublicEntity(req.params.id);
    if (!ent) return notFound(reply, `No entity with id ${req.params.id}`);
    return { id: ent.id, relations: await getRelations(ent.id) };
  });

  // GET /v1/entities/:id/ai-context
  app.get('/v1/entities/:id/ai-context', async (req: any, reply) => {
    const ent = await getPublicEntity(req.params.id);
    if (!ent) return notFound(reply, `No entity with id ${req.params.id}`);
    return {
      id: ent.id,
      name: ent.name,
      ai_context: ent.ai_context,
      confidence: ent.source?.confidence ?? null,
      source: ent.source,
      game_version: ent.game_version,
      generated: true,
      note: 'ai_context is auto-generated from structured fields at publish time.',
    };
  });

  // GET /v1/search?q=
  app.get('/v1/search', async (req: any, reply) => {
    const q = (req.query.q ?? '').toString().trim();
    if (!q) return reply.code(400).send({ error: { code: 'bad_request', message: 'q is required' } });
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    return { query: q, results: await hybridSearch(q, limit) };
  });

  // GET /v1/trade-routes?commodity=&from=  (volatile: no cache, always show last_verified)
  app.get('/v1/trade-routes', async (req: any, reply) => {
    reply.header('Cache-Control', `no-cache, max-age=${config.api.tradeRouteCacheTtlSec}`);
    const { commodity, from } = req.query;
    const where: string[] = [`status = 'confirmed'`];
    const params: any[] = [];
    if (commodity) { params.push(commodity); where.push(`commodity = $${params.length}`); }
    if (from) { params.push(from); where.push(`from_location = $${params.length}`); }
    const res = await query(
      `SELECT id, commodity, from_location, to_location, buy_price, sell_price,
              profit_per_unit, confirmations, last_verified, updated_at
       FROM trade_route_submissions
       WHERE ${where.join(' AND ')}
       ORDER BY profit_per_unit DESC NULLS LAST`,
      params,
    );
    const now = Date.now();
    const routes = res.rows.map((r: any) => {
      const lv = r.last_verified ? new Date(r.last_verified) : null;
      const ageMin = lv ? Math.round((now - lv.getTime()) / 60000) : null;
      return {
        ...r,
        last_verified: lv ? lv.toISOString() : null,
        last_verified_age_minutes: ageMin,
        freshness_class: 'volatile',
        volatile_warning: 'Trade prices change frequently; verify age before relying on this.',
      };
    });
    return { count: routes.length, sorted_by: 'profit_per_unit', routes };
  });

  // GET /v1/changelog?since=  (recently created/updated entities + patch notes)
  app.get('/v1/changelog', async (req: any) => {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 30 * 864e5);
    const res = await query(
      `SELECT id, type, name, status, game_version, updated_at
       FROM entities WHERE updated_at >= $1 ORDER BY updated_at DESC LIMIT 200`,
      [since.toISOString()],
    );
    return {
      since: since.toISOString(),
      changes: res.rows.map((r: any) => ({ ...r, updated_at: r.updated_at?.toISOString?.() ?? r.updated_at })),
    };
  });

  // POST /v1/feedback
  app.post('/v1/feedback', async (req: any, reply) => {
    const { entity_id, kind, message, payload } = req.body ?? {};
    if (!message && !payload) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'message or payload required' } });
    }
    const res = await query(
      `INSERT INTO feedback (entity_id, client, kind, message, payload)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [entity_id ?? null, req.client ?? null, kind ?? 'comment', message ?? null, JSON.stringify(payload ?? {})],
    );
    return reply.code(201).send({ id: res.rows[0].id, created_at: res.rows[0].created_at, status: 'received' });
  });

  // POST /v1/trade-routes/submit
  // Delegates to the submission-intelligence engine: name normalization,
  // confidence ladder, auto-corroboration, price history, rate-limit + abuse.
  app.post('/v1/trade-routes/submit', async (req: any, reply) => {
    const b = req.body ?? {};
    if (!b.commodity || !b.from_location || !b.to_location) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'commodity, from_location, to_location required' } });
    }
    const buy = b.buy_price != null ? Number(b.buy_price) : null;
    const sell = b.sell_price != null ? Number(b.sell_price) : null;
    // `account` is the reporting user/handle (distinct from the API client key).
    const account = (b.account ?? b.submitted_by ?? null) as string | null;
    const outcome = await submitTradeRoute({
      commodity: b.commodity, from_location: b.from_location, to_location: b.to_location,
      buy_price: buy, sell_price: sell, account, client: req.client ?? null, ip: req.ip ?? null,
    });
    const code = outcome.outcome === 'rate_limited' ? 429 : 201;
    return reply.code(code).send(outcome);
  });

  // POST /v1/trade-routes/:id/confirm
  // A confirmation is an explicit vouch: increments confirmations, steps the
  // confidence ladder to its top ('confirmed'), and refreshes last_verified.
  app.post('/v1/trade-routes/:id/confirm', async (req: any, reply) => {
    const account = (req.body && req.body.account) || null;
    const res = await query(
      `UPDATE trade_route_submissions
       SET confirmations = confirmations + 1,
           status = 'confirmed',
           confidence = 'confirmed',
           last_verified = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING id, status, confidence, confirmations, corroboration_count, last_verified, flagged`,
      [req.params.id],
    );
    if (!res.rows[0]) return notFound(reply, `No trade route submission ${req.params.id}`);
    await query(
      `INSERT INTO trade_submission_events (account, client, ip, route_key, submission_id, action)
       SELECT $1,$2,$3, route_key, id, 'confirm' FROM trade_route_submissions WHERE id=$4`,
      [account, req.client ?? null, req.ip ?? null, req.params.id],
    ).catch(() => {});
    return res.rows[0];
  });

  // POST /v1/entities/:id/fields/confirm — green "this is right" corroboration
  // signal from a live wiki page. body: { field, current_value, submitted_by }
  app.post('/v1/entities/:id/fields/confirm', async (req: any, reply) => {
    const ent = await getPublicEntity(req.params.id);
    if (!ent) return notFound(reply, `No entity with id ${req.params.id}`);
    const b = req.body ?? {};
    if (!b.field) return reply.code(400).send({ error: { code: 'bad_request', message: 'field is required' } });
    const submittedBy = (b.submitted_by && String(b.submitted_by).trim()) || 'anonymous';
    const outcome = await confirmField({
      entityId: ent.id, fieldName: String(b.field), currentValue: b.current_value ?? null,
      submittedBy, ip: req.ip ?? null,
    });
    if (outcome.outcome === 'rate_limited') return reply.code(429).send(outcome);
    return reply.code(201).send(outcome);
  });

  // POST /v1/entities/:id/fields/flag — red "this is wrong" correction
  // proposal from a live wiki page. Lands in the corrections review queue.
  // body: { field, current_value, suggested_value, note, submitted_by }
  app.post('/v1/entities/:id/fields/flag', async (req: any, reply) => {
    const ent = await getPublicEntity(req.params.id);
    if (!ent) return notFound(reply, `No entity with id ${req.params.id}`);
    const b = req.body ?? {};
    if (!b.field || !b.suggested_value || !String(b.suggested_value).trim()) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'field and suggested_value are required' } });
    }
    const submittedBy = (b.submitted_by && String(b.submitted_by).trim()) || 'anonymous';
    const outcome = await flagField({
      entityId: ent.id, fieldName: String(b.field), currentValue: b.current_value ?? null,
      suggestedValue: String(b.suggested_value).trim(), note: b.note ?? null,
      submittedBy, ip: req.ip ?? null,
    });
    if (outcome.outcome === 'rate_limited') return reply.code(429).send(outcome);
    return reply.code(201).send(outcome);
  });
}
