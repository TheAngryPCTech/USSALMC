// server.ts — admin web tool backend. Serves the plain-React UI + admin API.
// Reuses the Phase 1 database (via ../../api/src/db) and entity publish path.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { query } from '../../api/src/db.js';
import { upsertEntity } from '../../api/src/entity-repo.js';
import { scanUrl, confirmScan, applyToCategory, getBatch, getBatchForTemplate,
  reweighCategoryQueue, refineTemplateAndReweigh, type Selection } from './scan.js';
import { getQueueItem, publishQueueItem, logScrape } from './pipeline.js';
import { getCategoryTree, listCategories, setVarianceThreshold, defaultVarianceThresholdPct,
  createCategory, updateCategory, deleteCategory } from './categories.js';
import { findTemplateById } from './template.js';
import {
  listEntitiesForAdmin, getEntityForAdmin, setCategory, updateEntity,
  addRelation, removeRelation, CATEGORIES, RELATION_TYPES,
  softDeleteEntity, restoreEntity, hardDeleteEntity, getEntityAuditLog,
  listFieldConfirmations, listCorrections, acceptCorrection, rejectCorrection,
} from './entities-admin.js';
import { registerAdminAuth, bootstrapAdmin, createSession, destroySession,
  setSessionCookie, clearSessionCookie, readCookie, COOKIE,
  verifyPassword, hashPassword, getAdminRole, verifySsoToken } from './admin-auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') });

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 5_000_000, trustProxy: process.env.TRUST_PROXY === 'true' });
// Auth gate FIRST — the whole admin tool (UI + API) requires a login.
registerAdminAuth(app);
// Serve the static UI. `app.jsx`/`index.html` are transpiled in-browser (Babel),
// so a stale browser cache would silently mask a rebuild. Force revalidation
// with `Cache-Control: no-cache` (the browser must check the ETag every load, so
// a rebuilt file is always picked up) — no versioned filenames needed.
app.register(fastifyStatic, {
  root: path.join(here, '../public'),
  prefix: '/',
  cacheControl: true,
  maxAge: 0,
  setHeaders: (res: any, filePath: string) => {
    if (/\.(jsx|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
});

app.setErrorHandler((err, _req, reply) => {
  app.log.error(err);
  const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  reply.code(code).send({ error: { code: code === 500 ? 'internal_error' : 'request_error', message: err.message } });
});

// ---- auth: login / logout / who-am-i / change-password ----
app.post('/admin/login', async (req: any, reply) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return reply.code(400).send({ error: { code: 'bad_request', message: 'username and password required' } });
  const res = await query(`SELECT username, password_hash, must_change_password, role FROM admin_users WHERE username=$1`, [username]);
  const row = res.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    return reply.code(401).send({ error: { code: 'invalid_login', message: 'Invalid username or password.' } });
  }
  await query(`UPDATE admin_users SET last_login_at=now() WHERE username=$1`, [username]);
  const token = createSession(username, row.role);
  setSessionCookie(reply, token);
  return { ok: true, username, role: row.role, must_change_password: row.must_change_password };
});

app.post('/admin/logout', async (req: any, reply) => {
  const token = readCookie(req, COOKIE);
  if (token) destroySession(token);
  clearSessionCookie(reply);
  return { ok: true };
});

// current session state — drives the UI (login screen vs app vs change-password)
app.get('/admin/session', async (req: any) => {
  if (!req.adminUser) return { authenticated: false };
  const res = await query(`SELECT must_change_password FROM admin_users WHERE username=$1`, [req.adminUser]);
  return { authenticated: true, username: req.adminUser, role: req.adminRole, must_change_password: res.rows[0]?.must_change_password ?? false };
});

// ---- SSO handoff from WordPress (wp-admin -> USSA Admin menu) ----
// GET /sso?token=<hmac-signed>. On success, sets the normal session cookie and
// redirects into the app (no separate login prompt). On failure (expired,
// forged, or no admin_users row with a matching email), renders a themed
// error page — this is loaded directly in the browser (inside the wp-admin
// iframe), so it must be real HTML, not a JSON error.
function ssoErrorPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<title>USSA Admin — Sign-in</title>
<style>
  :root{ --void:#0A0E14; --panel:#111820; --line:#28333F; --line-bright:#3A4757; --signal:#4A9EFF; --text:#E6EAEF; --text-dim:#8A97A6; --red:#E86B5A; }
  *{box-sizing:border-box;}
  html,body{margin:0;min-height:100vh;background:var(--void);color:var(--text);font-family:'Rajdhani','Inter',sans-serif;display:flex;align-items:center;justify-content:center;}
  .card{background:var(--panel);border:1px solid var(--line-bright);clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px));padding:32px 36px;max-width:440px;text-align:center;}
  h1{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim);margin:0 0 14px;}
  p{color:var(--red);font-size:16px;margin:0 0 18px;}
  a{color:var(--signal);text-decoration:none;font-size:13px;}
</style></head>
<body><div class="card"><h1>USSA Admin — Sign-in Failed</h1><p>${message}</p>
<a href="javascript:history.back()">&larr; Back</a></div></body></html>`;
}

app.get('/sso', async (req: any, reply) => {
  const payload = verifySsoToken(String(req.query.token || ''));
  if (!payload) {
    return reply.code(401).type('text/html').send(ssoErrorPage('This sign-in link is invalid or has expired. Go back to WordPress and click "USSA Admin" again.'));
  }
  const res = await query(`SELECT username, role FROM admin_users WHERE lower(email)=lower($1)`, [payload.email]);
  const row = res.rows[0];
  if (!row) {
    return reply.code(404).type('text/html').send(
      ssoErrorPage(`No matching USSA Admin account for <b>${payload.email.replace(/</g, '&lt;')}</b>. Ask a super admin to create one for this email.`),
    );
  }
  await query(`UPDATE admin_users SET last_login_at=now() WHERE username=$1`, [row.username]);
  const token = createSession(row.username, row.role);
  setSessionCookie(reply, token);
  return reply.redirect('/');
});

// ---- admin account management (super_admin only) ----
function requireSuperAdmin(req: any, reply: any): boolean {
  if (req.adminRole !== 'super_admin') {
    reply.code(403).send({ error: { code: 'forbidden', message: 'Only a super_admin can do this.' } });
    return false;
  }
  return true;
}

app.get('/admin/admins', async (req: any, reply) => {
  if (!requireSuperAdmin(req, reply)) return;
  const res = await query(`SELECT username, role, email, must_change_password, last_login_at, created_at FROM admin_users ORDER BY created_at`);
  return { items: res.rows };
});

app.post('/admin/admins', async (req: any, reply) => {
  if (!requireSuperAdmin(req, reply)) return;
  const { username, password, role, email } = req.body ?? {};
  if (!username || !password) return reply.code(400).send({ error: { code: 'bad_request', message: 'username and password required' } });
  const r = role === 'super_admin' ? 'super_admin' : 'admin';
  const normEmail = email ? String(email).trim().toLowerCase() : null;
  try {
    await query(
      `INSERT INTO admin_users (username, password_hash, must_change_password, is_dev_credential, role, email)
       VALUES ($1,$2,true,false,$3,$4)`,
      [username, hashPassword(password), r, normEmail],
    );
    return reply.code(201).send({ ok: true, username, role: r, email: normEmail });
  } catch (e: any) {
    return reply.code(400).send({ error: { code: 'create_failed', message: e.message } });
  }
});

app.post('/admin/change-password', async (req: any, reply) => {
  if (!req.adminUser) return reply.code(401).send({ error: { code: 'unauthorized', message: 'Login required.' } });
  const { current_password, new_password } = req.body ?? {};
  if (!current_password || !new_password) return reply.code(400).send({ error: { code: 'bad_request', message: 'current_password and new_password required' } });
  if (String(new_password).length < 8) return reply.code(400).send({ error: { code: 'weak_password', message: 'New password must be at least 8 characters.' } });
  const res = await query(`SELECT password_hash FROM admin_users WHERE username=$1`, [req.adminUser]);
  const row = res.rows[0];
  if (!row || !verifyPassword(current_password, row.password_hash)) {
    return reply.code(401).send({ error: { code: 'invalid_login', message: 'Current password is incorrect.' } });
  }
  if (current_password === new_password) return reply.code(400).send({ error: { code: 'weak_password', message: 'New password must differ from the current one.' } });
  await query(`UPDATE admin_users SET password_hash=$2, must_change_password=false, is_dev_credential=false, updated_at=now() WHERE username=$1`,
    [req.adminUser, hashPassword(new_password)]);
  return { ok: true, must_change_password: false };
});


// --- scan a URL ---
app.post('/admin/scan', async (req: any, reply) => {
  const { url } = req.body ?? {};
  if (!url) return reply.code(400).send({ error: { code: 'bad_request', message: 'url required' } });
  return scanUrl(url);
});

// --- confirm reviewer selections on the seed page (saves template + publishes) ---
app.post('/admin/confirm', async (req: any, reply) => {
  const { url, selections, category, maxPages } = req.body ?? {};
  if (!url || !Array.isArray(selections)) return reply.code(400).send({ error: { code: 'bad_request', message: 'url and selections[] required' } });
  const cap = maxPages ?? parseInt(process.env.SCRAPER_BATCH_MAX_PAGES || '50', 10);
  return confirmScan(url, selections as Selection[], category, cap);
});

// --- apply a saved template to the rest of the category ---
app.post('/admin/apply-category', async (req: any, reply) => {
  const { url, category, maxPages } = req.body ?? {};
  if (!url || !category) return reply.code(400).send({ error: { code: 'bad_request', message: 'url and category required' } });
  return applyToCategory(url, category, maxPages ?? 3);
});

// --- batch progress (polled by the UI to show "Processing X of Y ...") ---
app.get('/admin/batch/:id', async (req: any, reply) => {
  const b = getBatch(req.params.id);
  if (!b) return reply.code(404).send({ error: { code: 'not_found', message: 'batch not found' } });
  return b;
});

// --- review queue listing ---
app.get('/admin/queue', async (req: any) => {
  const status = req.query.status;
  const res = status
    ? await query(`SELECT id, source_url, category, entity_id, status, note, auto_published, variance, routed_reason, created_at, published_at FROM review_queue WHERE status=$1 ORDER BY id DESC LIMIT 100`, [status])
    : await query(`SELECT id, source_url, category, entity_id, status, note, auto_published, variance, routed_reason, created_at, published_at FROM review_queue ORDER BY id DESC LIMIT 100`);
  return { items: res.rows };
});

app.get('/admin/queue/:id', async (req: any, reply) => {
  const item = await getQueueItem(parseInt(req.params.id, 10));
  if (!item) return reply.code(404).send({ error: { code: 'not_found', message: 'queue item not found' } });
  return item;
});

// --- publish a queued item (from review UI); edited flag resets trust streak ---
app.post('/admin/queue/:id/publish', async (req: any, reply) => {
  const id = parseInt(req.params.id, 10);
  const edited = !!(req.body && req.body.edited);
  // allow the reviewer to submit an edited draft
  if (req.body && req.body.proposed) {
    await query(`UPDATE review_queue SET proposed=$2 WHERE id=$1`, [id, JSON.stringify(req.body.proposed)]);
  }
  try {
    const r = await publishQueueItem(id, { edited });
    return { published: true, ...r };
  } catch (e: any) {
    return reply.code(400).send({ error: { code: 'publish_failed', message: e.message } });
  }
});

// --- templates listing (trust status) ---
app.get('/admin/templates', async () => {
  const res = await query(`SELECT id, category, domain, entity_type, clean_streak, auto_publish, updated_at,
    jsonb_array_length(field_map) AS field_count FROM scrape_templates ORDER BY updated_at DESC`);
  return { items: res.rows };
});

// --- full template (field_map) for the refine editor ---
app.get('/admin/templates/:id', async (req: any, reply) => {
  const tpl = await findTemplateById(req.params.id);
  if (!tpl) return reply.code(404).send({ error: { code: 'not_found', message: `no template ${req.params.id}` } });
  return tpl;
});

// =====================================================================
// Category taxonomy — tree with pending-item badge counts + per-category
// variance-threshold config (the "category management page").
// =====================================================================

// full tree (groups + leaf categories) with pending counts for the badges
app.get('/admin/categories/tree', async () => {
  const tree = await getCategoryTree();
  return { tree, default_variance_threshold_pct: defaultVarianceThresholdPct() };
});

// flat list (for pickers / the management table)
app.get('/admin/categories', async () => {
  const items = await listCategories();
  return { items, default_variance_threshold_pct: defaultVarianceThresholdPct() };
});

// set/clear a leaf category's variance threshold (null pct = revert to default)
app.post('/admin/categories/:slug/threshold', async (req: any, reply) => {
  const raw = req.body ? req.body.variance_threshold_pct : undefined;
  const pct = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  try {
    const cat = await setVarianceThreshold(req.params.slug, pct);
    await logScrape(null, 'category_threshold', { category: req.params.slug, variance_threshold_pct: pct });
    return cat;
  } catch (e: any) {
    return reply.code(400).send({ error: { code: 'threshold_failed', message: e.message } });
  }
});

// create a category / subcategory
app.post('/admin/categories', async (req: any, reply) => {
  const { display_name, parent_slug, is_group, slug, description } = req.body ?? {};
  try {
    const cat = await createCategory({ display_name, parent_slug, is_group, slug, description });
    await logScrape(null, 'category_create', { slug: cat.slug, parent_slug: cat.parent_slug, is_group: cat.is_group });
    return cat;
  } catch (e: any) {
    return reply.code(400).send({ error: { code: 'category_create_failed', message: e.message } });
  }
});

// edit a category: rename / description / reparent
app.post('/admin/categories/:slug', async (req: any, reply) => {
  const { display_name, description, parent_slug } = req.body ?? {};
  try {
    const cat = await updateCategory(req.params.slug, { display_name, description, parent_slug });
    await logScrape(null, 'category_update', { slug: req.params.slug, parent_slug: cat.parent_slug });
    return cat;
  } catch (e: any) {
    return reply.code(400).send({ error: { code: 'category_update_failed', message: e.message } });
  }
});

// delete a category (must be empty + not a built-in leaf)
app.post('/admin/categories/:slug/delete', async (req: any, reply) => {
  try {
    const r = await deleteCategory(req.params.slug);
    await logScrape(null, 'category_delete', { slug: req.params.slug });
    return r;
  } catch (e: any) {
    return reply.code(400).send({ error: { code: 'category_delete_failed', message: e.message } });
  }
});

// --- re-weigh a category's queue against its CURRENT template (manual trigger,
// same mechanism the trust-cross + template-solve fire automatically) ---
app.post('/admin/templates/:id/reweigh', async (req: any, reply) => {
  try {
    const r = await reweighCategoryQueue(req.params.id, 'manual');
    return r;
  } catch (e: any) {
    return reply.code(400).send({ error: { code: 'reweigh_failed', message: e.message } });
  }
});

// --- refine/solve a template's field map, then re-weigh its queue ---
app.post('/admin/templates/:id/refine', async (req: any, reply) => {
  const fieldMap = req.body ? req.body.field_map : null;
  if (!Array.isArray(fieldMap)) {
    return reply.code(400).send({ error: { code: 'bad_request', message: 'field_map[] required' } });
  }
  try {
    const r = await refineTemplateAndReweigh(req.params.id, fieldMap);
    return r;
  } catch (e: any) {
    return reply.code(400).send({ error: { code: 'refine_failed', message: e.message } });
  }
});

// --- manual image add/replace on any entity (independent of scraping) ---
app.post('/admin/entities/:id/images', async (req: any, reply) => {
  const id = req.params.id;
  const { url, caption, role, replace } = req.body ?? {};
  if (!url) return reply.code(400).send({ error: { code: 'bad_request', message: 'image url required' } });
  const res = await query(`SELECT * FROM entities WHERE id=$1`, [id]);
  const ent: any = res.rows[0];
  if (!ent) return reply.code(404).send({ error: { code: 'not_found', message: `no entity ${id}` } });
  const newImg = { url, caption: caption ?? null, role: role ?? 'gallery', added_by: 'admin',
    source_url: null, license_note: 'Manually added by admin — verify license before public use.' };
  const images = replace ? [newImg] : [...(ent.images || []), newImg];
  await upsertEntity({
    id: ent.id, type: ent.type, name: ent.name, aliases: ent.aliases, summary: ent.summary,
    body: ent.body, attributes: ent.attributes, relations: ent.relations, images,
    source: ent.source, game_version: ent.game_version, status: ent.status, freshness_class: ent.freshness_class,
  });
  await logScrape(null, 'image_add', { entity_id: id, url, role: newImg.role, replace: !!replace });
  return { entity_id: id, images };
});

// --- live wiki preview: what GET /v1/entities/:id ACTUALLY serves right now ---
// Proxies the core API with the wiki client's bearer key (kept server-side so
// the browser never sees it). The UI renders the response as a readable card
// so the admin can verify "is this what's being served to WordPress".
app.get('/admin/wiki-preview/:id', async (req: any, reply) => {
  const apiBase = process.env.ADMIN_API_BASE || 'http://127.0.0.1:3000';
  const key = process.env.WIKI_API_KEY;
  if (!key) {
    return reply.code(500).send({ error: { code: 'misconfigured', message: 'WIKI_API_KEY is not set — the admin cannot fetch the wiki-client view of the API.' } });
  }
  let r: Response;
  try {
    r = await fetch(`${apiBase}/v1/entities/${encodeURIComponent(req.params.id)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (e: any) {
    return reply.code(502).send({ error: { code: 'api_unreachable', message: `Core API at ${apiBase} is unreachable: ${e.message}` } });
  }
  let body: any = null;
  try { body = await r.json(); } catch { body = null; }
  // Pass the API's status through untouched — a 404 here means the wiki
  // genuinely gets a 404 for this id, and the admin should see that.
  return { api_status: r.status, fetched_at: new Date().toISOString(), entity: r.ok ? body : null, error: r.ok ? null : body?.error ?? null };
});

// --- scrape log tail ---
app.get('/admin/log', async (req: any) => {
  const res = await query(`SELECT id, source_url, action, detail, created_at FROM scrape_log ORDER BY id DESC LIMIT 50`);
  return { items: res.rows };
});

// =====================================================================
// Entities admin — manual categorization + cross-linking of saved entities
// =====================================================================

// static lists the UI needs (category + relation-type pickers). Categories =
// the canonical 12 + any non-group leaf added to the taxonomy, so admin-created
// subcategories are assignable to entities.
app.get('/admin/meta', async () => {
  const rows = await listCategories();
  const leafSlugs = rows.filter((c) => !c.is_group).map((c) => c.slug);
  const categories = [...new Set([...CATEGORIES, ...leafSlugs])];
  return { categories, relation_types: RELATION_TYPES };
});

// browse/search existing entities: GET /admin/entities?q=carrack&category=ship&status=removed
app.get('/admin/entities', async (req: any) => {
  const wantRemoved = req.query.status === 'removed';
  const items = await listEntitiesForAdmin(req.query.q, 500, wantRemoved);
  let filtered = wantRemoved ? items.filter((e: any) => e.status === 'removed') : items;
  const cat = req.query.category;
  if (cat) filtered = filtered.filter((e: any) => e.category === cat);
  return { items: filtered };
});

// full entity for the editor (relations resolved to names)
app.get('/admin/entities/:id', async (req: any, reply) => {
  const e = await getEntityForAdmin(req.params.id);
  if (!e) return reply.code(404).send({ error: { code: 'not_found', message: `no entity ${req.params.id}` } });
  return e;
});

// full field-level entity edit (name/summary/body/attributes/images/relations/
// source/category) — the single plain-language edit path; regenerates ai_context.
app.post('/admin/entities/:id', async (req: any, reply) => {
  const patch = req.body ?? {};
  try {
    const e = await updateEntity(req.params.id, patch);
    await logScrape(null, 'entity_edit', { entity_id: req.params.id, fields: Object.keys(patch) });
    return e;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'edit_failed', message: err.message } });
  }
});

// change category (base type + attributes.category); regenerates ai_context
app.post('/admin/entities/:id/category', async (req: any, reply) => {
  const { category } = req.body ?? {};
  if (!category) return reply.code(400).send({ error: { code: 'bad_request', message: 'category required' } });
  try {
    const e = await setCategory(req.params.id, category);
    await logScrape(null, 'categorize', { entity_id: req.params.id, category });
    return e;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'categorize_failed', message: err.message } });
  }
});

// add a cross-link relation
app.post('/admin/entities/:id/relations', async (req: any, reply) => {
  const { relation_type, target_id } = req.body ?? {};
  try {
    const e = await addRelation(req.params.id, relation_type, target_id);
    await logScrape(null, 'link_add', { entity_id: req.params.id, relation_type, target_id });
    return e;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'link_failed', message: err.message } });
  }
});

// remove a cross-link relation
app.post('/admin/entities/:id/relations/remove', async (req: any, reply) => {
  const { relation_type, target_id } = req.body ?? {};
  try {
    const e = await removeRelation(req.params.id, relation_type, target_id);
    await logScrape(null, 'link_remove', { entity_id: req.params.id, relation_type, target_id });
    return e;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'unlink_failed', message: err.message } });
  }
});

// =====================================================================
// Tiered entity delete: soft-delete ("Remove entry"), restore, hard-delete
// (role-gated friction: super_admin = single confirm, admin = type the exact
// entity name), and the audit trail behind all three.
// =====================================================================

app.post('/admin/entities/:id/remove', async (req: any, reply) => {
  try {
    const e = await softDeleteEntity(req.params.id, req.adminUser);
    await logScrape(null, 'entity_soft_delete', { entity_id: req.params.id, by: req.adminUser });
    return e;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'remove_failed', message: err.message } });
  }
});

app.post('/admin/entities/:id/restore', async (req: any, reply) => {
  try {
    const e = await restoreEntity(req.params.id, req.adminUser);
    await logScrape(null, 'entity_restore', { entity_id: req.params.id, by: req.adminUser });
    return e;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'restore_failed', message: err.message } });
  }
});

app.post('/admin/entities/:id/hard-delete', async (req: any, reply) => {
  const id = req.params.id;
  const role = await getAdminRole(req.adminUser);
  const e = await getEntityForAdmin(id);
  if (!e) return reply.code(404).send({ error: { code: 'not_found', message: `no entity ${id}` } });
  const body = req.body ?? {};
  if (role === 'super_admin') {
    if (body.confirm !== true) {
      return reply.code(400).send({ error: { code: 'confirm_required', message: 'Set confirm:true to hard-delete.' } });
    }
  } else {
    if (String(body.confirm_name ?? '') !== e.name) {
      return reply.code(400).send({ error: { code: 'name_mismatch', message: `Type the exact entity name ("${e.name}") to confirm hard delete.` } });
    }
  }
  try {
    const r = await hardDeleteEntity(id, req.adminUser);
    await logScrape(null, 'entity_hard_delete', { entity_id: id, by: req.adminUser, role });
    return r;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'hard_delete_failed', message: err.message } });
  }
});

app.get('/admin/entities/:id/audit', async (req: any) => {
  return { items: await getEntityAuditLog(req.params.id) };
});

// field-level corroboration: what confirm signals exist for this entity
// (verified via the admin tool, not just trusted from the frontend checkmark)
app.get('/admin/entities/:id/confirmations', async (req: any) => {
  return { items: await listFieldConfirmations(req.params.id) };
});

// =====================================================================
// Corrections review queue (field-level "flag" submissions from the wiki)
// =====================================================================

app.get('/admin/corrections', async (req: any) => {
  return { items: await listCorrections(req.query.status) };
});

app.post('/admin/corrections/:id/accept', async (req: any, reply) => {
  try {
    const r = await acceptCorrection(parseInt(req.params.id, 10), req.adminUser);
    await logScrape(null, 'correction_accept', r);
    return r;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'accept_failed', message: err.message } });
  }
});

app.post('/admin/corrections/:id/reject', async (req: any, reply) => {
  try {
    const r = await rejectCorrection(parseInt(req.params.id, 10), req.adminUser);
    await logScrape(null, 'correction_reject', r);
    return r;
  } catch (err: any) {
    return reply.code(400).send({ error: { code: 'reject_failed', message: err.message } });
  }
});

const port = parseInt(process.env.ADMIN_PORT || '4000', 10);
const host = process.env.ADMIN_HOST || '127.0.0.1';
// Bootstrap the admin account (from ADMIN_USER/ADMIN_PASSWORD) before listening.
bootstrapAdmin()
  .then(() => app.listen({ port, host }))
  .then((a) => app.log.info(`USSALMC admin on ${a}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
