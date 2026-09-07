// robots.ts — fetch + parse robots.txt and enforce it before any scrape.
// Honors the general User-agent:* group and our own UA token. Also surfaces the
// Cloudflare Content-Signal line for logging (ai-train=no etc.).

const cache = new Map<string, { rules: Rule[]; contentSignal: string | null; fetchedAt: number }>();
const TTL_MS = 60 * 60 * 1000;

interface Rule { allow: boolean; path: string; }

function matchesUA(line: string, ua: string): boolean {
  const v = line.toLowerCase().trim();
  return v === '*' || ua.toLowerCase().includes(v);
}

async function loadRobots(origin: string, ua: string) {
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  let text = '';
  let contentSignal: string | null = null;
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': ua } });
    if (res.ok) text = await res.text();
  } catch { /* no robots = allow */ }

  // Collect rules from any group whose User-agent matches * or our UA.
  const lines = text.split('\n');
  const rules: Rule[] = [];
  let groupApplies = false;
  let sawUAInGroup = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw.toLowerCase().trim();
    const val = rest.join(':').trim();
    if (key === 'content-signal' && !contentSignal) contentSignal = val;
    if (key === 'user-agent') {
      if (!sawUAInGroup) { groupApplies = false; sawUAInGroup = true; }
      if (matchesUA(val, ua)) groupApplies = true;
    } else {
      sawUAInGroup = false;
      if (groupApplies && (key === 'allow' || key === 'disallow') && val) {
        rules.push({ allow: key === 'allow', path: val });
      }
    }
  }
  const entry = { rules, contentSignal, fetchedAt: Date.now() };
  cache.set(origin, entry);
  return entry;
}

export interface RobotsVerdict { allowed: boolean; reason: string; contentSignal: string | null; }

export async function checkRobots(targetUrl: string, ua: string): Promise<RobotsVerdict> {
  const u = new URL(targetUrl);
  const origin = `${u.protocol}//${u.host}`;
  const { rules, contentSignal } = await loadRobots(origin, ua);
  const path = u.pathname + u.search;

  // longest-match wins (standard robots precedence)
  let best: Rule | null = null;
  for (const r of rules) {
    const p = r.path.replace(/\*/g, '');
    if (path.startsWith(p)) {
      if (!best || r.path.length > best.path.length) best = r;
    }
  }
  if (best && !best.allow) {
    return { allowed: false, reason: `Disallowed by robots.txt rule "${best.path}"`, contentSignal };
  }
  return {
    allowed: true,
    reason: best ? `Allowed by robots.txt rule "${best.path}"` : 'No matching disallow rule',
    contentSignal,
  };
}
