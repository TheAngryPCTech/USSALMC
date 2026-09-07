// api-client.ts — thin HTTP client to the Phase 1 core API's /v1 trade-route
// endpoints. This app NEVER writes the DB directly; it goes through /v1.
//
// NB: read env lazily (inside the functions), not at module load — the server
// calls dotenv.config() after importing this module, so top-level reads would
// capture the values BEFORE .env is loaded and fall back to stale defaults.

function apiBase(): string {
  return process.env.TRADE_SUBMIT_API_BASE || `http://127.0.0.1:${process.env.API_PORT || 3000}`;
}
function apiKey(): string {
  return process.env.TRADE_SUBMIT_API_KEY || 'wiki-dev-key-0001';
}

export async function submitToApi(body: {
  commodity: string; from_location: string; to_location: string;
  buy_price: number | null; sell_price: number | null; account: string | null;
}): Promise<{ status: number; data: any }> {
  const res = await fetch(`${apiBase()}/v1/trade-routes/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

export async function confirmToApi(id: string, account: string | null): Promise<{ status: number; data: any }> {
  const res = await fetch(`${apiBase()}/v1/trade-routes/${id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey()}` },
    body: JSON.stringify({ account }),
  });
  return { status: res.status, data: await res.json() };
}

// Only report which client the key belongs to (prefix before the underscore),
// never the key itself.
export function apiInfo() {
  return { API_BASE: apiBase(), API_KEY_client: apiKey().split(/[-_]/)[0] };
}
