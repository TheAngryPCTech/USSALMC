// Entity type definitions shared across the API service.

export type EntityType =
  | 'item' | 'npc' | 'location' | 'mechanic' | 'quest'
  | 'lore' | 'patch_note' | 'commodity' | 'trade_route';

export type Confidence = 'confirmed' | 'community' | 'speculative';
export type Status = 'current' | 'deprecated' | 'removed';
export type FreshnessClass = 'static' | 'volatile';

export interface EntityImage {
  url: string;
  caption: string | null;
  role: 'primary' | 'gallery';
  added_by: 'scraper' | 'admin';
  source_url: string | null;
  license_note: string | null;
}

export interface EntityRelation {
  type: string;        // e.g. 'manufactured_by', 'located_in', 'uses'
  target_id: string;   // another entity id
}

export interface EntitySource {
  origin: string | null;
  url: string | null;
  confidence: Confidence | null;
  last_verified: string | null; // ISO date
}

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  summary: string | null;
  body: string | null;
  attributes: Record<string, unknown>;
  relations: EntityRelation[];
  images: EntityImage[];
  source: EntitySource;
  game_version: string | null;
  status: Status;
  freshness_class: FreshnessClass;
  ai_context: string | null;
  embedding_id: string | null;
  // True once any admin content edit has ever touched this entity (set only
  // by entities-admin.ts's republish(); the normal scraper publish path never
  // sets or clears it). Read-only signal for the force-overwrite connector
  // import to decide whether an overwrite is clobbering a manual edit.
  edited_by_admin?: boolean;
  created_at?: string;
  updated_at?: string;
}
