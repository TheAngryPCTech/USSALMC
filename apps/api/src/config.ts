import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load .env from the project root (three levels up: apps/api/src -> root).
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') });

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  projectRoot,
  db: {
    host: req('DB_HOST', '/tmp'),
    port: parseInt(req('DB_PORT', '5433'), 10),
    user: req('DB_USER', 'ussa'),
    password: process.env.DB_PASSWORD || undefined,
    database: req('DB_NAME', 'ussa_lore'),
  },
  api: {
    port: parseInt(req('API_PORT', '3000'), 10),
    host: req('API_HOST', '127.0.0.1'),
    tradeRouteCacheTtlSec: parseInt(req('API_TRADE_ROUTE_CACHE_TTL_SEC', '15'), 10),
  },
  scraper: {
    userAgent: req('SCRAPER_USER_AGENT', 'USSALMC-Bot/0.1 (+respect-robots)'),
  },
  embeddings: {
    model: req('API_EMBEDDING_MODEL', 'Xenova/all-MiniLM-L6-v2'),
    dim: 384,
  },
};
