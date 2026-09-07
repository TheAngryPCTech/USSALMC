const { useState, useEffect } = React;

const api = (path, body) =>
  fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    .then(async r => {
      let data;
      try { data = await r.json(); } catch { data = {}; }
      return { ...data, _ok: r.ok, _status: r.status };
    })
    .catch(err => ({ error: { code: 'network', message: String(err) }, _ok: false, _status: 0 }));

// Categories the tool can save. Auto-detect fills this in; the reviewer can override.
const CATEGORIES = ['ship', 'manufacturer', 'weapon', 'location', 'commodity', 'item', 'npc', 'mechanic', 'quest', 'lore'];

// Guess a sensible field name + target from a plain-language candidate.
function defaultsFor(c) {
  if (c.kind === 'image') return { field_name: c.label, target: 'image', role: c.role || 'gallery' };
  const label = c.label.toLowerCase();
  if (label === 'summary' || label.startsWith('section:')) return { field_name: 'summary', target: 'summary' };
  if (/manufacturer|made by|model/.test(label)) return { field_name: 'manufacturer', target: 'relation', relation_type: 'manufactured_by' };
  return { field_name: c.key, target: 'attribute' };
}

function WhereBadge({ where }) {
  const cls = where === 'Side info box' ? 'acc' : where === 'Navigation' || where === 'Footer' ? 'bad' : '';
  return <span className={'badge ' + cls}>{where}</span>;
}

// ---------------------------------------------------------------------------
// Live wiki preview — renders the ACTUAL current response of
// GET /v1/entities/{id} (fetched via the admin's server-side proxy with the
// real wiki API key) as a readable card. This is a data-accuracy check, not a
// WordPress theme clone: if a field is missing/null/wrong here, that's exactly
// what the WordPress plugin is receiving right now.
// ---------------------------------------------------------------------------
function ConfidenceBadge({ confidence }) {
  if (!confidence) return <span className="badge bad">confidence: not set</span>;
  const cls = confidence === 'confirmed' ? 'good' : confidence === 'community' ? 'warn' : 'bad';
  return <span className={'badge ' + cls}>confidence: {confidence}</span>;
}

function WikiPreview({ entityId, refreshKey }) {
  const [data, setData] = useState(null);   // { api_status, fetched_at, entity, error }
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!entityId) return;
    setLoading(true); setErr(null);
    const d = await api('/admin/wiki-preview/' + encodeURIComponent(entityId));
    setLoading(false);
    if (!d._ok && d.error) { setErr(d.error.message || 'Preview fetch failed'); setData(null); return; }
    setData(d);
  }
  useEffect(() => { load(); }, [entityId, refreshKey]);

  if (!entityId) return null;
  const e = data && data.entity;
  const primaryImg = e && (e.images || []).find(i => i.role === 'primary') || (e && (e.images || [])[0]);
  const attrs = e ? Object.entries(e.attributes || {}) : [];

  return (
    <div className="panel preview">
      <div className="row" style={{ marginBottom: 8 }}>
        <b style={{ fontSize: 13 }}>Live wiki API preview</b>
        <span className="note" style={{ marginTop: 0 }}>GET /v1/entities/{entityId}</span>
        <button className="ghost" style={{ marginLeft: 'auto', padding: '4px 10px' }} onClick={load} disabled={loading}>{loading ? '…' : '↻ refresh'}</button>
      </div>
      {err && <div className="lic">⚠ {err}</div>}
      {data && data.api_status === 404 && (
        <div className="lic">⚠ The wiki gets a <b>404</b> for this id — nothing is being served. {data.error && data.error.message}</div>
      )}
      {data && data.api_status !== 404 && !e && !err && <div className="note">No entity payload in response (status {data.api_status}).</div>}
      {e && (
        <div className="pcard">
          <div className="pcard-head">
            {primaryImg
              ? <img className="pimg" src={primaryImg.url} alt={e.name} />
              : <div className="pimg pimg-missing">no primary image</div>}
            <div>
              <div className="pname">{e.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{e.id} · type: {e.type}{e.attributes && e.attributes.category ? ` · ${e.attributes.category}` : ''}</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <ConfidenceBadge confidence={e.source && e.source.confidence} />
                <span className="badge acc">source: {(e.source && e.source.origin) || 'not set'}</span>
                {e.game_version ? <span className="badge">v{e.game_version}</span> : <span className="badge bad">game_version: null</span>}
                <span className={'badge ' + (e.status === 'current' ? 'good' : 'warn')}>{e.status}</span>
              </div>
            </div>
          </div>
          <div className="psec">
            <div className="plabel">Summary</div>
            {e.summary ? <div style={{ fontSize: 13 }}>{e.summary}</div> : <div className="lic">null — the wiki receives no summary for this entity.</div>}
          </div>
          <div className="psec">
            <div className="plabel">Attributes ({attrs.length})</div>
            {attrs.length === 0 && <div className="lic">empty — no attributes are being served.</div>}
            {attrs.length > 0 && (
              <table className="ptable"><tbody>
                {attrs.map(([k, v]) => (
                  <tr key={k}>
                    <td className="muted" style={{ width: '40%' }}>{k}</td>
                    <td>{v === null || v === '' ? <span className="lic">null</span> : typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
          <div className="psec">
            <div className="plabel">Cross-links ({(e.relations || []).length})</div>
            {(e.relations || []).length === 0
              ? <div className="note">none served</div>
              : (e.relations || []).map((r, i) => <div key={i} style={{ fontSize: 13 }}><span className="badge">{r.type}</span> → {r.target_id}</div>)}
          </div>
          <div className="psec">
            <div className="plabel">Images served ({(e.images || []).length})</div>
            {(e.images || []).length === 0 && <div className="note">none</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(e.images || []).map((im, i) => <img key={i} className="thumb" src={im.url} title={`${im.role}${im.caption ? ' — ' + im.caption : ''}`} />)}
            </div>
          </div>
          {e.ai_context && <div className="psec"><div className="plabel">ai-context (auto-generated)</div><div className="muted" style={{ fontSize: 12 }}>{e.ai_context}</div></div>}
        </div>
      )}
      {data && (
        <div className="note" style={{ marginTop: 10 }}>
          Live response · HTTP {data.api_status} · fetched {new Date(data.fetched_at).toLocaleTimeString()} · same endpoint + wiki key the WordPress plugin uses. Not a theme preview — a data-accuracy check.
        </div>
      )}
    </div>
  );
}

function ScanTab() {
  const [url, setUrl] = useState('https://starcitizen.tools/Carrack');
  const [scan, setScan] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [manualImg, setManualImg] = useState('');
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('');
  const [batch, setBatch] = useState(null);   // auto category-batch progress

  async function doScan() {
    setBusy(true); setResult(null); setApplyResult(null); setError(null); setBatch(null);
    const s = await api('/admin/scan', { url });
    if (s.error) { setError(s.error.message || 'Scan failed'); setScan(null); setBusy(false); return; }
    setScan(s);
    setCategory(s.category || '');   // pre-fill category; reviewer can change it
    setRows((s.candidates || []).map(c => ({ ...c, checked: c.defaultChecked, ...defaultsFor(c) })));
    setBusy(false);
  }
  function upd(i, patch) { setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r)); }

  async function confirm() {
    setBusy(true); setError(null);
    if (!category) { setError('Pick a category before confirming.'); setBusy(false); return; }
    const selections = rows.filter(r => r.checked).map(r => ({
      key: r.key, field_name: r.field_name, target: r.target, role: r.role, relation_type: r.relation_type,
    }));
    const r = await api('/admin/confirm', { url, selections, category });
    if (r.error) { setError(r.error.message || 'Confirm failed'); setResult(null); setBusy(false); return; }
    setResult(r); setBusy(false);
    // auto-continue: the server has kicked off the category batch — poll it so
    // the admin sees "Processing X of Y ..." without triggering each page.
    if (r.batch_id) pollBatch(r.batch_id);
  }
  async function pollBatch(batchId) {
    let done = false;
    while (!done) {
      const b = await api('/admin/batch/' + batchId);
      if (b.error) { setBatch({ status: 'error', error: b.error.message }); return; }
      setBatch(b);
      if (b.status === 'done' || b.status === 'error') done = true;
      else await new Promise(res => setTimeout(res, 1200));
    }
  }
  async function applyCategory() {
    setBusy(true); setError(null);
    const r = await api('/admin/apply-category', { url, category: category || scan.category, maxPages: 3 });
    if (r.error) { setError(r.error.message || 'Apply failed'); setBusy(false); return; }
    setApplyResult(r); setBusy(false);
  }
  async function addImage() {
    if (!manualImg || !result) return;
    const r = await api(`/admin/entities/${result.entity_id}/images`, { url: manualImg, role: 'gallery' });
    if (r.error) { setError(r.error.message || 'Add image failed'); return; }
    alert('Image added to ' + result.entity_id); setManualImg('');
  }

  return (
    <div>
      <div className="panel">
        <div className="row">
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste any page URL…" />
          <button className="primary" onClick={doScan} disabled={busy}>{busy ? 'Working…' : 'Scan'}</button>
        </div>
        {scan && (
          <div className="note">
            {scan.robots_ok ? <span className="badge good">robots: allowed</span> : <span className="badge bad">robots: blocked</span>}
            {' '}category: <b>{scan.category || '—'}</b> · mode: <b>{scan.mode}</b>
            {scan.template && <> · template <span className="badge acc">{scan.template.id}</span> streak {scan.template.clean_streak} {scan.template.auto_publish && <span className="badge good">auto-publish ON</span>}</>}
            {scan.variance && <>
              {' '}· variance <span className={'badge ' + (scan.variance_high ? 'bad' : 'good')}>{scan.variance.variance_pct}%</span>
              <span className="muted"> (threshold {scan.variance_threshold_pct}%)</span>
              {scan.variance_high && <span className="badge bad" title="exceeds threshold — routes to the queue even for a trusted category">HIGH → queue for review</span>}
            </>}
          </div>
        )}
        {scan && scan.variance && scan.variance_high && (
          <div className="hint" style={{ borderColor: 'var(--bad)' }}>
            ⚠ This page is correctly categorized as <b>{scan.category}</b>, but {scan.variance.deviations} of {scan.variance.expected} expected template fields don't line up
            ({scan.variance.missing} missing, {scan.variance.unmatched} empty, {scan.variance.structural} in a different place) — that's <b>{scan.variance.variance_pct}%</b>, over the {scan.variance_threshold_pct}% threshold.
            {scan.template && scan.template.auto_publish ? ' Even though this category is trusted, this specific page will be routed to the queue for manual review ("too many variables changed").' : ''}
            <div style={{ marginTop: 6 }}>
              {(scan.variance.detail || []).slice(0, 8).map((d, i) => (
                <div key={i} style={{ fontSize: 12 }}><span className={'badge ' + (d.kind === 'missing' ? 'bad' : d.kind === 'structural' ? 'warn' : '')}>{d.kind}</span> {d.detail}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--bad)' }}>
          <b className="lic">⚠ {error}</b>
        </div>
      )}

      {scan && scan.mode === 'blocked' && <div className="panel"><b className="lic">Blocked:</b> {scan.blocked_reason}</div>}

      {scan && scan.mode === 'template_confirm' && (
        <div className="hint">✓ This page matches a saved template (<b>{scan.template.id}</b>). One-click confirm below — no full rebuild needed.</div>
      )}

      {scan && rows.length > 0 && (
        <div className="panel">
          <div className="hint">Real specs are pre-checked; navigation/ads/footer are unchecked. Rename fields, choose how each maps, and set image roles. Nothing here is a raw selector.</div>
          <div className="row" style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>Category:&nbsp;</label>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">— pick a category —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="note">{scan.category ? `auto-detected: ${scan.category}` : 'not auto-detected — choose one to save this page'}</span>
          </div>
          <table>
            <thead><tr><th>✓</th><th>Field name</th><th>Detected value</th><th>Found in</th><th>Maps to</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input type="checkbox" checked={r.checked} onChange={e => upd(i, { checked: e.target.checked })} /></td>
                  <td><input className="fieldname" value={r.field_name} onChange={e => upd(i, { field_name: e.target.value })} /></td>
                  <td>{r.kind === 'image'
                    ? <div className="row"><img className="thumb" src={r.imageUrl} alt="" /><div className="lic">license: review</div></div>
                    : <span>{r.value === null ? <i className="muted">(empty → null)</i> : r.value}</span>}</td>
                  <td><WhereBadge where={r.where} /></td>
                  <td>
                    {r.kind === 'image'
                      ? <select value={r.role} onChange={e => upd(i, { role: e.target.value })}><option value="primary">primary</option><option value="gallery">gallery</option></select>
                      : <select value={r.target} onChange={e => upd(i, { target: e.target.value })}>
                          <option value="attribute">attribute</option>
                          <option value="summary">summary</option>
                          <option value="relation">relation</option>
                          <option value="ignore">ignore</option>
                        </select>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={confirm} disabled={busy}>Confirm & save template</button>
            <span className="note">{rows.filter(r => r.checked).length} fields selected</span>
          </div>
        </div>
      )}

      {result && !result.error && (
        <div className="panel">
          <h3>Published <span className="badge good">{result.entity_id}</span></h3>
          {result.auto_publish_now_on && <div className="hint">Trust threshold reached — this template will now auto-publish.</div>}
          <p className="muted">Template: {result.template_id} · queue #{result.queue_id}</p>
          {(result.link_suggestions || []).length > 0 && <div><b>Link suggestions:</b> {(result.link_suggestions || []).map((s,i)=><div key={i}>“{s.text}” looks like it might match <b>{s.target_name}</b> — <button className="ghost">link it?</button></div>)}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <input type="text" placeholder="Add image URL manually…" value={manualImg} onChange={e=>setManualImg(e.target.value)} />
            <button className="ghost" onClick={addImage}>Add image to entity</button>
          </div>
          <div className="hint" style={{ marginTop: 12 }}>Template saved — automatically continuing to the rest of the “{result.category || category}” category. Progress below. (Manual re-run:) <button className="ghost" onClick={applyCategory} disabled={busy}>Apply again</button></div>
        </div>
      )}

      {batch && (
        <div className="panel">
          <h3>Auto-processing category
            {batch.status === 'done' ? <span className="badge good" style={{ marginLeft: 8 }}>done</span>
              : batch.status === 'error' ? <span className="badge bad" style={{ marginLeft: 8 }}>error</span>
              : <span className="badge acc" style={{ marginLeft: 8 }}>{batch.status}</span>}
          </h3>
          {batch.status === 'discovering' && <div className="note">Discovering other pages in this category…</div>}
          {batch.status === 'error' && <div className="lic">⚠ {batch.error}</div>}
          {batch.total > 0 && (
            <div>
              <div style={{ margin: '6px 0' }}>
                Processing <b>{batch.processed_count}</b> of <b>{batch.total}</b> pages found in this category…
                {batch.current_url && <span className="muted"> (current: {batch.current_url.replace(/^https?:\/\/[^/]+\//,'')})</span>}
              </div>
              <div style={{ height: 8, background: '#0c0f13', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line)' }}>
                <div style={{ height: '100%', width: `${Math.round(100 * batch.processed_count / Math.max(batch.total,1))}%`, background: 'var(--accent)' }} />
              </div>
            </div>
          )}
          {batch.total === 0 && batch.status === 'done' && <div className="note">No other pages found in this category to process.</div>}
          {batch.results && batch.results.length > 0 && (
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Page</th><th>Entity</th><th>Status</th><th>Fields</th></tr></thead>
              <tbody>{batch.results.map((p,i)=>(
                <tr key={i}>
                  <td className="muted">{(p.url||'').replace(/^https?:\/\/[^/]+\//,'')}</td>
                  <td>{p.entity_id || '—'}</td>
                  <td><span className={'badge '+(p.status==='auto_published'?'good':p.status==='mismatch'||p.status==='fetch_failed'?'bad':'acc')}>{p.status}</span></td>
                  <td>{p.matched}/{p.expected}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {batch.status === 'done' && <div className="note" style={{ marginTop: 8 }}>Pages queued for review appear in the <b>Queue</b> tab; approve them there to advance the trust counter.</div>}
        </div>
      )}

      {applyResult && (
        <div className="panel">
          <h3>Applied “{applyResult.template_id}” across category</h3>
          <table>
            <thead><tr><th>Page</th><th>Entity</th><th>Status</th><th>Fields</th></tr></thead>
            <tbody>{applyResult.processed.map((p,i)=>(
              <tr key={i}>
                <td className="muted">{p.url.replace(/^https?:\/\/[^/]+\//,'')}</td>
                <td>{p.entity_id || '—'}</td>
                <td><span className={'badge '+(p.status==='auto_published'?'good':p.status==='mismatch'?'bad':'acc')}>{p.status}</span></td>
                <td>{p.matched}/{p.expected}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Plain-language field name for a diff/attribute key: "attributes.crew_size"
// -> "Crew size", "game_version" -> "Game version". Never shown as raw JSON.
function humanizeField(key) {
  const name = key.startsWith('attributes.') ? key.slice('attributes.'.length) : key;
  const spaced = name.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
function humanizeValue(v) {
  if (v === null || v === undefined || v === '') return <span className="muted">(empty)</span>;
  return String(v);
}

// Human-readable diff table — replaces a raw JSON dump. `diff` is
// { [field]: { from, to } } (apps/admin/src/pipeline.ts diffAgainstLive).
function DiffTable({ diff }) {
  const entries = Object.entries(diff || {});
  if (!entries.length) return <div className="note">No changes detected against the current live entity.</div>;
  return (
    <table>
      <thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
      <tbody>{entries.map(([field, { from, to }]) => (
        <tr key={field}>
          <td>{humanizeField(field)}</td>
          <td className="muted">{humanizeValue(from)}</td>
          <td>{humanizeValue(to)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

// Human-readable cross-link suggestions — replaces a raw JSON dump.
// Each item: { text, relation_type, decision, target_id?, target_name?, score }.
function LinkSuggestionsList({ suggestions }) {
  const list = (suggestions || []).filter(s => s.decision === 'suggest');
  if (!list.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <label>Suggested cross-links (not auto-applied — confidence too low)</label>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {list.map((s, i) => (
          <li key={i}>
            "{s.text}" <span className="muted">({humanizeField(s.relation_type)})</span> — possibly <b>{s.target_name}</b>
            {' '}<span className="badge acc">{Math.round((s.score || 0) * 100)}% match</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueTab() {
  const [items, setItems] = useState([]);
  // Default to "pending" — the newest-first list is otherwise dominated by
  // already-published items, burying the ones that actually need a reviewer
  // (which is exactly what has an editor + Commit button below).
  const [statusFilter, setStatusFilter] = useState('pending');
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null); // editable copy of sel.proposed — same shape EntitiesTab uses
  const [meta, setMeta] = useState({ categories: [], relation_types: [] });
  const [previewKey, setPreviewKey] = useState(0);
  const [justPublished, setJustPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // link-builder state (same pattern as EntitiesTab's cross-link staging)
  const [targetQ, setTargetQ] = useState('');
  const [targetResults, setTargetResults] = useState([]);
  const [targetId, setTargetId] = useState('');
  const [targetName, setTargetName] = useState('');
  const [relType, setRelType] = useState('');
  const [relCustom, setRelCustom] = useState('');

  async function loadItems(status) {
    const url = status === 'all' ? '/admin/queue' : '/admin/queue?status=' + status;
    const d = await api(url);
    setItems(d.items || []);
  }
  useEffect(() => {
    loadItems(statusFilter);
    api('/admin/meta').then(d => setMeta({ categories: d.categories || [], relation_types: d.relation_types || [] }));
  }, [statusFilter]);

  async function open(id) {
    setJustPublished(false); setError(null);
    const d = await api('/admin/queue/' + id);
    setSel(d);
    seedForm(d);
    setPreviewKey(k => k + 1);
  }
  function seedForm(d) {
    const p = d.proposed || {};
    setForm({
      name: p.name || '',
      summary: p.summary || '',
      body: p.body || '',
      aliases: (p.aliases || []).join(', '),
      category: (p.attributes && p.attributes.category) || p.type || 'item',
      game_version: p.game_version || '',
      status: p.status || 'current',
      attributes: Object.entries(p.attributes || {}).filter(([k]) => k !== 'category').map(([k, v]) => ({ k, v: v === null ? '' : String(v) })),
      images: (p.images || []).map(im => ({ ...im })),
      relations: (p.relations || []).map(r => ({ ...r })),
      source: { origin: (p.source && p.source.origin) || '', url: (p.source && p.source.url) || '',
        confidence: (p.source && p.source.confidence) || '', last_verified: (p.source && p.source.last_verified) || '',
        hidden: !!(p.source && p.source.hidden) },
    });
  }
  function setF(patch) { setForm(f => ({ ...f, ...patch })); }
  function setAttr(i, patch) { setForm(f => ({ ...f, attributes: f.attributes.map((a, j) => j === i ? { ...a, ...patch } : a) })); }
  function addAttr() { setForm(f => ({ ...f, attributes: [...f.attributes, { k: '', v: '' }] })); }
  function rmAttr(i) { setForm(f => ({ ...f, attributes: f.attributes.filter((_, j) => j !== i) })); }
  function setImg(i, patch) { setForm(f => ({ ...f, images: f.images.map((im, j) => j === i ? { ...im, ...patch } : im) })); }
  function addImg() { setForm(f => ({ ...f, images: [...f.images, { url: '', caption: '', role: 'gallery', added_by: 'admin', source_url: null, license_note: 'Manually added by admin — verify license before public use.' }] })); }
  function rmImg(i) { setForm(f => ({ ...f, images: f.images.filter((_, j) => j !== i) })); }
  function rmRel(i) { setForm(f => ({ ...f, relations: f.relations.filter((_, j) => j !== i) })); }
  async function searchTargets() {
    const d = await api('/admin/entities?q=' + encodeURIComponent(targetQ));
    if (!d.error) setTargetResults((d.items || []).slice(0, 20));
  }
  function stageLink() {
    const relation_type = (relCustom.trim() || relType).trim();
    if (!relation_type) { setError('Choose or type a relation type.'); return; }
    if (!targetId) { setError('Pick a target entity to link to.'); return; }
    setError(null);
    setForm(f => {
      if (f.relations.some(r => r.type === relation_type && r.target_id === targetId)) return f;
      return { ...f, relations: [...f.relations, { type: relation_type, target_id: targetId, target_name: targetName, target_type: null, broken: false }] };
    });
    setTargetId(''); setTargetName(''); setTargetQ(''); setTargetResults([]); setRelCustom('');
  }

  function buildEditedProposed() {
    const attrs = {};
    for (const { k, v } of form.attributes) { if (k.trim()) attrs[k.trim()] = v === '' ? null : v; }
    attrs.category = form.category;
    return {
      ...sel.proposed,
      type: categoryToType(form.category),
      name: form.name,
      summary: form.summary || null,
      body: form.body || null,
      aliases: form.aliases.split(',').map(s => s.trim()).filter(Boolean),
      attributes: attrs,
      images: form.images.filter(im => (im.url || '').trim()),
      relations: form.relations.map(r => ({ type: r.type, target_id: r.target_id })),
      source: { origin: form.source.origin || null, url: form.source.url || null,
        confidence: form.source.confidence || null, last_verified: form.source.last_verified || null,
        hidden: !!form.source.hidden },
      game_version: form.game_version || null,
      status: form.status,
    };
  }

  async function publish(id, edited) {
    setBusy(true); setError(null);
    const body = edited ? { edited: true, proposed: buildEditedProposed() } : { edited: false };
    const r = await api(`/admin/queue/${id}/publish`, body);
    setBusy(false);
    if (r.error) { setError(r.error.message || 'Publish failed'); return; }
    // keep the panel open and re-fetch the live preview so the admin sees
    // exactly what the wiki serves NOW that the change is published
    setJustPublished(true);
    setSel(s => s ? { ...s, status: 'published' } : s);
    setPreviewKey(k => k + 1);
    loadItems(statusFilter);
  }
  return (
    <div>
      {sel && form && (
        <div className="split">
        <div className="split-left">
        <div className="panel">
          <h3>Diff — {sel.entity_id} <span className="muted">(queue #{sel.id})</span></h3>
          <DiffTable diff={sel.diff} />
          <LinkSuggestionsList suggestions={sel.link_suggestions} />

          {error && <div className="lic" style={{ marginTop: 10 }}>⚠ {error}</div>}

          {sel.status !== 'pending' && (
            <div className="hint" style={{ marginTop: 10 }}>
              This item is already <b>{sel.status}</b>{sel.published_at ? ` (${new Date(sel.published_at).toLocaleString()})` : ''} —
              the editor and Commit button only appear for <b>pending</b> items. Nothing to change here.
            </div>
          )}

          {sel.status === 'pending' && (
            <div className="panel" style={{ marginTop: 14, background: 'var(--panel-raised, #12202e)' }}>
              <label>Edit before publishing — same editor as the Entities tab</label>
              <EntityFieldsEditor
                form={form} meta={meta} setF={setF} setAttr={setAttr} addAttr={addAttr} rmAttr={rmAttr}
                setImg={setImg} addImg={addImg} rmImg={rmImg} rmRel={rmRel}
                targetQ={targetQ} setTargetQ={setTargetQ} targetResults={targetResults} searchTargets={searchTargets}
                targetId={targetId} setTargetId={setTargetId} setTargetName={setTargetName}
                relType={relType} setRelType={setRelType} relCustom={relCustom} setRelCustom={setRelCustom}
                stageLink={stageLink} />
            </div>
          )}

          {sel.status==='pending' && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="ghost" disabled={busy} onClick={()=>publish(sel.id,false)}>Approve as-is & publish</button>
              <button className="primary" disabled={busy} onClick={()=>publish(sel.id,true)}>{busy ? 'Committing…' : 'Commit'}</button>
            </div>
          )}
          {justPublished && <div className="hint" style={{ marginTop: 10 }}>✓ Published — the preview on the right has re-fetched and now shows what the wiki is actually serving.</div>}
        </div>
        </div>
        <div className="split-right">
          <WikiPreview entityId={sel.entity_id} refreshKey={previewKey} />
        </div>
        </div>
      )}
      <div className="panel" style={{ marginTop: sel && form ? 16 : 0 }}>
        <div className="row">
          <h3 style={{ marginRight: 'auto' }}>Review queue</h3>
          <div className="tabs">
            {['pending', 'published', 'mismatch', 'auto_completed', 'all'].map(s => (
              <button key={s} className={statusFilter === s ? 'active' : ''} onClick={() => setStatusFilter(s)}>{s}</button>
            ))}
          </div>
        </div>
        <table><thead><tr><th>#</th><th>Entity</th><th>Category</th><th>Variance</th><th>Status</th><th>Source</th><th></th></tr></thead>
        <tbody>{items.map(it=>(
          <tr key={it.id}><td>{it.id}</td><td>{it.entity_id}</td><td>{it.category}</td>
            <td>{it.variance == null ? <span className="muted">—</span> : <span className={'badge ' + (it.routed_reason === 'high_variance' ? 'bad' : 'good')}>{it.variance}%</span>}</td>
            <td><span className={'badge '+(it.status==='published'?'good':it.status==='auto_completed'?'good':it.status==='mismatch'?'bad':'acc')}>{it.status}{it.auto_published?' (auto)':''}</span></td>
            <td className="muted">{(it.source_url||'').replace(/^https?:\/\/[^/]+\//,'')}</td>
            <td><button className="ghost" onClick={()=>open(it.id)}>{it.status === 'pending' ? 'edit & publish' : 'view diff'}</button></td></tr>
        ))}</tbody></table>
        {items.length === 0 && <div className="note">No {statusFilter === 'all' ? '' : statusFilter} items.</div>}
      </div>
    </div>
  );
}

function TemplatesTab() {
  const [items, setItems] = useState([]);
  useEffect(() => { api('/admin/templates').then(d => setItems(d.items || [])); }, []);
  return (
    <div className="panel">
      <h3>Saved templates (trust status)</h3>
      <table><thead><tr><th>Template</th><th>Category</th><th>Domain</th><th>Fields</th><th>Clean streak</th><th>Auto-publish</th></tr></thead>
      <tbody>{items.map(t=>(
        <tr key={t.id}><td>{t.id}</td><td>{t.category}</td><td className="muted">{t.domain}</td><td>{t.field_count}</td>
        <td>{t.clean_streak}</td><td>{t.auto_publish?<span className="badge good">ON</span>:<span className="badge">off</span>}</td></tr>
      ))}</tbody></table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories tab — the category/subcategory tree with live pending-item badges,
// per-category variance-threshold config, and per-category template refine
// ("solve the template") which re-weighs the queue and auto-completes items now
// within threshold. This is the "category management page" the variance flow
// (per-category threshold) and re-weigh-on-solve hang off of.
// ---------------------------------------------------------------------------
function TemplateRefineEditor({ templateId, onReweighed }) {
  const [tpl, setTpl] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setMsg(null); setErr(null);
    api('/admin/templates/' + encodeURIComponent(templateId)).then(d => {
      if (d.error) { setErr(d.error.message); return; }
      setTpl(d); setRows((d.field_map || []).map(f => ({ ...f })));
    });
  }, [templateId]);
  function upd(i, patch) { setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r)); }
  function removeRow(i) { setRows(rs => rs.filter((_, j) => j !== i)); }
  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    const r = await api('/admin/templates/' + encodeURIComponent(templateId) + '/refine', { field_map: rows });
    setBusy(false);
    if (r.error) { setErr(r.error.message || 'Refine failed'); return; }
    const rw = r.reweigh || {};
    setMsg(`Template solved. Re-weighed queue: ${(rw.auto_completed||[]).length} auto-completed, ${(rw.still_queued||[]).length} still queued.`);
    if (onReweighed) onReweighed(rw);
  }
  if (err) return <div className="lic">⚠ {err}</div>;
  if (!tpl) return <div className="note">Loading template…</div>;
  return (
    <div className="panel" style={{ background: '#12202e', marginTop: 10 }}>
      <div className="row"><b>Refine / solve template</b> <span className="badge acc">{tpl.id}</span>
        <span className="note">Removing/ignoring fields the page can't provide lowers a queued page's variance. Saving re-weighs the queue.</span></div>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Field</th><th>Expected label</th><th>Found in</th><th>Maps to</th><th></th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            <td><input className="fieldname" value={r.field_name} onChange={e => upd(i, { field_name: e.target.value })} /></td>
            <td><input className="fieldname" value={r.label} onChange={e => upd(i, { label: e.target.value })} /></td>
            <td className="muted" style={{ fontSize: 12 }}>{r.where || '—'}</td>
            <td>
              <select value={r.target} onChange={e => upd(i, { target: e.target.value })}>
                <option value="attribute">attribute</option>
                <option value="summary">summary</option>
                <option value="relation">relation</option>
                <option value="image">image</option>
                <option value="ignore">ignore</option>
              </select>
            </td>
            <td><button className="ghost" onClick={() => removeRow(i)}>remove</button></td>
          </tr>
        ))}</tbody>
      </table>
      {msg && <div className="hint" style={{ marginTop: 8 }}>✓ {msg}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" onClick={save} disabled={busy}>{busy ? 'Solving…' : 'Save template & re-weigh queue'}</button>
        <span className="note">{rows.length} fields</span>
      </div>
    </div>
  );
}

function CategoryNode({ node, depth, templates, defaultThr, allCats, onChange, onOpenRefine, openRefineFor }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(node.variance_threshold_pct == null ? '' : String(node.variance_threshold_pct));
  const [manage, setManage] = useState(false);      // rename/description/reparent panel
  const [name, setName] = useState(node.display_name);
  const [desc, setDesc] = useState(node.description || '');
  const [parent, setParent] = useState(node.parent_slug || '');
  const [addingSub, setAddingSub] = useState(false);
  const [subName, setSubName] = useState('');
  const [subIsGroup, setSubIsGroup] = useState(false);
  const [err, setErr] = useState(null);
  const tpl = templates.find(t => t.category === node.slug);
  const canDelete = !CANONICAL.includes(node.slug) && node.subtree_entities === 0 && (node.children || []).length === 0;

  async function saveThr(clear) {
    const body = { variance_threshold_pct: clear ? null : (val === '' ? null : Number(val)) };
    const r = await api('/admin/categories/' + encodeURIComponent(node.slug) + '/threshold', body);
    if (r.error) { alert(r.error.message); return; }
    setEdit(false); onChange();
  }
  async function saveManage() {
    setErr(null);
    const r = await api('/admin/categories/' + encodeURIComponent(node.slug), {
      display_name: name, description: desc, parent_slug: parent === '' ? null : parent });
    if (r.error) { setErr(r.error.message); return; }
    setManage(false); onChange();
  }
  async function addSub() {
    setErr(null);
    const r = await api('/admin/categories', { display_name: subName, parent_slug: node.slug, is_group: subIsGroup });
    if (r.error) { setErr(r.error.message); return; }
    setAddingSub(false); setSubName(''); setSubIsGroup(false); onChange();
  }
  async function del() {
    if (!confirm(`Delete category "${node.display_name}"? This cannot be undone.`)) return;
    const r = await api('/admin/categories/' + encodeURIComponent(node.slug) + '/delete', {});
    if (r.error) { alert(r.error.message); return; }
    onChange();
  }

  return (
    <div>
      <div className="row" style={{ padding: '4px 0', paddingLeft: depth * 22, alignItems: 'center' }}>
        <b style={{ fontSize: node.is_group ? 14 : 13 }}>{node.display_name}</b>
        {node.is_group
          ? <span className="muted" style={{ fontSize: 12 }}>group</span>
          : <span className="muted" style={{ fontSize: 12 }}>({node.slug})</span>}
        <span className="badge acc" title="entities in this branch">{node.subtree_entities} entities</span>
        {node.subtree_pending > 0
          ? <span className="badge warn" title="pending review items in this branch">{node.subtree_pending} pending</span>
          : <span className="badge good">0 pending</span>}
        {!node.is_group && (
          <span className="note" style={{ marginTop: 0 }}>
            variance: <b>{node.effective_threshold_pct}%</b>{node.threshold_is_default ? ' (default)' : ''}
          </span>
        )}
        {/* management controls */}
        <button className="ghost" style={{ padding: '2px 8px', marginLeft: 'auto' }} onClick={() => { setManage(m => !m); setName(node.display_name); setDesc(node.description || ''); setParent(node.parent_slug || ''); }}>edit</button>
        <button className="ghost" style={{ padding: '2px 8px' }} onClick={() => setAddingSub(s => !s)}>+ sub</button>
        {!node.is_group && !edit && <button className="ghost" style={{ padding: '2px 8px' }} onClick={() => setEdit(true)}>threshold</button>}
        {!node.is_group && tpl && (
          <button className="ghost" style={{ padding: '2px 8px' }} onClick={() => onOpenRefine(openRefineFor === tpl.id ? null : tpl.id)}>
            {openRefineFor === tpl.id ? 'close template' : `solve template (streak ${tpl.clean_streak}${tpl.auto_publish ? ', trusted' : ''})`}
          </button>
        )}
        {canDelete && <button className="ghost" style={{ padding: '2px 8px', color: 'var(--bad)' }} onClick={del}>delete</button>}
      </div>

      {err && <div className="lic" style={{ paddingLeft: depth * 22 }}>⚠ {err}</div>}

      {edit && (
        <div className="row" style={{ gap: 4, paddingLeft: depth * 22 + 22 }}>
          <span className="note" style={{ marginTop: 0 }}>variance threshold %:</span>
          <input type="number" min="0" max="100" style={{ width: 70 }} value={val} onChange={e => setVal(e.target.value)} placeholder={String(defaultThr)} />
          <button className="primary" style={{ padding: '2px 8px' }} onClick={() => saveThr(false)}>save</button>
          <button className="ghost" style={{ padding: '2px 8px' }} onClick={() => saveThr(true)}>use default</button>
          <button className="ghost" style={{ padding: '2px 8px' }} onClick={() => setEdit(false)}>cancel</button>
        </div>
      )}

      {manage && (
        <div className="panel" style={{ background: '#12202e', marginLeft: depth * 22 + 22, marginTop: 4 }}>
          <div className="row">
            <div style={{ flex: 1 }}><label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label>Parent</label>
              <select value={parent} onChange={e => setParent(e.target.value)}>
                <option value="">— top level —</option>
                {allCats.filter(c => c.slug !== node.slug).map(c => <option key={c.slug} value={c.slug}>{c.display_name} ({c.slug})</option>)}
              </select></div>
          </div>
          <label style={{ marginTop: 6 }}>Description</label>
          <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} placeholder="(optional)" />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={saveManage}>Save changes</button>
            <button className="ghost" onClick={() => setManage(false)}>cancel</button>
          </div>
        </div>
      )}

      {addingSub && (
        <div className="panel" style={{ background: '#12202e', marginLeft: depth * 22 + 22, marginTop: 4 }}>
          <label>New subcategory under “{node.display_name}”</label>
          <div className="row">
            <input value={subName} onChange={e => setSubName(e.target.value)} placeholder="display name" />
            <label style={{ textTransform: 'none', display: 'inline' }}>
              <input type="checkbox" checked={subIsGroup} onChange={e => setSubIsGroup(e.target.checked)} /> grouping node
            </label>
            <button className="primary" onClick={addSub}>Create</button>
            <button className="ghost" onClick={() => setAddingSub(false)}>cancel</button>
          </div>
        </div>
      )}

      {!node.is_group && tpl && openRefineFor === tpl.id && (
        <div style={{ paddingLeft: depth * 22 + 22 }}>
          <TemplateRefineEditor templateId={tpl.id} onReweighed={onChange} />
        </div>
      )}
      {(node.children || []).map(c => (
        <CategoryNode key={c.slug} node={c} depth={depth + 1} templates={templates} allCats={allCats}
          defaultThr={defaultThr} onChange={onChange} onOpenRefine={onOpenRefine} openRefineFor={openRefineFor} />
      ))}
    </div>
  );
}

// canonical built-in leaves that can't be deleted (kept in sync with the server)
const CANONICAL = ['ship','manufacturer','weapon','item','location','commodity','npc','mechanic','quest','lore','patch_note','trade_route'];

function flattenCats(nodes, out = []) {
  for (const n of nodes) { out.push({ slug: n.slug, display_name: n.display_name }); flattenCats(n.children || [], out); }
  return out;
}

function CategoriesTab() {
  const [tree, setTree] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [defaultThr, setDefaultThr] = useState(40);
  const [openRefineFor, setOpenRefineFor] = useState(null);
  // create-category form
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const [newIsGroup, setNewIsGroup] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const [createMsg, setCreateMsg] = useState(null);

  async function load() {
    const [t, tpl] = await Promise.all([api('/admin/categories/tree'), api('/admin/templates')]);
    setTree(t.tree || []);
    setDefaultThr(t.default_variance_threshold_pct ?? 40);
    setTemplates(tpl.items || []);
  }
  useEffect(() => { load(); }, []);
  const allCats = flattenCats(tree);

  async function createCat() {
    setCreateErr(null); setCreateMsg(null);
    const r = await api('/admin/categories', { display_name: newName, parent_slug: newParent === '' ? null : newParent, is_group: newIsGroup });
    if (r.error) { setCreateErr(r.error.message); return; }
    setCreateMsg(`Created “${r.display_name}” (${r.slug}).`);
    setNewName(''); setNewParent(''); setNewIsGroup(false);
    load();
  }

  return (
    <div className="panel">
      <div className="row">
        <h3>Category management</h3>
        <span className="note">Default variance threshold: <b>{defaultThr}%</b> · entity + pending badges update live</span>
        <button className="ghost" style={{ marginLeft: 'auto' }} onClick={load}>↻ refresh</button>
      </div>

      {/* CREATE a top-level or nested category */}
      <div className="panel" style={{ background: '#12202e', marginTop: 8 }}>
        <label>Create a category or subcategory</label>
        <div className="row">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="display name (slug auto-derived)" />
          <select value={newParent} onChange={e => setNewParent(e.target.value)}>
            <option value="">— top level —</option>
            {allCats.map(c => <option key={c.slug} value={c.slug}>{c.display_name} ({c.slug})</option>)}
          </select>
          <label style={{ textTransform: 'none', display: 'inline' }}>
            <input type="checkbox" checked={newIsGroup} onChange={e => setNewIsGroup(e.target.checked)} /> grouping node
          </label>
          <button className="primary" onClick={createCat}>Create</button>
        </div>
        {createErr && <div className="lic" style={{ marginTop: 6 }}>⚠ {createErr}</div>}
        {createMsg && <div className="hint" style={{ marginTop: 6 }}>✓ {createMsg}</div>}
      </div>

      <div style={{ marginTop: 12 }}>
        {tree.map(n => (
          <CategoryNode key={n.slug} node={n} depth={0} templates={templates} allCats={allCats}
            defaultThr={defaultThr} onChange={load} onOpenRefine={setOpenRefineFor} openRefineFor={openRefineFor} />
        ))}
      </div>
    </div>
  );
}

function EntitiesTab({ role }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [tree, setTree] = useState([]);
  const [activeCat, setActiveCat] = useState(null);   // slug filter from the tree
  const [expanded, setExpanded] = useState({});       // tree expand/collapse state
  const [showRemoved, setShowRemoved] = useState(false); // "Removed" filter
  const [sel, setSel] = useState(null);               // full entity being edited
  const [meta, setMeta] = useState({ categories: [], relation_types: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // editable form state (mirrors the entity, applied on Save)
  const [form, setForm] = useState(null);
  // link-builder state
  const [targetQ, setTargetQ] = useState('');
  const [targetResults, setTargetResults] = useState([]);
  const [targetId, setTargetId] = useState('');
  const [targetName, setTargetName] = useState('');
  const [relType, setRelType] = useState('');
  const [relCustom, setRelCustom] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const bumpPreview = () => setPreviewKey(k => k + 1);

  useEffect(() => { api('/admin/meta').then(d => setMeta({ categories: d.categories || [], relation_types: d.relation_types || [] })); }, []);
  async function loadTree() {
    const d = await api('/admin/categories/tree');
    setTree(d.tree || []);
  }
  async function search(catOverride, removedOverride) {
    setError(null);
    const cat = catOverride === undefined ? activeCat : catOverride;
    const removed = removedOverride === undefined ? showRemoved : removedOverride;
    const url = '/admin/entities?q=' + encodeURIComponent(q) + (cat ? '&category=' + encodeURIComponent(cat) : '') + (removed ? '&status=removed' : '');
    const d = await api(url);
    if (d.error) { setError(d.error.message); return; }
    setItems(d.items || []);
  }
  useEffect(() => { loadTree(); search(); }, []);   // initial load
  function toggleRemoved() {
    const next = !showRemoved;
    setShowRemoved(next);
    search(undefined, next);
  }

  function seedForm(d) {
    setForm({
      name: d.name || '',
      summary: d.summary || '',
      body: d.body || '',
      aliases: (d.aliases || []).join(', '),
      category: d.category,
      game_version: d.game_version || '',
      status: d.status || 'current',
      attributes: Object.entries(d.attributes || {}).filter(([k]) => k !== 'category').map(([k, v]) => ({ k, v: v === null ? '' : String(v) })),
      images: (d.images || []).map(im => ({ ...im })),
      relations: (d.relations || []).map(r => ({ ...r })),
      source: { origin: (d.source && d.source.origin) || '', url: (d.source && d.source.url) || '',
        confidence: (d.source && d.source.confidence) || '', last_verified: (d.source && d.source.last_verified) || '',
        hidden: !!(d.source && d.source.hidden) },
    });
  }
  async function open(id) {
    setError(null); setSel(null); setForm(null); setSaved(false);
    const d = await api('/admin/entities/' + encodeURIComponent(id));
    if (d.error) { setError(d.error.message); return; }
    setSel(d);
    seedForm(d);
  }
  function setF(patch) { setForm(f => ({ ...f, ...patch })); setSaved(false); }
  function setAttr(i, patch) { setForm(f => ({ ...f, attributes: f.attributes.map((a, j) => j === i ? { ...a, ...patch } : a) })); setSaved(false); }
  function addAttr() { setForm(f => ({ ...f, attributes: [...f.attributes, { k: '', v: '' }] })); }
  function rmAttr(i) { setForm(f => ({ ...f, attributes: f.attributes.filter((_, j) => j !== i) })); }
  function setImg(i, patch) { setForm(f => ({ ...f, images: f.images.map((im, j) => j === i ? { ...im, ...patch } : im) })); setSaved(false); }
  function addImg() { setForm(f => ({ ...f, images: [...f.images, { url: '', caption: '', role: 'gallery', added_by: 'admin', source_url: null, license_note: 'Manually added by admin — verify license before public use.' }] })); }
  function rmImg(i) { setForm(f => ({ ...f, images: f.images.filter((_, j) => j !== i) })); }
  function rmRel(i) { setForm(f => ({ ...f, relations: f.relations.filter((_, j) => j !== i) })); setSaved(false); }

  async function searchTargets() {
    const d = await api('/admin/entities?q=' + encodeURIComponent(targetQ));
    if (!d.error) setTargetResults((d.items || []).filter(x => x.id !== (sel && sel.id)).slice(0, 20));
  }
  function stageLink() {
    const relation_type = (relCustom.trim() || relType).trim();
    if (!relation_type) { setError('Choose or type a relation type.'); return; }
    if (!targetId) { setError('Pick a target entity to link to.'); return; }
    setError(null);
    setForm(f => {
      if (f.relations.some(r => r.type === relation_type && r.target_id === targetId)) return f;
      return { ...f, relations: [...f.relations, { type: relation_type, target_id: targetId, target_name: targetName, target_type: null, broken: false }] };
    });
    setTargetId(''); setTargetName(''); setTargetQ(''); setTargetResults([]); setRelCustom(''); setSaved(false);
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const attrs = {};
    for (const { k, v } of form.attributes) { if (k.trim()) attrs[k.trim()] = v === '' ? null : v; }
    const patch = {
      name: form.name,
      summary: form.summary,
      body: form.body,
      aliases: form.aliases.split(',').map(s => s.trim()).filter(Boolean),
      category: form.category,
      game_version: form.game_version,
      status: form.status,
      attributes: attrs,
      images: form.images.filter(im => (im.url || '').trim()),
      relations: form.relations.map(r => ({ type: r.type, target_id: r.target_id })),
      source: { origin: form.source.origin || null, url: form.source.url || null,
        confidence: form.source.confidence || null, last_verified: form.source.last_verified || null,
        hidden: !!form.source.hidden },
    };
    const d = await api('/admin/entities/' + encodeURIComponent(sel.id), patch);
    setBusy(false);
    if (d.error) { setError(d.error.message || 'Save failed'); return; }
    setSel(d);
    // re-seed the form from the saved entity (reflects server normalization) but
    // KEEP the saved confirmation visible.
    seedForm(d); setSaved(true);
    bumpPreview(); loadTree(); search();
  }

  function toggle(slug) { setExpanded(e => ({ ...e, [slug]: !e[slug] })); }
  function pickCat(slug) { setActiveCat(slug); search(slug); }

  // ---- tiered delete: soft-delete ("Remove entry"), restore, hard-delete.
  // Hard-delete friction is enforced server-side by role (super_admin =
  // single confirm, admin = type the exact name); this just gathers the
  // right proof-of-intent before calling the endpoint.
  async function removeEntry() {
    if (!sel) return;
    if (!confirm(`Remove "${sel.name}" from the public knowledge base? It can be restored later from the Removed filter.`)) return;
    setBusy(true); setError(null);
    const d = await api(`/admin/entities/${encodeURIComponent(sel.id)}/remove`, {});
    setBusy(false);
    if (d.error) { setError(d.error.message); return; }
    setSel(d); seedForm(d); loadTree(); search();
  }
  async function restoreEntry() {
    if (!sel) return;
    setBusy(true); setError(null);
    const d = await api(`/admin/entities/${encodeURIComponent(sel.id)}/restore`, {});
    setBusy(false);
    if (d.error) { setError(d.error.message); return; }
    setSel(d); seedForm(d); loadTree(); search();
  }
  async function hardDeleteEntry() {
    if (!sel) return;
    setError(null);
    let body;
    if (role === 'super_admin') {
      if (!confirm(`Permanently delete "${sel.name}" (${sel.id})? This removes the entity and its embedding — there is no restore. An audit snapshot is kept.`)) return;
      body = { confirm: true };
    } else {
      const typed = prompt(`Type the exact entity name to permanently delete it — there is no restore:\n\n${sel.name}`);
      if (typed === null) return;
      body = { confirm_name: typed };
    }
    setBusy(true);
    const d = await api(`/admin/entities/${encodeURIComponent(sel.id)}/hard-delete`, body);
    setBusy(false);
    if (d.error) { setError(d.error.message); return; }
    setSel(null); setForm(null); loadTree(); search();
  }

  // recursively render the category tree as browse navigation
  function TreeRow({ node, depth }) {
    const kids = node.children || [];
    const hasKids = kids.length > 0;
    const isOpen = expanded[node.slug] !== false; // default open
    return (
      <div>
        <div className="row" style={{ padding: '2px 0', paddingLeft: depth * 16, alignItems: 'center', gap: 6 }}>
          {hasKids
            ? <button className="ghost" style={{ padding: '0 6px', minWidth: 22 }} onClick={() => toggle(node.slug)}>{isOpen ? '▾' : '▸'}</button>
            : <span style={{ display: 'inline-block', width: 22 }} />}
          {node.is_group
            ? <b style={{ fontSize: 13 }}>{node.display_name}</b>
            : <button className={'ghost' + (activeCat === node.slug ? ' active' : '')}
                style={{ padding: '2px 8px', fontWeight: activeCat === node.slug ? 700 : 400 }}
                onClick={() => pickCat(node.slug)}>{node.display_name}</button>}
          <span className="badge acc" title="entities in this branch">{node.subtree_entities}</span>
        </div>
        {hasKids && isOpen && kids.map(c => <TreeRow key={c.slug} node={c} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div>
      {error && <div className="panel" style={{ borderColor: 'var(--bad)' }}><b className="lic">⚠ {error}</b></div>}
      <div className="split">
        {/* LEFT: category-tree navigation */}
        <div className="split-left" style={{ maxWidth: 300 }}>
          <div className="panel">
            <div className="row"><b>Browse by category</b>
              <button className="ghost" style={{ marginLeft: 'auto', padding: '2px 8px' }} onClick={() => { setActiveCat(null); search(null); }}>{activeCat ? 'clear' : 'all'}</button>
            </div>
            <div style={{ marginTop: 8 }}>
              <div className="row" style={{ padding: '2px 0' }}>
                <button className={'ghost' + (activeCat === null ? ' active' : '')} style={{ fontWeight: activeCat === null ? 700 : 400 }} onClick={() => { setActiveCat(null); search(null); }}>All entities</button>
              </div>
              {tree.map(n => <TreeRow key={n.slug} node={n} depth={0} />)}
            </div>
          </div>
        </div>

        {/* RIGHT: list + editor */}
        <div className="split-right" style={{ flex: 1 }}>
          <div className="panel">
            <div className="row">
              <input type="text" placeholder="Search by name, id, or alias…" value={q}
                     onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
              <button className="primary" onClick={() => search()}>Search</button>
              {activeCat && <span className="badge acc">category: {activeCat}</span>}
              <button className={'ghost' + (showRemoved ? ' active' : '')} onClick={toggleRemoved}>{showRemoved ? '✓ Removed' : 'Removed'}</button>
            </div>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Name</th><th>ID</th><th>Category</th><th>Status</th><th>Links</th><th></th></tr></thead>
              <tbody>{items.map(it => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td className="muted">{it.id}</td>
                  <td><span className="badge acc">{it.category}</span></td>
                  <td>{it.status === 'removed' ? <span className="badge bad">removed</span> : <span className="muted">{it.status}</span>}</td>
                  <td>{it.relation_count}</td>
                  <td><button className="ghost" onClick={() => open(it.id)}>edit</button></td>
                </tr>
              ))}</tbody>
            </table>
            {items.length === 0 && <div className="note">No entities found{activeCat ? ` in "${activeCat}"` : ''}.</div>}
          </div>

          {sel && form && <EntityEditForm
            sel={sel} form={form} meta={meta} busy={busy} saved={saved} previewKey={previewKey} role={role}
            setF={setF} setAttr={setAttr} addAttr={addAttr} rmAttr={rmAttr}
            setImg={setImg} addImg={addImg} rmImg={rmImg} rmRel={rmRel}
            targetQ={targetQ} setTargetQ={setTargetQ} targetResults={targetResults} searchTargets={searchTargets}
            targetId={targetId} setTargetId={setTargetId} setTargetName={setTargetName}
            relType={relType} setRelType={setRelType} relCustom={relCustom} setRelCustom={setRelCustom}
            stageLink={stageLink} save={save} onClose={() => { setSel(null); setForm(null); }}
            removeEntry={removeEntry} restoreEntry={restoreEntry} hardDeleteEntry={hardDeleteEntry} />}
        </div>
      </div>
    </div>
  );
}

// Shows recorded green-confirm corroboration signals for an entity — the
// admin-tool-side proof that a wiki-page click actually persisted a signal,
// not just a frontend checkmark.
function FieldConfirmations({ entityId, refreshKey }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!entityId) return;
    api('/admin/entities/' + encodeURIComponent(entityId) + '/confirmations').then(d => setItems(d.items || []));
  }, [entityId, refreshKey]);
  if (!items.length) return <div className="note">No confirmation signals recorded for this entity yet.</div>;
  return (
    <table>
      <thead><tr><th>Field</th><th>Value at the time</th><th>Confirmed by</th><th>When</th></tr></thead>
      <tbody>{items.map(c => (
        <tr key={c.id}>
          <td><span className="badge acc">{c.field_name}</span></td>
          <td className="muted">{c.current_value ?? '—'}</td>
          <td>{c.submitted_by}</td>
          <td className="muted">{new Date(c.created_at).toLocaleString()}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

// The real plain-language entity edit form. One input per field + attribute,
// editable images, staged relations via search-and-link, category dropdown, and
// the source hide/unhide toggle. Saving posts the whole patch (no raw JSON).
// The shared plain-language field editor: one input per field + attribute,
// editable images, staged relations via search-and-link, category dropdown,
// and the source hide/unhide toggle. Used by BOTH the Entities tab's "edit"
// form and the Review Queue's "edit before publishing" draft editor, so a
// scraped draft gets exactly the same editor a reviewer already knows from
// editing a live entity — no raw JSON either place.
function EntityFieldsEditor(p) {
  const { form, meta } = p;
  return (
    <div>
      <label>Name</label>
      <input type="text" value={form.name} onChange={e => p.setF({ name: e.target.value })} />

      <label>Summary</label>
      <textarea rows={3} value={form.summary} onChange={e => p.setF({ summary: e.target.value })} placeholder="(empty → null)" />

      <label>Body (long-form)</label>
      <textarea rows={4} value={form.body} onChange={e => p.setF({ body: e.target.value })} placeholder="(empty → null)" />

      <label>Aliases (comma-separated)</label>
      <input type="text" value={form.aliases} onChange={e => p.setF({ aliases: e.target.value })} />

      <div className="row" style={{ marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <label>Category / subcategory</label>
          <select value={form.category} onChange={e => p.setF({ category: e.target.value })}>
            {meta.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label>Game version</label>
          <input type="text" value={form.game_version} onChange={e => p.setF({ game_version: e.target.value })} placeholder="(empty → null)" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Status</label>
          <select value={form.status === 'removed' ? 'current' : form.status} onChange={e => p.setF({ status: e.target.value })} disabled={form.status === 'removed'}>
            <option value="current">current</option>
            <option value="deprecated">deprecated</option>
          </select>
          {form.status === 'removed' && <div className="note">Removed — use Restore below, or edit the status field directly won't un-remove it.</div>}
        </div>
      </div>

      {/* ATTRIBUTES */}
      <div style={{ marginTop: 16 }}>
        <label>Attributes (per-field; empty value → null, never guessed)</label>
        <table>
          <thead><tr><th>Field</th><th>Value</th><th></th></tr></thead>
          <tbody>{form.attributes.map((a, i) => (
            <tr key={i}>
              <td><input className="fieldname" value={a.k} onChange={e => p.setAttr(i, { k: e.target.value })} /></td>
              <td><input style={{ width: '100%' }} value={a.v} onChange={e => p.setAttr(i, { v: e.target.value })} placeholder="(empty → null)" /></td>
              <td><button className="ghost" onClick={() => p.rmAttr(i)}>remove</button></td>
            </tr>
          ))}</tbody>
        </table>
        <button className="ghost" style={{ marginTop: 6 }} onClick={p.addAttr}>+ add attribute</button>
      </div>

      {/* IMAGES */}
      <div style={{ marginTop: 16 }}>
        <label>Images</label>
        {form.images.map((im, i) => (
          <div key={i} className="row" style={{ marginBottom: 6, alignItems: 'center' }}>
            {im.url ? <img className="thumb" src={im.url} alt="" /> : <div className="pimg-missing" style={{ width: 48, height: 48 }}>?</div>}
            <input style={{ flex: 2 }} value={im.url} onChange={e => p.setImg(i, { url: e.target.value })} placeholder="image URL" />
            <input style={{ flex: 2 }} value={im.caption || ''} onChange={e => p.setImg(i, { caption: e.target.value })} placeholder="caption" />
            <select value={im.role} onChange={e => p.setImg(i, { role: e.target.value })}>
              <option value="primary">primary</option><option value="gallery">gallery</option>
            </select>
            <button className="ghost" onClick={() => p.rmImg(i)}>remove</button>
          </div>
        ))}
        <button className="ghost" style={{ marginTop: 4 }} onClick={p.addImg}>+ add image</button>
      </div>

      {/* RELATIONS */}
      <div style={{ marginTop: 16 }}>
        <label>Cross-links (relations to other entities)</label>
        <table>
          <thead><tr><th>Relation</th><th>Target</th><th></th></tr></thead>
          <tbody>{form.relations.map((r, i) => (
            <tr key={i}>
              <td><span className="badge">{r.type}</span></td>
              <td>{r.target_name || r.target_id} <span className="muted">({r.target_id})</span>
                {r.broken && <span className="badge bad" style={{ marginLeft: 6 }}>missing target</span>}</td>
              <td><button className="ghost" onClick={() => p.rmRel(i)}>remove</button></td>
            </tr>
          ))}</tbody>
        </table>
        {form.relations.length === 0 && <div className="note">No cross-links yet.</div>}
        <div className="panel" style={{ marginTop: 8, background: '#12202e' }}>
          <label>Add a cross-link</label>
          <div className="row">
            <select value={p.relType} onChange={e => p.setRelType(e.target.value)}>
              <option value="">— relation type —</option>
              {meta.relation_types.map(rt => <option key={rt} value={rt}>{rt}</option>)}
            </select>
            <input type="text" placeholder="…or a custom relation" value={p.relCustom} onChange={e => p.setRelCustom(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="text" placeholder="Search target entity by name…" value={p.targetQ}
                   onChange={e => p.setTargetQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && p.searchTargets()} />
            <button className="ghost" onClick={p.searchTargets}>Find</button>
          </div>
          {p.targetResults.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {p.targetResults.map(t => (
                <div key={t.id}>
                  <label style={{ textTransform: 'none', display: 'inline' }}>
                    <input type="radio" name="targetpick" checked={p.targetId === t.id} onChange={() => { p.setTargetId(t.id); p.setTargetName(t.name); }} />
                    {' '}{t.name} <span className="muted">({t.id}, {t.category})</span>
                  </label>
                </div>
              ))}
            </div>
          )}
          <button className="primary" style={{ marginTop: 10 }} onClick={p.stageLink}>Stage link</button>
        </div>
      </div>

      {/* SOURCE + hide/unhide */}
      <div style={{ marginTop: 16 }}>
        <label>Source</label>
        <div className="row">
          <input style={{ flex: 1 }} value={form.source.origin} onChange={e => p.setF({ source: { ...form.source, origin: e.target.value } })} placeholder="origin (e.g. starcitizen.tools)" />
          <input style={{ flex: 2 }} value={form.source.url} onChange={e => p.setF({ source: { ...form.source, url: e.target.value } })} placeholder="source URL" />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <select value={form.source.confidence} onChange={e => p.setF({ source: { ...form.source, confidence: e.target.value } })}>
            <option value="">confidence —</option>
            <option value="confirmed">confirmed</option>
            <option value="community">community</option>
            <option value="speculative">speculative</option>
          </select>
          <input value={form.source.last_verified} onChange={e => p.setF({ source: { ...form.source, last_verified: e.target.value } })} placeholder="last_verified YYYY-MM-DD" />
          <label style={{ textTransform: 'none', display: 'inline', marginLeft: 'auto' }}>
            <input type="checkbox" checked={!!form.source.hidden} onChange={e => p.setF({ source: { ...form.source, hidden: e.target.checked } })} />
            {' '}hide source from public API
          </label>
        </div>
        <div className="note">Hiding keeps confidence + last_verified public but suppresses origin/URL in the wiki payload.</div>
      </div>
    </div>
  );
}

// category<->type mapping mirrored from apps/admin/src/entities-admin.ts
// categoryToType (ship/manufacturer/weapon/item all live under base type
// 'item'; everything else maps 1:1). Kept in sync manually — same convention
// as the rest of this plain-React (no build step) app.
function categoryToType(category) {
  switch (category) {
    case 'location': return 'location';
    case 'commodity': return 'commodity';
    case 'npc': return 'npc';
    case 'mechanic': return 'mechanic';
    case 'quest': return 'quest';
    case 'lore': return 'lore';
    case 'patch_note': return 'patch_note';
    case 'trade_route': return 'trade_route';
    default: return 'item';
  }
}

function EntityEditForm(p) {
  const { sel, form, meta, busy, saved, previewKey } = p;
  return (
    <div className="split" style={{ marginTop: 12 }}>
      <div className="split-left">
        <div className="panel">
          <div className="row"><h3 style={{ marginRight: 'auto' }}>Edit {sel.name} <span className="muted">({sel.id})</span></h3>
            <button className="ghost" onClick={p.onClose}>close</button></div>

          <EntityFieldsEditor {...p} />

          {/* TIERED DELETE — soft-delete is a single confirm; hard-delete friction
              scales with role (super_admin: one checkbox; admin: type the name). */}
          <div className="panel" style={{ marginTop: 16, borderColor: 'var(--bad)' }}>
            <label>Danger zone</label>
            <div className="row" style={{ marginTop: 6 }}>
              {sel.status === 'removed' ? (
                <button className="ghost" onClick={p.restoreEntry} disabled={p.busy}>Restore entry</button>
              ) : (
                <button className="danger" onClick={p.removeEntry} disabled={p.busy}>Remove entry</button>
              )}
              <button className="danger" onClick={p.hardDeleteEntry} disabled={p.busy}>Hard delete permanently</button>
              <span className="role-badge" style={{ marginLeft: 'auto' }}>{p.role === 'super_admin' ? 'single confirm' : 'type name to confirm'}</span>
            </div>
            <div className="note">Remove entry hides it from the public API/wiki (status=removed) and can be restored. Hard delete removes the row + embedding permanently; both actions are recorded in the entity's audit log.</div>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" onClick={p.save} disabled={busy}>{busy ? 'Saving…' : 'Save all changes'}</button>
            {saved && <span className="badge good">✓ saved — ai-context regenerated</span>}
          </div>
          {sel.ai_context && <div className="note" style={{ marginTop: 12 }}><b>ai-context (auto-generated):</b> {sel.ai_context}</div>}

          <div className="panel" style={{ marginTop: 16 }}>
            <label>Corroboration signals (green confirm, from the live wiki)</label>
            <FieldConfirmations entityId={sel.id} refreshKey={previewKey} />
          </div>
        </div>
      </div>
      <div className="split-right">
        <WikiPreview entityId={sel.id} refreshKey={previewKey} />
      </div>
    </div>
  );
}

// Column 2 of the three-column admin layout ("USSA nav+queue"): tab nav plus
// live pending-item counts (scraper review queue + corrections queue), so the
// reviewer sees what needs attention without opening each tab. Column 1
// ("WordPress menu") is the wp-admin sidebar around this app when it's loaded
// via the SSO iframe (see the ussalmc-admin wp-admin page); column 3 is each
// tab's own editor+preview area.
function QueueNav({ tab, setTab, username, role }) {
  const [counts, setCounts] = useState({ queue: 0, corrections: 0 });
  async function refresh() {
    const [q, c] = await Promise.all([api('/admin/queue?status=pending'), api('/admin/corrections?status=pending')]);
    setCounts({ queue: (q.items || []).length, corrections: (c.items || []).length });
  }
  useEffect(() => { refresh(); const id = setInterval(refresh, 15000); return () => clearInterval(id); }, []);
  const TABS = [
    ['scan', 'Scan'], ['entities', 'Entities'], ['queue', 'Review Queue'],
    ['corrections', 'Corrections'], ['categories', 'Categories'], ['templates', 'Templates'],
  ];
  return (
    <nav className="app-nav">
      <div className="navhdr">Signed in</div>
      <div style={{ marginBottom: 4 }}>{username}</div>
      <span className="role-badge">{role}</span>
      <div className="navhdr">USSA Knowledge Base</div>
      {TABS.map(([id, label]) => (
        <button key={id} className={'navbtn' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
          {label}
          {id === 'queue' && counts.queue > 0 && <span className="cnt">{counts.queue}</span>}
          {id === 'corrections' && counts.corrections > 0 && <span className="cnt">{counts.corrections}</span>}
        </button>
      ))}
      <button className="ghost" style={{ marginTop: 16, width: '100%' }} onClick={async()=>{ await api('/admin/logout',{}); location.reload(); }}>Log out</button>
    </nav>
  );
}

function App({ username, role }) {
  const [tab, setTab] = useState('scan');
  return (
    <div>
      <header>
        <h1>USSALMC Admin · Scraper &amp; Review</h1>
      </header>
      <div className="app-shell">
        <QueueNav tab={tab} setTab={setTab} username={username} role={role} />
        <main className={'app-main' + (tab==='entities' || tab==='queue' ? ' wide' : '')}>
          {tab==='scan' && <ScanTab />}
          {tab==='entities' && <EntitiesTab role={role} />}
          {tab==='queue' && <QueueTab />}
          {tab==='corrections' && <CorrectionsTab />}
          {tab==='categories' && <CategoriesTab />}
          {tab==='templates' && <TemplatesTab />}
        </main>
      </div>
    </div>
  );
}

// Field-corrections ("red flag") review queue: accept applies the suggested
// value to the entity (regenerating ai_context) and logs who submitted it +
// who approved it; reject just logs the decision. Distinct from the
// scraper's review_queue (QueueTab above).
function CorrectionsTab() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('pending');
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setError(null);
    const d = await api('/admin/corrections?status=' + status);
    if (d.error) { setError(d.error.message); return; }
    setItems(d.items || []);
  }
  useEffect(() => { load(); }, [status]);

  async function act(id, action) {
    setBusyId(id); setError(null);
    const d = await api(`/admin/corrections/${id}/${action}`, {});
    setBusyId(null);
    if (d.error) { setError(d.error.message); return; }
    load();
  }

  return (
    <div>
      <div className="panel">
        <div className="row">
          <b>Field corrections</b>
          <div className="tabs" style={{ marginLeft: 'auto' }}>
            {['pending', 'accepted', 'rejected'].map(s => (
              <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="note">Corrections submitted via the red flag on live wiki pages. Accepting applies the suggested value and regenerates ai-context.</div>
      </div>
      {error && <div className="panel" style={{ borderColor: 'var(--bad)' }}><b className="lic">⚠ {error}</b></div>}
      <div className="panel">
        <table>
          <thead><tr><th>Entity</th><th>Field</th><th>Current</th><th>Suggested</th><th>Note</th><th>Submitted by</th><th>When</th>{status === 'pending' && <th></th>}</tr></thead>
          <tbody>{items.map(c => (
            <tr key={c.id}>
              <td>{c.entity_name || c.entity_id}<div className="muted">{c.entity_id}</div></td>
              <td><span className="badge acc">{c.field_name}</span></td>
              <td className="muted">{c.current_value ?? '—'}</td>
              <td>{c.suggested_value}</td>
              <td className="muted">{c.note || '—'}</td>
              <td>{c.submitted_by}</td>
              <td className="muted">{new Date(c.created_at).toLocaleString()}</td>
              {status === 'pending' && (
                <td>
                  <button className="ghost" disabled={busyId===c.id} onClick={() => act(c.id, 'accept')} style={{ marginRight: 6 }}>Accept</button>
                  <button className="danger" disabled={busyId===c.id} onClick={() => act(c.id, 'reject')}>Reject</button>
                </td>
              )}
            </tr>
          ))}</tbody>
        </table>
        {items.length === 0 && <div className="note">No {status} corrections.</div>}
      </div>
    </div>
  );
}

function LoginScreen({ onLoggedIn }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e && e.preventDefault();
    setBusy(true); setError(null);
    const r = await api('/admin/login', { username: u, password: p });
    setBusy(false);
    if (r.error) { setError(r.error.message || 'Login failed'); return; }
    onLoggedIn();
  }
  return (
    <main style={{ maxWidth: 380 }}>
      <div className="panel">
        <h3>USSALMC Admin — Sign in</h3>
        {error && <div className="lic" style={{ marginBottom: 8 }}>⚠ {error}</div>}
        <form onSubmit={submit}>
          <label>Username</label>
          <input type="text" value={u} onChange={e=>setU(e.target.value)} autoFocus />
          <label>Password</label>
          <input type="password" value={p} onChange={e=>setP(e.target.value)} />
          <button className="primary" style={{ marginTop: 14 }} onClick={submit} disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
        </form>
      </div>
    </main>
  );
}

function ChangePasswordScreen({ username, onChanged }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e && e.preventDefault();
    if (nw !== nw2) { setError('New passwords do not match.'); return; }
    setBusy(true); setError(null);
    const r = await api('/admin/change-password', { current_password: cur, new_password: nw });
    setBusy(false);
    if (r.error) { setError(r.error.message || 'Change failed'); return; }
    onChanged();
  }
  return (
    <main style={{ maxWidth: 420 }}>
      <div className="panel">
        <h3>Change your password</h3>
        <div className="hint">You're using a development credential ({username}). Set a new password before continuing.</div>
        {error && <div className="lic" style={{ marginBottom: 8 }}>⚠ {error}</div>}
        <form onSubmit={submit}>
          <label>Current password</label>
          <input type="password" value={cur} onChange={e=>setCur(e.target.value)} autoFocus />
          <label>New password (min 8 chars)</label>
          <input type="password" value={nw} onChange={e=>setNw(e.target.value)} />
          <label>Confirm new password</label>
          <input type="password" value={nw2} onChange={e=>setNw2(e.target.value)} />
          <button className="primary" style={{ marginTop: 14 }} onClick={submit} disabled={busy}>{busy?'Saving…':'Set new password'}</button>
        </form>
      </div>
    </main>
  );
}

function Root() {
  const [state, setState] = useState({ loading: true });
  async function refresh() {
    const s = await api('/admin/session');
    setState({ loading: false, ...s });
  }
  useEffect(() => { refresh(); }, []);
  if (state.loading) return <main><div className="note">Loading…</div></main>;
  if (!state.authenticated) {
    return (<div><header><h1>USSALMC Admin</h1></header><LoginScreen onLoggedIn={refresh} /></div>);
  }
  if (state.must_change_password) {
    return (<div><header><h1>USSALMC Admin</h1></header><ChangePasswordScreen username={state.username} onChanged={refresh} /></div>);
  }
  return <App username={state.username} role={state.role} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
