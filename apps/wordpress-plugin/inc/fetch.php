<?php
/**
 * USSALMC Wiki — core API fetch helpers (list, search, relations, categories).
 * All read the core REST API as the wiki client with the server-side Bearer key.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Low-level GET against the core API. Returns decoded array or WP_Error. */
function ussalmc_wiki_api_get( string $path ) {
	$key = ussalmc_wiki_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_key', 'USSALMC Wiki is not configured with an API key.' );
	}
	$res = wp_remote_get(
		ussalmc_wiki_api_base() . $path,
		array(
			'timeout' => 8,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
			),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( $code !== 200 || ! is_array( $body ) ) {
		$msg = is_array( $body ) && isset( $body['error']['message'] )
			? $body['error']['message']
			: ( 'core API returned HTTP ' . $code );
		return new WP_Error( 'ussalmc_api_error', $msg );
	}
	return $body;
}

/**
 * Low-level POST against the core API (server-side key never reaches the
 * browser). Used for field confirm/flag signals. Returns [ decoded body,
 * http status code ] or a WP_Error if the request itself failed.
 */
function ussalmc_wiki_api_post( string $path, array $body ) {
	$key = ussalmc_wiki_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_key', 'USSALMC Wiki is not configured with an API key.' );
	}
	$res = wp_remote_post(
		ussalmc_wiki_api_base() . $path,
		array(
			'timeout' => 8,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
				'Content-Type'  => 'application/json',
			),
			'body'    => wp_json_encode( $body ),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$decoded = json_decode( wp_remote_retrieve_body( $res ), true );
	return array( is_array( $decoded ) ? $decoded : array(), $code );
}

/** Hybrid keyword+semantic search: GET /v1/search?q= */
function ussalmc_wiki_search( string $q, int $limit = 10 ) {
	return ussalmc_wiki_api_get( '/v1/search?q=' . rawurlencode( $q ) . '&limit=' . $limit );
}

/** Entity list (optionally filtered by substring query): GET /v1/entities */
function ussalmc_wiki_list_entities( array $args = array() ) {
	$qs = http_build_query( array_filter( array(
		'type'   => $args['type'] ?? 'item',
		'query'  => $args['query'] ?? '',
		'sort'   => $args['sort'] ?? '', // 'recent' -> updated_at desc; omitted keeps the default alphabetical order
		'limit'  => $args['limit'] ?? 200,
		'offset' => $args['offset'] ?? 0,
	) ) );
	return ussalmc_wiki_api_get( '/v1/entities?' . $qs );
}

/** Resolved relations for cross-reference links: GET /v1/entities/:id/relations */
function ussalmc_wiki_entity_relations( string $id ) {
	return ussalmc_wiki_api_get( '/v1/entities/' . rawurlencode( $id ) . '/relations' );
}

/**
 * ALL entities in one category, via GET /v1/entities?category=<slug>&offset=,
 * paging past the API's own per-request cap (200 — see listEntities) so a
 * category with more than 200 entities (manufacturer: 246) still returns its
 * full list instead of silently stopping at page 1. Bounded to
 * USSALMC_CATEGORY_LISTING_MAX_PAGES pages as a sanity cap, not a UX limit.
 */
function ussalmc_wiki_fetch_all_in_category( string $slug, int $page_size = 200 ) {
	$items = array();
	$offset = 0;
	$max_pages = 25; // 25 * 200 = 5,000 entities — comfortably above any real category today.
	for ( $page = 0; $page < $max_pages; $page++ ) {
		$res = ussalmc_wiki_api_get( '/v1/entities?category=' . rawurlencode( $slug ) . '&limit=' . $page_size . '&offset=' . $offset );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$batch = $res['items'] ?? array();
		foreach ( $batch as $e ) {
			$images = is_array( $e['images'] ?? null ) ? $e['images'] : array();
			$thumb  = null;
			foreach ( $images as $img ) {
				if ( ( $img['role'] ?? '' ) === 'primary' && ! empty( $img['url'] ) ) {
					$thumb = $img['url'];
					break;
				}
			}
			if ( ! $thumb && ! empty( $images[0]['url'] ) ) {
				$thumb = $images[0]['url'];
			}
			$items[] = array(
				'id'         => $e['id'] ?? '',
				'name'       => $e['name'] ?? ( $e['id'] ?? '' ),
				'category'   => $slug,
				'attributes' => is_array( $e['attributes'] ?? null ) ? $e['attributes'] : array(),
				'thumb'      => $thumb,
			);
		}
		$total  = (int) ( $res['total'] ?? count( $items ) );
		$offset += count( $batch );
		if ( empty( $batch ) || $offset >= $total ) {
			break;
		}
	}
	return $items;
}

/**
 * Entities in ONE category (plus any of its subcategories, so they stay
 * nested in the same listing rather than needing their own view), for the
 * [ussalmc_categories] `?category=` filtered listing. Fetches by
 * GET /v1/entities?category=<slug> — the taxonomy leaf filter, which matches
 * attributes.category when set, else base type. This replaces the old
 * approach of fetching only type=item entities and grouping client-side,
 * which silently returned nothing for any category whose entities live under
 * a different base type (commodity, location, quest, npc, ...).
 * Returns [ category_slug => [entities] ] (kept as a dict, same shape the
 * category.php template already expects) or a WP_Error.
 */
function ussalmc_wiki_categories( string $active ) {
	$slugs = array( $active );
	$index = ussalmc_wiki_category_index();
	if ( ! is_wp_error( $index ) ) {
		foreach ( $index as $c ) {
			if ( $c['slug'] === $active ) {
				foreach ( $c['subcategories'] ?? array() as $sub ) {
					$slugs[] = $sub['slug'];
				}
				break;
			}
		}
	}
	$items = array();
	foreach ( $slugs as $slug ) {
		$batch = ussalmc_wiki_fetch_all_in_category( $slug );
		if ( is_wp_error( $batch ) ) {
			return $batch;
		}
		array_push( $items, ...$batch );
	}
	return array( 'total' => count( $items ), 'categories' => array( $active => $items ) );
}

/**
 * Normalize an entity's confidence: the public payload carries it at
 * `source.confidence` (top-level is null). Returns a lowercase class-safe string.
 */
function ussalmc_wiki_confidence( array $entity ): string {
	$c = $entity['confidence'] ?? ( $entity['source']['confidence'] ?? '' );
	$c = strtolower( trim( (string) $c ) );
	return $c !== '' ? $c : 'unknown';
}

/**
 * Top-level category index (with nested subcategories + entry counts,
 * trade_route's own freshness): GET /v1/categories. Powers the
 * [ussalmc_categories] index card grid.
 */
function ussalmc_wiki_category_index() {
	$res = ussalmc_wiki_api_get( '/v1/categories' );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	return $res['categories'] ?? array();
}

/**
 * Human-readable freshness label for a trade_route category card's
 * `freshness` (`{last_verified, last_verified_age_minutes}` or null — no
 * confirmed trade routes yet). Trade data is always shown with its age,
 * never presented as a current fact without it, per the cross-phase rule.
 */
function ussalmc_wiki_freshness_label( $freshness ): string {
	$age = $freshness['last_verified_age_minutes'] ?? null;
	if ( $age === null ) {
		return 'No confirmed data yet';
	}
	$age = (int) $age;
	if ( $age < 60 ) {
		return 'Updated ' . $age . 'm ago';
	}
	if ( $age < 1440 ) {
		return 'Updated ' . round( $age / 60 ) . 'h ago';
	}
	return 'Updated ' . round( $age / 1440 ) . 'd ago';
}

/**
 * Which attribute keys are worth showing as inline stat chips on a category
 * listing row, per category — and how to label/format them. Only ever reads
 * real attribute values already on the entity; a category/key with no
 * mapping here just shows no chips (never a fabricated placeholder).
 */
function ussalmc_wiki_category_stat_chip_spec( string $category ): array {
	$specs = array(
		'ship'         => array(
			array( 'key' => 'cargo_capacity', 'label' => 'Cargo', 'unit' => ' SCU' ),
			array( 'key' => 'price_usd', 'label' => 'Price', 'prefix' => '$' ),
			array( 'key' => 'production_status', 'label' => 'Status' ),
		),
		'weapon'       => array(
			array( 'key' => 'damage', 'label' => 'Damage' ),
			array( 'key' => 'dps', 'label' => 'DPS' ),
			array( 'key' => 'fire_rate', 'label' => 'Fire rate' ),
		),
		'commodity'    => array(
			array( 'key' => 'type', 'label' => 'Type' ),
			array( 'key' => 'rarity', 'label' => 'Rarity' ),
		),
		'manufacturer' => array(
			array( 'key' => 'industry', 'label' => 'Industry' ),
			array( 'key' => 'headquarters', 'label' => 'HQ' ),
		),
		'location'     => array(
			array( 'key' => 'type', 'label' => 'Type' ),
			array( 'key' => 'affiliation', 'label' => 'Affiliation' ),
		),
		'star_system'  => array(
			array( 'key' => 'danger', 'label' => 'Danger' ),
			array( 'key' => 'economy', 'label' => 'Economy' ),
			array( 'key' => 'population', 'label' => 'Population' ),
		),
		'jump_point'   => array(
			array( 'key' => 'size', 'label' => 'Size' ),
			array( 'key' => 'entry_code', 'label' => 'From' ),
			array( 'key' => 'exit_code', 'label' => 'To' ),
		),
		'organization' => array(
			array( 'key' => 'archetype', 'label' => 'Type' ),
			array( 'key' => 'commitment', 'label' => 'Commitment' ),
		),
		'roadmap'      => array(
			array( 'key' => 'status', 'label' => 'Status' ),
			array( 'key' => 'release', 'label' => 'Release' ),
		),
	);
	return $specs[ $category ] ?? array();
}

/** Build the actual chip list for one entity's attributes — skips anything missing/empty. */
function ussalmc_wiki_category_stat_chips( string $category, array $attributes ): array {
	$chips = array();
	foreach ( ussalmc_wiki_category_stat_chip_spec( $category ) as $spec ) {
		$value = $attributes[ $spec['key'] ] ?? null;
		if ( $value === null || $value === '' ) {
			continue;
		}
		if ( is_bool( $value ) ) {
			$value = $value ? 'Yes' : 'No';
		}
		$formatted = ( $spec['prefix'] ?? '' ) . ( is_numeric( $value ) ? number_format( (float) $value, fmod( (float) $value, 1 ) === 0.0 ? 0 : 2 ) : (string) $value ) . ( $spec['unit'] ?? '' );
		$chips[] = array( 'label' => $spec['label'], 'value' => $formatted );
	}
	return $chips;
}
