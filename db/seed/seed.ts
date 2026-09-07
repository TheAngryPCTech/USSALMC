// seed.ts — Phase 1 seed data. Hand-authored, realistic Star Citizen entities.
// Run: npm run seed   (from apps/api)   OR   tsx db/seed/seed.ts
// Creates API keys (one per client) and example entities, exercising the full
// upsert pipeline so ai_context + embeddings are generated for real.

import crypto from 'node:crypto';
import { pool, query } from '../../apps/api/src/db.js';
import { upsertEntity } from '../../apps/api/src/entity-repo.js';
import { hashKey } from '../../apps/api/src/auth.js';

async function seedApiKeys() {
  // Real keys come from env (set in .env / compose). Fall back to the old dev
  // tokens ONLY when the env var is unset, so local dev keeps working but a
  // configured deployment never ships the well-known dev keys.
  const clients: { client: string; envVar: string; devToken: string; rate: number }[] = [
    { client: 'wiki', envVar: 'WIKI_API_KEY', devToken: 'wiki-dev-key-0001', rate: 300 },
    { client: 'mobile', envVar: 'MOBILE_API_KEY', devToken: 'mobile-dev-key-0001', rate: 120 },
    { client: 'desktop', envVar: 'DESKTOP_API_KEY', devToken: 'desktop-dev-key-0001', rate: 120 },
    { client: 'discord', envVar: 'DISCORD_API_KEY', devToken: 'discord-dev-key-0001', rate: 60 },
    { client: 'twitch', envVar: 'TWITCH_API_KEY', devToken: 'twitch-dev-key-0001', rate: 60 },
  ];
  let usingDevFallback = false;
  for (const c of clients) {
    const token = process.env[c.envVar] || c.devToken;
    if (!process.env[c.envVar]) usingDevFallback = true;
    await query(
      `INSERT INTO api_keys (id, client, key_hash, rate_limit_per_min, enabled)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (client) DO UPDATE SET key_hash=EXCLUDED.key_hash, rate_limit_per_min=EXCLUDED.rate_limit_per_min`,
      [`key_${c.client}`, c.client, hashKey(token), c.rate],
    );
  }
  console.log('Seeded API keys (per client). Tokens are read from env; only the');
  console.log('sha256 hash is stored in the database (never the plaintext token).');
  if (usingDevFallback) {
    console.log('WARNING: one or more *_API_KEY env vars were unset — the well-known');
    console.log('dev token(s) were used for those clients. Set real keys in .env for prod.');
  }
}

async function seedEntities() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Manufacturer — Anvil Aerospace
  await upsertEntity({
    id: 'manufacturer_anvil_aerospace',
    type: 'item', // manufacturers modeled as item-type org entities in Phase 1
    name: 'Anvil Aerospace',
    aliases: ['Anvil', 'ANVL'],
    summary: 'A human spacecraft manufacturer known for rugged, military-inspired ships.',
    body: '## Anvil Aerospace\nFounded in the aftermath of the First Tevarin War, Anvil Aerospace builds durable, combat-capable vessels favored by militaries and independent pilots alike.',
    attributes: {
      headquarters: 'Terra',
      manufacturer_code: 'ANVL',
      known_for: 'military and exploration craft',
      founded: null, // unknown — never guessed
    },
    relations: [],
    images: [{
      url: 'https://media.robertsspaceindustries.com/anvil/logo.png',
      caption: 'Anvil Aerospace logo', role: 'primary', added_by: 'admin',
      source_url: 'https://robertsspaceindustries.com/', license_note: 'Fan/reference use',
    }],
    source: { origin: 'RSI', url: 'https://robertsspaceindustries.com/', confidence: 'confirmed', last_verified: today },
    game_version: '3.23',
    status: 'current',
  });

  // 2. Ship — Anvil Carrack (manufactured_by Anvil)
  await upsertEntity({
    id: 'ship_carrack',
    type: 'item',
    name: 'Anvil Carrack',
    aliases: ['Carrack'],
    summary: 'A dedicated exploration vessel with a medical bay, vehicle bay, drone and modular cargo.',
    body: '## Anvil Carrack\nThe Carrack is Anvil Aerospace\u2019s flagship exploration ship, designed for long-duration expeditions beyond charted space.',
    attributes: {
      role: 'Exploration',
      crew_min: 4,
      crew_max: 6,
      cargo_capacity_scu: 456,
      length_m: 126.5,
      has_medical_bay: true,
      has_vehicle_bay: true,
    },
    relations: [
      { type: 'manufactured_by', target_id: 'manufacturer_anvil_aerospace' },
      { type: 'uses', target_id: 'item_size3_ballistic_cannon' },
    ],
    images: [{
      url: 'https://media.robertsspaceindustries.com/carrack/front.jpg',
      caption: 'Anvil Carrack exterior', role: 'primary', added_by: 'scraper',
      source_url: 'https://robertsspaceindustries.com/pledge/ships/anvil-carrack',
      license_note: 'Fan/reference use',
    }],
    source: { origin: 'RSI', url: 'https://robertsspaceindustries.com/pledge/ships/anvil-carrack', confidence: 'confirmed', last_verified: today },
    game_version: '3.23',
    status: 'current',
  });

  // 3. Weapon — a ship weapon used by the Carrack
  await upsertEntity({
    id: 'item_size3_ballistic_cannon',
    type: 'item',
    name: 'M6A Laser Cannon',
    aliases: ['M6A', 'Size 3 Laser Cannon'],
    summary: 'A size-3 ship-mounted laser cannon offering strong single-shot damage at moderate range.',
    body: '## M6A Laser Cannon\nA reliable size-3 energy weapon, valued for consistent damage output without ammunition constraints.',
    attributes: {
      weapon_class: 'laser cannon',
      size: 3,
      damage_type: 'energy',
      ammo: null, // energy weapon, no ballistic ammo
    },
    relations: [
      { type: 'used_by', target_id: 'ship_carrack' },
    ],
    images: [],
    source: { origin: 'community wiki', url: 'https://starcitizen.tools/', confidence: 'community', last_verified: today },
    game_version: '3.23',
    status: 'current',
  });

  // 4. Commodity — Laranite (for trade routes)
  await upsertEntity({
    id: 'commodity_laranite',
    type: 'commodity',
    name: 'Laranite',
    aliases: [],
    summary: 'A refined metal commodity traded across the Stanton system.',
    body: '## Laranite\nA valuable metal ore/refined good used in trading loops.',
    attributes: { category: 'metal', unit: 'SCU' },
    relations: [],
    images: [],
    source: { origin: 'community wiki', url: 'https://starcitizen.tools/Laranite', confidence: 'community', last_verified: today },
    game_version: '3.23',
    status: 'current',
  });

  // 5. Location — Port Olisar (speculative-status demo of null-honesty)
  await upsertEntity({
    id: 'location_area18',
    type: 'location',
    name: 'Area18',
    aliases: ['Area 18'],
    summary: 'A landing zone and trade hub on the planet ArcCorp in the Stanton system.',
    body: '## Area18\nDensely built commercial district and spaceport on ArcCorp.',
    attributes: { planet: 'ArcCorp', system: 'Stanton', population: null },
    relations: [],
    images: [],
    source: { origin: 'RSI', url: 'https://robertsspaceindustries.com/', confidence: 'confirmed', last_verified: today },
    game_version: '3.23',
    status: 'current',
  });

  console.log('Seeded 5 entities.');
}

async function seedTradeRoute() {
  // one confirmed trade route so /v1/trade-routes returns real data
  await query(
    `INSERT INTO trade_route_submissions
      (id, commodity, from_location, to_location, buy_price, sell_price,
       profit_per_unit, submitted_by, status, confirmations, last_verified)
     VALUES ('trade_route_0001','Laranite','Area18','Port Tressler',
             2650, 3120, 470, 'wiki', 'confirmed', 3, now())
     ON CONFLICT (id) DO UPDATE SET
       buy_price=EXCLUDED.buy_price, sell_price=EXCLUDED.sell_price,
       profit_per_unit=EXCLUDED.profit_per_unit, status='confirmed',
       last_verified=now(), updated_at=now()`,
  );
  console.log('Seeded 1 confirmed trade route.');
}

async function main() {
  await seedApiKeys();
  await seedEntities();
  await seedTradeRoute();
  await pool.end();
  console.log('Seed complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
