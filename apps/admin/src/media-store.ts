// media-store.ts — downloads a remote image ONCE and stores it on disk under
// MEDIA_DIR, so every entity image is actually ours to keep: we don't
// control starcitizen.tools or robertsspaceindustries.com, so we can't
// guarantee those URLs keep working (already caught two real cases of them
// simply being wrong — see Phase 13/17 in docs/schema.md). Self-hosting is
// the fix: the source is still credited (original_url + license_note stay
// on every image), but display no longer depends on a third party's file
// staying at the same path forever.
//
// Shared by every importer that adds images: the main wiki scraper
// (scan.ts), import-starcitizen-api.ts (roadmap thumbnails), and
// import-species-images.ts (species concept art).
//
// Content-addressed storage: filename = sha256(source URL), so re-running
// any importer against a URL already downloaded is a no-op (checked before
// fetching, not just before writing) — safe to re-run scrapers repeatedly
// without re-downloading the whole KB's images every time.
//
// TWO-TIER by design: `url` stores the DISPLAY-sized copy (whatever
// resolution the page actually linked — a starcitizen.tools "thumb" is
// typically 400px), used everywhere images normally render (category cards,
// entity hero at max-width:560px) so a category grid of 20 cards doesn't
// pull down 20 multi-hundred-KB originals. `fullUrl`, when derivable, is a
// SEPARATE self-hosted copy of the true full-resolution original (confirmed
// live: the Xi'An portrait's thumb is ~37KB at 400px vs. ~300KB / 1654x1800
// at full size — an 8x difference, worth not loading everywhere) — this is
// what the lightbox opens on click (see assets/js/lightbox.js). Only
// derivable for starcitizen.tools' MediaWiki `/thumb/.../{N}px-filename`
// URL shape; absent (not an error) for anything else, e.g. RSI's own CDN,
// where the stored `url` is already the only/best copy we have.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MEDIA_DIR = process.env.MEDIA_DIR || path.resolve(process.cwd(), '../../.media');
const MEDIA_PUBLIC_BASE = (process.env.MEDIA_PUBLIC_BASE || 'http://localhost:3000').replace(/\/+$/, '');
const UA = process.env.SCRAPER_USER_AGENT || 'USSALMC-Bot/0.1 (+respect-robots)';

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
};

function extFor(url: string, contentType: string | null): string {
  const fromUrl = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (fromUrl) return fromUrl[1].toLowerCase();
  const ct = contentType?.split(';')[0]?.trim().toLowerCase();
  if (ct && CONTENT_TYPE_EXT[ct]) return CONTENT_TYPE_EXT[ct];
  return 'jpg'; // reasonable default; never blocks storage over a missing extension
}

function hashOf(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
}

// MediaWiki (starcitizen.tools) resized-thumb URL -> true full-resolution
// original. Same transform as the lightbox's fullSizeUrl() in
// assets/js/lightbox.js — kept in sync deliberately, don't let these drift.
function originalFromThumbUrl(url: string): string | null {
  const m = url.match(/^(https?:\/\/[^/]+)\/thumb\/(.+?)\/\d+px-[^/?]+(?:\?.*)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function fetchBytes(url: string): Promise<{ buf: Buffer; contentType: string | null } | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return null;
  return { buf, contentType: res.headers.get('content-type') };
}

/** Writes bytes under a hash of `keyUrl` (skip if already present) and
 * returns the URL our own API serves it at. */
function store(keyUrl: string, fetched: { buf: Buffer; contentType: string | null }): string {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const hash = hashOf(keyUrl);
  const already = fs.readdirSync(MEDIA_DIR).find((f) => f.startsWith(hash + '.'));
  if (already) return `${MEDIA_PUBLIC_BASE}/media/${already}`;
  const filename = `${hash}.${extFor(keyUrl, fetched.contentType)}`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), fetched.buf);
  return `${MEDIA_PUBLIC_BASE}/media/${filename}`;
}

function alreadyStored(keyUrl: string): string | null {
  try {
    const hash = hashOf(keyUrl);
    const already = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR).find((f) => f.startsWith(hash + '.')) : null;
    return already ? `${MEDIA_PUBLIC_BASE}/media/${already}` : null;
  } catch {
    return null;
  }
}

export interface StoredImage {
  localUrl: string;    // display-sized self-hosted copy -> images[].url
  originalUrl: string; // the external URL this came from -> images[].original_url
  fullUrl?: string;    // self-hosted TRUE full-resolution copy, when derivable -> images[].full_url
}

/**
 * Downloads `url` (the display-sized image, e.g. a wiki page's inline
 * thumbnail) into MEDIA_DIR, and — when it matches the MediaWiki
 * resized-thumb URL shape — ALSO downloads and self-hosts the true
 * full-resolution original as `fullUrl`, for the lightbox's "view full
 * size" (see the two-tier note above). Returns null only if the display
 * image itself fails to download; a failed `fullUrl` attempt just leaves
 * that field absent (the lightbox falls back to `url`), it never fails the
 * whole call. Never fabricates a fallback — the caller's job on `null` is
 * to leave the field exactly as it was.
 */
export async function downloadAndStoreImage(url: string): Promise<StoredImage | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const already = alreadyStored(url);
    let localUrl = already;
    if (!localUrl) {
      let fetched = await fetchBytes(url);
      if (!fetched) {
        // MediaWiki sometimes fails to generate a resized-thumb rendition of
        // an SVG (a known, common rasterizer issue) even though the true
        // original vector file is fine — confirmed live on two real
        // manufacturer logos (thumb PNG 404s, source .svg is a real 200).
        const fallback = originalFromThumbUrl(url);
        if (fallback) fetched = await fetchBytes(fallback);
      }
      if (!fetched) return null;
      localUrl = store(url, fetched);
    }

    let fullUrl: string | undefined;
    const originalCandidate = originalFromThumbUrl(url);
    if (originalCandidate) {
      const existingFull = alreadyStored(originalCandidate);
      if (existingFull) {
        fullUrl = existingFull;
      } else {
        const fetchedFull = await fetchBytes(originalCandidate);
        if (fetchedFull) fullUrl = store(originalCandidate, fetchedFull);
      }
    }

    return { localUrl, originalUrl: url, fullUrl };
  } catch {
    return null;
  }
}

/** True if `url` already points at our own media store (idempotency check
 * for backfills — never re-download something we already self-host). */
export function isSelfHosted(url: string): boolean {
  return typeof url === 'string' && url.startsWith(`${MEDIA_PUBLIC_BASE}/media/`);
}

/**
 * Backfill helper: given an image's already-known `original_url`, downloads
 * and self-hosts ONLY the full-resolution variant (skips re-fetching the
 * display copy, which a prior run already stored) — for images that were
 * self-hosted before `fullUrl` existed. Returns null if not derivable
 * (non-thumb URL shape) or the download fails.
 */
export async function downloadFullSizeOnly(originalUrl: string): Promise<string | null> {
  const candidate = originalFromThumbUrl(originalUrl);
  if (!candidate) return null;
  try {
    const existing = alreadyStored(candidate);
    if (existing) return existing;
    const fetched = await fetchBytes(candidate);
    if (!fetched) return null;
    return store(candidate, fetched);
  } catch {
    return null;
  }
}
