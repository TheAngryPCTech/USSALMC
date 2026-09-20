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

/**
 * "Sig Ident" (Phase 23) — identify which ore a mining scan signature
 * belongs to: GET /v1/mining/signature. Accepts the same query styles the
 * underlying endpoint (and scmdb.net's own tool) does: an exact number, a
 * "~number" for ±10% tolerance, or a "min-max" range.
 */
function ussalmc_wiki_identify_signature( string $q ) {
	return ussalmc_wiki_api_get( '/v1/mining/signature?q=' . rawurlencode( $q ) );
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
			// is_string() guard: an entity's images[].url is SUPPOSED to always
			// be a string (docs/schema.md), but a bad import can violate that
			// (real incident: the StarCitizen-API roadmap importer once stored
			// a raw nested media object here instead of extracting a URL
			// string — esc_url() on a non-string fatals in PHP 8, which took
			// down the ENTIRE category listing for every visitor, not just
			// that one card). Treat a malformed url as absent — falls back to
			// the letter-avatar placeholder — rather than ever crashing the page.
			foreach ( $images as $img ) {
				if ( ( $img['role'] ?? '' ) === 'primary' && is_string( $img['url'] ?? null ) && $img['url'] !== '' ) {
					$thumb = $img['url'];
					break;
				}
			}
			if ( ! $thumb && is_string( $images[0]['url'] ?? null ) && $images[0]['url'] !== '' ) {
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
 * Trade routes, grouped for browsing rather than shown as a generic card
 * grid (a flat grid of "Commodity: Origin -> Destination" cards doesn't
 * answer the actual question a player has: "what can I do FROM HERE?").
 * Per the user's ask: two top-level views — PICKING UP (grouped by where
 * you'd go to BUY, i.e. each route's origin) and DROPPING OFF (grouped by
 * where you'd go to SELL, i.e. each route's destination) — each nested
 * System -> Planet -> Terminal, with routes at the terminal level sorted by
 * commodity name. Every real route appears in BOTH trees (once by its
 * origin, once by its destination) since both are genuinely useful
 * questions about the same route.
 *
 * Returns `[ 'picking_up' => $tree, 'dropping_off' => $tree, 'total' => n ]`
 * or a WP_Error. $tree shape:
 *   [ system => [ planet => [ terminal => [ route_item, ... ] ] ] ]
 * (planet/terminal fall back to a "(unspecified)" bucket — never silently
 * dropped — when UEX didn't report one for that side of the route.)
 */
function ussalmc_wiki_trade_routes_grouped() {
	$items = ussalmc_wiki_fetch_all_in_category( 'trade_route' );
	if ( is_wp_error( $items ) ) {
		return $items;
	}

	$build_tree = static function ( array $items, string $side ) {
		$tree = array();
		foreach ( $items as $it ) {
			$a        = $it['attributes'] ?? array();
			$system   = trim( (string) ( $a[ $side . '_star_system' ] ?? '' ) ) ?: '(unspecified)';
			$planet   = trim( (string) ( $a[ $side . '_planet' ] ?? '' ) ) ?: '(unspecified)';
			$terminal = trim( (string) ( $a[ $side . '_terminal' ] ?? '' ) ) ?: '(unspecified)';
			$tree[ $system ][ $planet ][ $terminal ][] = $it;
		}
		// Sort: system/planet/terminal alphabetically, routes within a
		// terminal by commodity name — per the user's explicit ask.
		ksort( $tree, SORT_STRING | SORT_FLAG_CASE );
		foreach ( $tree as &$planets ) {
			ksort( $planets, SORT_STRING | SORT_FLAG_CASE );
			foreach ( $planets as &$terminals ) {
				ksort( $terminals, SORT_STRING | SORT_FLAG_CASE );
				foreach ( $terminals as &$routes ) {
					usort( $routes, static function ( $x, $y ) {
						return strcasecmp( $x['attributes']['commodity_name'] ?? '', $y['attributes']['commodity_name'] ?? '' );
					} );
				}
			}
		}
		unset( $planets, $terminals, $routes );
		return $tree;
	};

	return array(
		'picking_up'   => $build_tree( $items, 'origin' ),
		'dropping_off' => $build_tree( $items, 'destination' ),
		'total'        => count( $items ),
	);
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

/**
 * "Updated Xm/Xh/Xd ago" from a raw ISO 8601 timestamp attribute value (e.g.
 * commodity entities' uex_last_updated). Trade data is volatile per the
 * cross-phase rule — always shown with its age, never as a flat fact.
 */
function ussalmc_wiki_time_ago_from_iso( ?string $iso ): string {
	$ts = $iso ? strtotime( $iso ) : false;
	if ( ! $ts ) {
		return 'No confirmed data yet';
	}
	$age = (int) round( ( time() - $ts ) / 60 );
	if ( $age < 1 ) {
		return 'Updated just now';
	}
	if ( $age < 60 ) {
		return 'Updated ' . $age . 'm ago';
	}
	if ( $age < 1440 ) {
		return 'Updated ' . round( $age / 60 ) . 'h ago';
	}
	return 'Updated ' . round( $age / 1440 ) . 'd ago';
}

/**
 * Render an entity's `body` (plain prose, e.g. a quest's mission narrative)
 * as safe paragraph HTML — blank-line-separated paragraphs, single
 * newlines within a paragraph become <br>. Escapes all text content; the
 * only HTML this ever emits is the <p>/<br> wrapper tags it creates itself.
 * Added Phase 24: `body` previously had no renderer in entity.php at all —
 * fine while every entity's real content lived in `summary`/discrete
 * `attributes`, but quest entities' actual value (the mission's narrative
 * description) lives entirely in `body`, so it was silently never shown.
 */
function ussalmc_wiki_render_body_html( string $body ): string {
	$body = trim( $body );
	if ( $body === '' ) {
		return '';
	}
	$paragraphs = preg_split( '/\n{2,}/', $body );
	$html       = '';
	foreach ( $paragraphs as $p ) {
		$p = trim( $p );
		if ( $p === '' ) {
			continue;
		}
		$html .= '<p>' . nl2br( esc_html( $p ) ) . '</p>';
	}
	return $html;
}

/**
 * Pull the uex_* trade-data attributes out into a structured shape for the
 * entity page's dedicated "LIVE TRADE DATA" panel — [] if none present (a
 * commodity with no UEX match, or a non-commodity entity).
 */
function ussalmc_wiki_uex_trade_data( array $attributes ): array {
	if ( ! isset( $attributes['uex_best_sell_price'] ) && ! isset( $attributes['uex_best_buy_price'] ) ) {
		return array();
	}
	return array(
		'sell_price'          => $attributes['uex_best_sell_price'] ?? null,
		'sell_terminal'       => $attributes['uex_best_sell_terminal'] ?? null,
		'buy_price'           => $attributes['uex_best_buy_price'] ?? null,
		'buy_terminal'        => $attributes['uex_best_buy_terminal'] ?? null,
		'terminal_count'      => $attributes['uex_terminal_count'] ?? null,
		'updated_label'       => ussalmc_wiki_time_ago_from_iso( $attributes['uex_last_updated'] ?? null ),
		'commodity_id'        => $attributes['uex_commodity_id'] ?? null,
		'sell_terminal_id'    => $attributes['uex_best_sell_terminal_id'] ?? null,
		'buy_terminal_id'     => $attributes['uex_best_buy_terminal_id'] ?? null,
	);
}

/**
 * Profit/margin/ROI for buying at the commodity's best-buy terminal and
 * selling at its best-sell terminal — the same "route" metric UEX Corp's own
 * commodity page reports (their own page confirmed live: sell 870,000, buy
 * 283,500 -> profit 586,500, margin 67.4%, ROI 206.9%; same formulas verified
 * against that real example). `null` for any figure that can't be computed
 * (missing sell or buy price, or buy price is 0) rather than a fabricated 0 —
 * per the never-guess-a-missing-field rule.
 *   margin % = profit / sell_price * 100  (profit as a share of the sale)
 *   ROI %    = profit / buy_price  * 100  (return relative to what you paid)
 */
function ussalmc_wiki_uex_profit_metrics( array $trade ): array {
	$sell = $trade['sell_price'] ?? null;
	$buy  = $trade['buy_price'] ?? null;
	if ( $sell === null || $buy === null || (float) $buy <= 0 ) {
		return array( 'profit' => null, 'margin' => null, 'roi' => null );
	}
	$profit = (float) $sell - (float) $buy;
	return array(
		'profit' => $profit,
		'margin' => $sell > 0 ? ( $profit / (float) $sell ) * 100 : null,
		'roi'    => ( $profit / (float) $buy ) * 100,
	);
}

/** Resolve the UEX Corp Bearer key. Shares the wp_options row the portal plugin's
 * ticker writes to (same WordPress install, one options table) — falls back to
 * the UEX_API_KEY env var. Server-side only, never sent to the browser. */
function ussalmc_wiki_uex_api_key(): string {
	$key = get_option( 'ussalmc_uex_api_key' );
	if ( ! $key ) {
		$key = getenv( 'UEX_API_KEY' ) ?: '';
	}
	return (string) $key;
}

/**
 * Live price-history + trade-location series for one commodity at one terminal,
 * straight from UEX Corp's `commodities_prices_history` endpoint (real per-terminal
 * price snapshots over time, each carrying its full location hierarchy). Cached in
 * a transient for 10 minutes so a busy entity page doesn't hammer UEX's rate limit
 * (120/min, 172,800/day) — short enough that the volatile-trade-data rule (never
 * show a flat undated fact) still holds, since every entry keeps its own date.
 *
 * Returns a list of up to $limit entries, oldest first (so a chart reads
 * left-to-right chronologically), each:
 *   [ 'date' => unix ts, 'price_sell' => int, 'price_buy' => int,
 *     'star_system' => string, 'planet' => string|null, 'city' => string|null,
 *     'terminal' => string ]
 * or [] on any failure / missing ids (never fatal — the panel just omits the chart).
 */
function ussalmc_wiki_uex_price_history( ?int $id_commodity, ?int $id_terminal, int $limit = 20 ): array {
	if ( ! $id_commodity || ! $id_terminal ) {
		return array();
	}
	$key = ussalmc_wiki_uex_api_key();
	if ( $key === '' ) {
		return array();
	}
	$cache_key = 'ussalmc_uex_hist_' . $id_commodity . '_' . $id_terminal;
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$url = sprintf(
		'https://uexcorp.space/api/2.0/commodities_prices_history?id_commodity=%d&id_terminal=%d',
		$id_commodity,
		$id_terminal
	);
	$res = wp_remote_get(
		$url,
		array(
			'timeout' => 8,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
			),
		)
	);
	if ( is_wp_error( $res ) || wp_remote_retrieve_response_code( $res ) !== 200 ) {
		return array();
	}
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $body ) || ( $body['status'] ?? '' ) !== 'ok' || ! is_array( $body['data'] ?? null ) ) {
		return array();
	}
	$rows = $body['data'];
	// UEX returns this endpoint OLDEST-first (ascending date_added/id) — confirmed
	// live, not documented. Keep the most recent $limit by slicing off the END,
	// which leaves the result already in oldest->newest chronological order (correct
	// for the chart reading left-to-right); callers wanting newest-first (the
	// trade-locations table) reverse this themselves.
	$rows = array_slice( $rows, -$limit );

	$out = array();
	foreach ( $rows as $r ) {
		if ( ! is_array( $r ) ) { continue; }
		$out[] = array(
			'date'        => (int) ( $r['date_added'] ?? 0 ),
			'price_sell'  => (int) ( $r['price_sell'] ?? 0 ),
			'price_buy'   => (int) ( $r['price_buy'] ?? 0 ),
			'star_system' => $r['star_system_name'] ?? null,
			'planet'      => $r['planet_name'] ?? null,
			'city'        => $r['city_name'] ?? ( $r['space_station_name'] ?? ( $r['outpost_name'] ?? null ) ),
			'terminal'    => $r['terminal_name'] ?? null,
		);
	}
	set_transient( $cache_key, $out, 10 * MINUTE_IN_SECONDS );
	return $out;
}

/**
 * Render a real price-history series (from ussalmc_wiki_uex_price_history()) as
 * an inline SVG sparkline — no chart library, no external request, works under
 * the artifact/CSP-style constraint of "only inline markup". Plots $field
 * ('price_sell' or 'price_buy') across the series; returns '' if there isn't
 * enough data for a line (need >=2 points) so callers can skip the chart
 * entirely rather than show an empty box.
 */
function ussalmc_wiki_render_uex_sparkline_svg( array $history, string $field = 'price_sell', int $width = 420, int $height = 64 ): string {
	$points = array_values( array_filter( $history, static fn( $h ) => ( $h[ $field ] ?? 0 ) > 0 ) );
	if ( count( $points ) < 2 ) {
		return '';
	}
	$prices = array_map( static fn( $h ) => (float) $h[ $field ], $points );
	$min    = min( $prices );
	$max    = max( $prices );
	$range  = ( $max - $min ) > 0 ? ( $max - $min ) : 1.0;
	$pad    = 6;
	$n      = count( $points );
	$coords = array();
	foreach ( $prices as $i => $p ) {
		$x        = $pad + ( $n > 1 ? ( $i / ( $n - 1 ) ) * ( $width - 2 * $pad ) : 0 );
		$y        = $pad + ( 1 - ( ( $p - $min ) / $range ) ) * ( $height - 2 * $pad );
		$coords[] = round( $x, 1 ) . ',' . round( $y, 1 );
	}
	$poly_pts    = implode( ' ', $coords );
	$last        = end( $coords );
	$line_color  = $field === 'price_buy' ? 'var(--amber, #e8a33d)' : 'var(--signal, #4af)';
	$aria_label  = $field === 'price_buy' ? 'Buy price trend, oldest to newest' : 'Sell price trend, oldest to newest';
	list( $lx, $ly ) = explode( ',', $last );

	ob_start();
	?>
	<svg class="ussalmc-sparkline" viewBox="0 0 <?php echo esc_attr( $width ); ?> <?php echo esc_attr( $height ); ?>" width="100%" height="<?php echo esc_attr( $height ); ?>" preserveAspectRatio="none" role="img" aria-label="<?php echo esc_attr( $aria_label ); ?>">
		<polyline points="<?php echo esc_attr( $poly_pts ); ?>" fill="none" stroke="<?php echo esc_attr( $line_color ); ?>" stroke-width="1.5" vector-effect="non-scaling-stroke" />
		<circle cx="<?php echo esc_attr( $lx ); ?>" cy="<?php echo esc_attr( $ly ); ?>" r="2.5" fill="<?php echo esc_attr( $line_color ); ?>" />
	</svg>
	<?php
	return (string) ob_get_clean();
}

/**
 * Inline "no visual data" glyph — a broken-image icon in the theme's own
 * line-art style (matches the corner-bracket/dial iconography used
 * elsewhere: stroked paths, no fill, currentColor), for the entity-hero
 * placeholder shown when an entity has zero real images. Pure SVG, no
 * image asset — consistent with every other piece of chrome in this theme
 * (dial gauge, ticker split-flaps, rail icons are all inline SVG/CSS too).
 */
function ussalmc_wiki_render_novisual_icon(): string {
	// width/height="100%" so it fills its wrapper correctly even without the
	// theme stylesheet's .ussalmc-novisual__icon size rule loaded (the plugin's
	// own default template has no CSS dependency on style.css).
	return '<svg class="ussalmc-novisual__icon" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">'
		. '<rect x="3" y="5" width="18" height="14" rx="1"/>'
		. '<circle cx="9" cy="11" r="2"/>'
		. '<path d="M21 15l-5-4-4 3-3-2-6 5"/>'
		. '<path d="M3 3l18 18"/>'
		. '</svg>';
}

/**
 * ALL real terminals currently trading a commodity — not just the "best"
 * one already surfaced in LIVE TRADE DATA — straight from UEX's
 * `commodities_prices_all` (the same bulk feed the portal ticker and the
 * enrichment importer use; this endpoint doesn't support server-side
 * filtering by commodity, so the full ~2,600-row dataset is fetched once and
 * filtered here). Cached 5 minutes in a SHARED transient (one cache entry
 * serves every commodity page hit in that window, not one per commodity) to
 * stay well inside UEX's rate limit while still being short enough that the
 * volatile-trade-data rule holds (paired with each row's own freshness age).
 *
 * Returns up to $limit rows, best real sell price first:
 *   [ 'terminal' => string, 'sell_price' => int|null, 'buy_price' => int|null,
 *     'stock' => int|null, 'updated_label' => string ]
 * ('null' price means that terminal isn't actively trading that side right
 * now — status_sell/status_buy = 0 — never a fabricated 0 price.)
 */
function ussalmc_wiki_uex_all_commodity_terminals( ?int $id_commodity, int $limit = 60 ): array {
	if ( ! $id_commodity ) {
		return array();
	}
	$key = ussalmc_wiki_uex_api_key();
	if ( $key === '' ) {
		return array();
	}
	$cache_key = 'ussalmc_uex_prices_all_raw';
	$rows      = get_transient( $cache_key );
	if ( ! is_array( $rows ) ) {
		$res = wp_remote_get(
			'https://uexcorp.space/api/2.0/commodities_prices_all',
			array(
				'timeout' => 12,
				'headers' => array( 'Authorization' => 'Bearer ' . $key, 'Accept' => 'application/json' ),
			)
		);
		if ( is_wp_error( $res ) || wp_remote_retrieve_response_code( $res ) !== 200 ) {
			return array();
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( ! is_array( $body['data'] ?? null ) ) {
			return array();
		}
		$rows = $body['data'];
		set_transient( $cache_key, $rows, 5 * MINUTE_IN_SECONDS );
	}

	$out = array();
	foreach ( $rows as $r ) {
		if ( ! is_array( $r ) || (int) ( $r['id_commodity'] ?? 0 ) !== $id_commodity ) {
			continue;
		}
		$out[] = array(
			'terminal'      => $r['terminal_name'] ?? '—',
			'sell_price'    => ! empty( $r['status_sell'] ) ? (int) ( $r['price_sell'] ?? 0 ) : null,
			'buy_price'     => ! empty( $r['status_buy'] ) ? (int) ( $r['price_buy'] ?? 0 ) : null,
			'stock'         => isset( $r['scu_sell_stock'] ) ? (int) $r['scu_sell_stock'] : null,
			'updated_label' => ussalmc_wiki_time_ago_from_iso( ! empty( $r['date_modified'] ) ? gmdate( 'c', (int) $r['date_modified'] ) : null ),
		);
	}
	usort(
		$out,
		static function ( $a, $b ) {
			return ( $b['sell_price'] ?? -1 ) <=> ( $a['sell_price'] ?? -1 );
		}
	);
	return array_slice( $out, 0, $limit );
}
