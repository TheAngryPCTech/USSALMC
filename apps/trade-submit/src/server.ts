// server.ts — trade-route submission app: web form + bot-style command endpoint.
// Both paths funnel into the SAME core /v1/trade-routes/submit endpoint.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { parseTradeCommand } from './command-parser.js';
import { submitToApi, confirmToApi, apiInfo } from './api-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') });

const app = Fastify({ logger: { level: 'info' }, trustProxy: process.env.TRUST_PROXY === 'true' });
app.register(fastifyStatic, { root: path.join(here, '../public'), prefix: '/' });

app.setErrorHandler((err, _req, reply) => {
  app.log.error(err);
  const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  reply.code(code).send({ error: { code: code === 500 ? 'internal_error' : 'request_error', message: err.message } });
});

// --- Web form submission (JSON from the browser form) ---
app.post('/submit', async (req: any, reply) => {
  const b = req.body ?? {};
  if (!b.commodity || !b.origin || !b.destination) {
    return reply.code(400).send({ error: { code: 'bad_request', message: 'commodity, origin, destination required' } });
  }
  const out = await submitToApi({
    commodity: b.commodity, from_location: b.origin, to_location: b.destination,
    buy_price: b.buy != null && b.buy !== '' ? Number(b.buy) : null,
    sell_price: b.sell != null && b.sell !== '' ? Number(b.sell) : null,
    account: b.account || null,
  });
  return reply.code(out.status).send(out.data);
});

// --- Bot-style command endpoint (CLI/HTTP-testable now, bot-ready later) ---
// POST /command { "text": "!trade submit Laranite Area18 \"Port Tressler\" 2650 3120", "account": "user#1" }
app.post('/command', async (req: any, reply) => {
  const { text, account } = req.body ?? {};
  const parsed = parseTradeCommand(text || '');
  if (!parsed.ok) {
    return reply.code(400).send({ error: { code: 'bad_command', message: parsed.error }, parsed });
  }
  const out = await submitToApi({
    commodity: parsed.commodity!, from_location: parsed.origin!, to_location: parsed.destination!,
    buy_price: parsed.buy!, sell_price: parsed.sell!, account: account || null,
  });
  // shape a bot-friendly reply string too
  const d = out.data;
  const reply_text = out.status === 429
    ? `⏳ ${d.note}`
    : `✅ ${parsed.commodity} ${parsed.origin}→${parsed.destination}: ${d.outcome} (confidence: ${d.confidence}${d.flagged ? ', ⚠ flagged' : ''}). ${d.note}`;
  return reply.code(out.status).send({ parsed, api_status: out.status, result: d, reply_text });
});

// --- Confirm passthrough (explicit vouch) ---
app.post('/confirm/:id', async (req: any, reply) => {
  const out = await confirmToApi(req.params.id, (req.body && req.body.account) || null);
  return reply.code(out.status).send(out.data);
});

app.get('/info', async () => ({ app: 'trade-submit', ...apiInfo() }));

const port = parseInt(process.env.TRADE_SUBMIT_PORT || '5000', 10);
const host = process.env.TRADE_SUBMIT_HOST || '127.0.0.1';
app.listen({ port, host }).then((a) => app.log.info(`USSALMC trade-submit on ${a}`)).catch((e) => { app.log.error(e); process.exit(1); });
