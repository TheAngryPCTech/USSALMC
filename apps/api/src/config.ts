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
    // Category index (GET /v1/categories) is non-volatile (unlike trade routes)
    // so it gets a much longer server-side cache; only the trade_route card's
    // own freshness value is recomputed on every request regardless of this TTL.
    categoriesCacheTtlSec: parseInt(req('API_CATEGORIES_CACHE_TTL_SEC', '300'), 10),
  },
  scraper: {
    userAgent: req('SCRAPER_USER_AGENT', 'USSALMC-Bot/0.1 (+respect-robots)'),
  },
  media: {
    // Self-hosted entity images (Phase 18): downloaded once by the
    // admin scraper's media-store.ts, served back out by this API at the
    // unversioned /media/* path (see index.ts — deliberately NOT under /v1/,
    // matching the existing /health precedent for infrastructure endpoints
    // that aren't Bearer-key-gated JSON API routes; a browser <img src> can't
    // attach an Authorization header, so this MUST stay outside the /v1/
    // auth hook). dir is a path inside the container — the docker-compose
    // `ussalmc_media` volume mounts here in both the api and admin services
    // so admin can write what api then serves.
    dir: req('MEDIA_DIR', path.join(projectRoot, '.media')),
    publicBase: req('MEDIA_PUBLIC_BASE', `http://localhost:${req('API_PORT', '3000')}`),
  },
  embeddings: {
    model: req('API_EMBEDDING_MODEL', 'Xenova/all-MiniLM-L6-v2'),
    dim: 384,
  },
};
