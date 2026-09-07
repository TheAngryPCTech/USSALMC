// extractor.ts — generic, class-name-agnostic structural extraction.
// Produces plain-language field candidates: label/value pairs, infobox-shaped
// blocks (detected by layout: a titled column of dt/dd or th/td rows),
// heading+paragraph pairs, repeated list/table structures, schema.org/JSON-LD,
// numeric/unit patterns, and image candidates. NEVER emits selectors/JSON to
// the reviewer — every candidate carries a human `where` label.

import * as cheerio from 'cheerio';

export type WhereLabel =
  | 'Side info box' | 'Body text' | 'Data table' | 'Page metadata'
  | 'Image' | 'Navigation' | 'Footer' | 'List';

export interface FieldCandidate {
  key: string;              // normalized snake_case field name
  label: string;            // human field name, e.g. "Cargo capacity"
  value: string | null;     // detected value (null = present-but-empty)
  where: WhereLabel;        // plain-language location
  defaultChecked: boolean;  // real specs checked; nav/ads/footer unchecked
  kind: 'field' | 'image';
  // image-only
  imageUrl?: string;
  role?: 'primary' | 'gallery';
  numeric?: { value: number; unit: string | null };
}

export interface ExtractionResult {
  title: string | null;
  description: string | null;   // from JSON-LD / meta if present
  categories: string[];         // for template matching
  candidates: FieldCandidate[];
  jsonLd: any | null;
}

const NAV_HINTS = /(navigation|breadcrumb|menu|sidebar-nav|site-nav|toc|table of contents)/i;
const FOOTER_HINTS = /(footer|license|cookie|advertisement|\bads?\b|disclaimer|edit this page|last edited)/i;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\[\d+\]/g, '')  // footnote markers
    .trim();
}

function snake(s: string): string {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

function parseNumeric(v: string): { value: number; unit: string | null } | undefined {
  const m = v.match(/^[~≈]?\s*([\d,]+(?:\.\d+)?)\s*([a-zµ%/]+(?:\s?[a-z]+)?)?/i);
  if (!m) return undefined;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return undefined;
  return { value: num, unit: m[2] ? m[2].trim() : null };
}

// Is this element inside a region that looks like nav/footer/ads?
function contextWhere($: cheerio.CheerioAPI, el: any): { where: WhereLabel; suppressed: boolean } {
  let node = el;
  for (let i = 0; i < 8 && node; i++) {
    const cls = ($(node).attr('class') || '') + ' ' + ($(node).attr('id') || '') + ' ' + (node.tagName || '');
    if (NAV_HINTS.test(cls)) return { where: 'Navigation', suppressed: true };
    if (FOOTER_HINTS.test(cls)) return { where: 'Footer', suppressed: true };
    node = node.parent;
  }
  return { where: 'Body text', suppressed: false };
}

export function extract(html: string, pageUrl: string): ExtractionResult {
  const $ = cheerio.load(html);
  // Drop non-content nodes so their text/CSS never leaks into values.
  $('style, script, .mw-editsection, sup.reference, .noprint').remove();
  const candidates: FieldCandidate[] = [];
  const seen = new Set<string>();

  const push = (c: FieldCandidate) => {
    const dedupe = c.kind === 'image' ? `img:${c.imageUrl}` : `${c.key}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    candidates.push(c);
  };

  // ---- title ----
  const title = clean($('h1').first().text() || $('title').first().text() || '') || null;

  // ---- JSON-LD / schema.org ----
  let jsonLd: any = null;
  let description: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      jsonLd = jsonLd ?? data;
      const obj = Array.isArray(data) ? data[0] : data;
      if (obj?.description && !description) description = clean(obj.description);
    } catch { /* ignore malformed */ }
  });
  if (!description) {
    const md = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content');
    if (md) description = clean(md);
  }

  // ---- categories for template matching ----
  // Prefer the page's real category footer (MediaWiki .mw-normal-catlinks);
  // fall back to any Category: links only if that region is absent.
  const categories = new Set<string>();
  const $catFooter = $('.mw-normal-catlinks, #catlinks, [class*="catlinks"]');
  const catScope = ($catFooter.length ? $catFooter : $('body')) as any;
  catScope.find('a[href*="Category:"]').each((_: any, el: any) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/Category:([^"'&#]+)/);
    if (m) {
      const name = decodeURIComponent(m[1]).replace(/_/g, ' ').trim();
      if (name && name.toLowerCase() !== 'categories') categories.add(name);
    }
  });

  // ---- (A) infobox-shaped blocks: dl/dt/dd ----
  // Detect by layout: a <dl> with alternating dt/dd, or explicit dt/dd pairs.
  $('dt').each((_, dt) => {
    const $dt = $(dt);
    const $dd = $dt.next('dd');
    if (!$dd.length) return;
    const label = clean($dt.text());
    const value = clean($dd.text());
    if (!label || label.length > 40) return;
    // infobox if the dl sits in a narrow aside-like block; treat wiki t-infobox / infobox as Side info box
    const inInfobox = $dt.closest('[class*="infobox"], aside, [class*="sidebar"]').length > 0;
    const ctx = contextWhere($, dt);
    const where: WhereLabel = inInfobox ? 'Side info box' : ctx.where;
    push({
      key: snake(label), label, value: value || null, where,
      defaultChecked: !ctx.suppressed, kind: 'field',
      numeric: value ? parseNumeric(value) : undefined,
    });
  });

  // ---- (B) label/value tables: th/td rows (2-column tables & wikitable infoboxes) ----
  $('table tr').each((_, tr) => {
    const $tr = $(tr);
    const th = $tr.children('th');
    const td = $tr.children('td');
    if (th.length === 1 && td.length === 1) {
      const label = clean(th.text());
      const value = clean(td.text());
      if (!label || label.length > 40) return;
      const inInfobox = $tr.closest('[class*="infobox"], aside').length > 0;
      const ctx = contextWhere($, tr);
      push({
        key: snake(label), label, value: value || null,
        where: inInfobox ? 'Side info box' : 'Data table',
        defaultChecked: !ctx.suppressed, kind: 'field',
        numeric: value ? parseNumeric(value) : undefined,
      });
    }
  });

  // ---- (C) heading + following paragraph pairs (body sections) ----
  $('h2, h3').each((_, h) => {
    const $h = $(h);
    const label = clean($h.text()).replace(/\[edit\]/i, '');
    if (!label || label.length > 50) return;
    // first paragraph after the heading
    let p = $h.nextAll('p').first();
    const value = clean(p.text());
    if (!value || value.length < 20) return;
    const ctx = contextWhere($, h);
    push({
      key: snake('section_' + label), label: `Section: ${label}`,
      value: value.slice(0, 600), where: 'Body text',
      defaultChecked: !ctx.suppressed && !/references|external links|see also|gallery|navigation/i.test(label),
      kind: 'field',
    });
  });

  // ---- (D) lead paragraph as summary ----
  const lead = clean($('.mw-parser-output > p, article p, main p').filter((_, p) => clean($(p).text()).length > 40).first().text());
  if (lead) {
    push({ key: 'summary', label: 'Summary', value: lead.slice(0, 600), where: 'Body text', defaultChecked: true, kind: 'field' });
  }

  // ---- (E) image candidates (infobox/hero images) ----
  const base = new URL(pageUrl);
  const seenImg = new Set<string>();
  const collectImg = (src: string | undefined, inInfobox: boolean, alt: string) => {
    if (!src) return;
    let url: string;
    try { url = new URL(src, base).toString(); } catch { return; }
    if (!/\.(png|jpe?g|webp|gif)/i.test(url)) return;
    if (/logo|icon|sprite|badge|flag|1x1|spacer/i.test(url) && !inInfobox) return;
    if (seenImg.has(url)) return;
    seenImg.add(url);
    push({
      key: `image_${seenImg.size}`, label: alt ? `Image: ${alt}` : 'Image', value: url,
      where: 'Image', defaultChecked: inInfobox, kind: 'image',
      imageUrl: url, role: inInfobox && seenImg.size === 1 ? 'primary' : 'gallery',
    });
  };
  // infobox images first (become primary candidate)
  $('[class*="infobox"] img, aside img, figure img').each((_, img) => {
    collectImg($(img).attr('src'), true, clean($(img).attr('alt') || ''));
  });
  // then other content images (gallery candidates)
  $('.mw-parser-output img, article img, main img').each((_, img) => {
    collectImg($(img).attr('src'), false, clean($(img).attr('alt') || ''));
  });

  return { title, description, categories: [...categories], candidates, jsonLd };
}
