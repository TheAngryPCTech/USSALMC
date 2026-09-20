// import-youtube-guide.ts — Phase 22: ingest a creator-submitted YouTube
// tutorial into the knowledge base as a `guide` entity (category 'guide',
// see db/migrations/0014_guide_category.sql) so AngryDaemon/the wiki can
// actually teach pilots a specific task (mining, quantum travel, docking,
// combat, ...) step by step, not just answer lore/stat lookups.
//
// Pipeline: fetch the video's public transcript (no YouTube API key needed —
// same publicly-served caption track a browser fetches) -> feed it to a
// LOCAL LLM via Ollama (never a hosted API; matches the project's
// running-AI-locally constraint, see docs/decisions-log.md Phase 21) with a
// strict "extract only what's actually said, never invent" prompt -> store
// as a `guide` entity with confidence 'community' (per the confidence ladder
// in docs/schema.md, a single video transcript run through automated
// extraction never earns 'confirmed') -> print the full extracted result so
// the human importing it can spot-check before trusting it publicly.
//
// This is intentionally the SAME anti-fabrication discipline just added to
// AGENTS.md/apps/openclaw-mcp after a live hallucination incident (see
// docs/decisions-log.md, 2026-09-19): an LLM extracting structured steps
// from messy spoken transcript is exactly the kind of task that quietly
// invents plausible-sounding details if not constrained hard, so the
// extraction prompt below demands null/[] over guessing, same as every
// other cross-phase rule in this project.
//
// TWO-PHASE by necessity, not preference: Ollama (via the NVIDIA "Personal AI
// Router" in front of it) only accepts plaintext requests from true loopback
// — confirmed live, a request from inside the admin container (even via
// host.docker.internal) gets hard-rejected with {"code":"loopback-only"}.
// The `db` service, meanwhile, is deliberately unreachable from the host
// (no `ports:` mapping, `POSTGRES_HOST_AUTH_METHOD: trust` — safe ONLY
// because nothing outside the compose network can reach it; publishing even
// a loopback port would make it a credential-free connection for any local
// process, unlike the app services' loopback ports which still sit behind
// their own auth). So: no single place can reach both. Extraction runs on
// the HOST (real loopback to Ollama); storage runs INSIDE the admin
// container (real network access to `db`), bridged by a JSON payload on
// stdout/stdin — no infra/security changes needed on either side.
//
// Usage:
//   tsx src/import-youtube-guide.ts <youtube-url> [--topic mining] [--difficulty beginner] \
//     | docker compose exec -T admin npx tsx src/import-youtube-guide.ts --store-from-stdin
//
// (--topic/--difficulty are optional human hints/overrides — the LLM infers
// both from the transcript if omitted; a human-given value always wins.)

import { upsertEntity } from '../../api/src/entity-repo.js';
import { YoutubeTranscript } from 'youtube-transcript';

const line = (s = '') => console.error(s); // progress -> stderr; stdout stays pure JSON for piping

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
const EXTRACTION_MODEL = process.env.GUIDE_EXTRACTION_MODEL || 'qwen3.6:35b-a3b';

// Transcripts beyond this are truncated (with a clear note in the stored
// entity) rather than silently dropped or blowing the model's context —
// generous enough for a long-form tutorial at typical speech density.
const MAX_TRANSCRIPT_CHARS = 60_000;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

const nowIso = () => new Date().toISOString();

async function fetchVideoMeta(url: string): Promise<{ title: string }> {
  const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (!res.ok) throw new Error(`YouTube oEmbed HTTP ${res.status} — is this a real, public video URL?`);
  const body: any = await res.json();
  return { title: body.title };
}

async function fetchTranscriptText(url: string): Promise<{ text: string; truncated: boolean }> {
  const segments = await YoutubeTranscript.fetchTranscript(url);
  if (!segments.length) throw new Error('Transcript came back empty — video may have captions disabled.');
  const full = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  if (full.length <= MAX_TRANSCRIPT_CHARS) return { text: full, truncated: false };
  return { text: full.slice(0, MAX_TRANSCRIPT_CHARS), truncated: true };
}

interface ExtractedGuide {
  title: string | null;
  summary: string | null;
  topic: string | null;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | null;
  prerequisites: string[];
  estimated_minutes: number | null;
  ships_or_equipment: string[];
  steps: { order: number; instruction: string; tip: string | null }[];
  game_version_mentioned: string | null;
}

const EXTRACTION_SYSTEM_PROMPT = `You extract a structured how-to guide from a raw Star Citizen YouTube tutorial transcript.

HARD RULES (never break these):
- Only include a fact, step, ship name, prerequisite, or number if the transcript ACTUALLY says or clearly demonstrates it. Never fill a gap with outside Star Citizen knowledge, never guess a plausible-sounding detail.
- If something isn't determinable from the transcript, use null (or [] for lists) — never invent a value to make the output look more complete.
- "steps" must be the actual sequence of actions the creator describes, in order, each one concise and actionable — not a summary of the video's narration/opinions.
- Ignore sponsor reads, unrelated tangents, and channel outro/subscribe requests.

Return ONLY valid JSON matching exactly this shape, nothing else:
{
  "title": string|null,
  "summary": string|null,
  "topic": string|null,
  "difficulty": "beginner"|"intermediate"|"advanced"|null,
  "prerequisites": string[],
  "estimated_minutes": number|null,
  "ships_or_equipment": string[],
  "steps": [{"order": number, "instruction": string, "tip": string|null}],
  "game_version_mentioned": string|null
}`;

async function extractGuide(transcript: string, videoTitle: string): Promise<ExtractedGuide> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      format: 'json',
      stream: false,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: `Video title (for context only, may be clickbait — trust the transcript over this): ${videoTitle}\n\nTranscript:\n${transcript}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status} — is Ollama running at ${OLLAMA_BASE} with model ${EXTRACTION_MODEL} pulled?`);
  const body: any = await res.json();
  const raw = body?.message?.content;
  if (!raw) throw new Error('Ollama returned no content — check the model supports JSON mode.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Model did not return valid JSON. Raw output:\n${raw}`);
  }
}

interface GuidePayload {
  url: string;
  videoTitle: string;
  transcriptTruncated: boolean;
  extracted: ExtractedGuide;
}

function buildUpsertInput(payload: GuidePayload) {
  const { url, videoTitle, transcriptTruncated, extracted } = payload;
  const title = extracted.title || videoTitle;
  const topic = extracted.topic || null;
  const difficulty = extracted.difficulty || null;
  // Don't prefix with topic if the title already reads like it starts with
  // it (e.g. topic "mining" + title "Mining 101: ...") — avoids a redundant,
  // duplicated-word id; topic is still stored in attributes regardless.
  const titleSlug = slugify(title);
  const topicSlug = topic ? slugify(topic) : null;
  const entityId = `guide_${topicSlug && !titleSlug.startsWith(topicSlug) ? `${topicSlug}_${titleSlug}` : titleSlug}`.slice(0, 80);

  const stepsMarkdown = extracted.steps.length
    ? extracted.steps.map((s) => `${s.order}. ${s.instruction}${s.tip ? `\n   *Tip: ${s.tip}*` : ''}`).join('\n')
    : "*No clear step sequence could be extracted from this video's transcript.*";

  const body = [
    extracted.summary ? extracted.summary : null,
    '',
    '## Steps',
    stepsMarkdown,
    extracted.prerequisites.length ? `\n## Prerequisites\n${extracted.prerequisites.map((p) => `- ${p}`).join('\n')}` : null,
  ].filter((s) => s !== null).join('\n');

  return {
    id: entityId,
    type: 'item' as const,
    name: title,
    summary: extracted.summary,
    body,
    attributes: {
      category: 'guide',
      topic,
      difficulty,
      prerequisites: extracted.prerequisites,
      estimated_minutes: extracted.estimated_minutes,
      ships_or_equipment: extracted.ships_or_equipment,
      steps: extracted.steps,
      transcript_truncated: transcriptTruncated,
      extraction_model: EXTRACTION_MODEL,
      video_title: videoTitle,
    },
    source: {
      origin: 'youtube',
      url,
      confidence: 'community' as const, // never higher — single creator video + automated extraction
      last_verified: nowIso(),
    },
    game_version: extracted.game_version_mentioned,
  };
}

function parseArgs(argv: string[]) {
  const out: { url?: string; topic?: string; difficulty?: string; storeFromStdin?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topic') out.topic = argv[++i];
    else if (a === '--difficulty') out.difficulty = argv[++i];
    else if (a === '--store-from-stdin') out.storeFromStdin = true;
    else if (!a.startsWith('--') && !out.url) out.url = a;
  }
  return out;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function runExtract(url: string, topicOverride?: string, difficultyOverride?: string) {
  line('=== import-youtube-guide (extract phase) ===');
  line(`[fetch] video metadata for ${url}`);
  const meta = await fetchVideoMeta(url);
  line(`  title: ${meta.title}`);

  line('[fetch] transcript');
  const { text: transcript, truncated } = await fetchTranscriptText(url);
  line(`  ${transcript.length} chars${truncated ? ' (truncated — video longer than extraction limit)' : ''}`);

  line(`[extract] running ${EXTRACTION_MODEL} locally via Ollama...`);
  const extracted = await extractGuide(transcript, meta.title);
  if (topicOverride) extracted.topic = topicOverride;
  if (difficultyOverride) extracted.difficulty = difficultyOverride as ExtractedGuide['difficulty'];

  const payload: GuidePayload = { url, videoTitle: meta.title, transcriptTruncated: truncated, extracted };
  line('[done] extraction complete — piping JSON payload to stdout');
  process.stdout.write(JSON.stringify(payload));
}

async function runStore() {
  line('=== import-youtube-guide (store phase) ===');
  line('[read] payload from stdin');
  const raw = await readStdin();
  const payload: GuidePayload = JSON.parse(raw);

  const input = buildUpsertInput(payload);
  await upsertEntity(input);

  line(`[done] stored as ${input.id}`);
  line('--- Extracted guide (spot-check before trusting this publicly) ---');
  line(JSON.stringify(payload.extracted, null, 2));
}

async function main() {
  const { url, topic, difficulty, storeFromStdin } = parseArgs(process.argv.slice(2));

  if (storeFromStdin) return runStore();

  if (!url) {
    console.error(
      'Usage:\n' +
      '  tsx src/import-youtube-guide.ts <youtube-url> [--topic mining] [--difficulty beginner] \\\n' +
      '    | docker compose exec -T admin npx tsx src/import-youtube-guide.ts --store-from-stdin',
    );
    process.exit(1);
  }
  return runExtract(url, topic, difficulty);
}

main().catch((e) => { console.error(e); process.exit(1); });
