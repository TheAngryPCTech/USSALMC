// embeddings.ts — produce a 384-dim vector for a piece of text.
// Primary: @xenova/transformers all-MiniLM-L6-v2 (local, offline after first download).
// Fallback: deterministic hashed bag-of-words projected to 384 dims, so the
// system keeps working with no network / no model weights. Provider is recorded.

import crypto from 'node:crypto';
import { config } from './config.js';

const DIM = config.embeddings.dim;

let extractor: any = null;
let triedLoad = false;
let providerName = 'hashed-fallback';

async function tryLoadModel(): Promise<void> {
  if (triedLoad) return;
  triedLoad = true;
  try {
    const mod: any = await import('@xenova/transformers');
    mod.env.allowLocalModels = true;
    extractor = await mod.pipeline('feature-extraction', config.embeddings.model);
    providerName = config.embeddings.model;
    // eslint-disable-next-line no-console
    console.log(`[embeddings] loaded model ${config.embeddings.model}`);
  } catch (err: any) {
    extractor = null;
    providerName = 'hashed-fallback';
    // eslint-disable-next-line no-console
    console.warn(`[embeddings] model unavailable, using hashed fallback: ${err?.message ?? err}`);
  }
}

function hashedEmbedding(text: string): number[] {
  const vec = new Float64Array(DIM);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    const h = crypto.createHash('md5').update(tok).digest();
    // use several byte-pairs from the hash to spread signal across dims
    for (let i = 0; i < 8; i++) {
      const idx = ((h[i * 2] << 8) | h[i * 2 + 1]) % DIM;
      const sign = (h[i] & 1) === 0 ? 1 : -1;
      vec[idx] += sign;
    }
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

export interface EmbeddingResult {
  vector: number[];
  provider: string;
}

export async function embed(text: string): Promise<EmbeddingResult> {
  await tryLoadModel();
  if (extractor) {
    try {
      const out = await extractor(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(out.data as Float32Array).map(Number);
      return { vector, provider: providerName };
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(`[embeddings] inference failed, falling back: ${err?.message ?? err}`);
    }
  }
  return { vector: hashedEmbedding(text), provider: 'hashed-fallback' };
}

// pgvector literal, e.g. '[0.1,0.2,...]'
export function toVectorLiteral(vector: number[]): string {
  return '[' + vector.map((v) => (Number.isFinite(v) ? v : 0)).join(',') + ']';
}
