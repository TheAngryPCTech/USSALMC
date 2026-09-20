<?php
/**
 * USSALMC Portal — live commodity price ticker (split-flap style, 3 scrolling rows).
 *
 * [ussalmc_ticker] polls UEX Corp's public API (https://uexcorp.space —
 * unofficial fan project, unaffiliated with CIG/RSI, same category of
 * community service as StarCitizen-API; ToS checked before building this:
 * no restriction on automated access, redistribution, or caching) for real
 * per-terminal commodity sell prices, picks the top N by price, and renders
 * 3 full-width rows that continuously auto-scroll (alternating direction per
 * row) — a generic, well-known ticker-tape pattern (stock tickers, sports
 * scores, news crawls have used this for decades, UEX's own homepage
 * included), not anything specific to UEX's own site design or content.
 * This is an original CSS/JS implementation to our own theme's tokens.
 *
 * Server-side polling only: the UEX key never reaches the browser. Data is
 * cached in a transient (UEX_TICKER_CACHE_TTL, default 300s) so the actual
 * upstream API call happens at most once per TTL window regardless of
 * traffic. The browser polls a small admin-ajax endpoint on the SAME cache,
 * so a page full of visitors never multiplies real UEX API calls.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'USSALMC_TICKER_ROWS', 2 );
// A generous ceiling, not a target — ussalmc_portal_uex_top_commodities()
// only ever returns as many REAL, distinct, price-filtered commodities as
// actually exist (86 as of this writing). Every row gets this FULL real set
// (rotated to a different starting point per row), not an artificial subset —
// "pull all the real commodity trade data" per the user's explicit ask.
define( 'USSALMC_TICKER_MAX_ITEMS', 200 );

function ussalmc_portal_uex_api_key(): string {
	$key = get_option( 'ussalmc_uex_api_key' );
	if ( ! $key ) {
		$key = getenv( 'UEX_API_KEY' ) ?: '';
	}
	return (string) $key;
}

/**
 * Most-recently-updated $limit commodities (by real terminal price data,
 * newest date_modified first) — [{ code, name, price, terminal }, ...] — or
 * WP_Error. Cached 5 minutes.
 */
function ussalmc_portal_uex_top_commodities( int $limit = 72 ) {
	$cache_key = 'ussalmc_uex_ticker_v3';
	$hit       = get_transient( $cache_key );
	if ( is_array( $hit ) ) {
		return array_slice( $hit, 0, $limit );
	}
	$key = ussalmc_portal_uex_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_uex_key', 'UEX ticker is not configured (missing UEX API key).' );
	}
	$res = wp_remote_get(
		'https://uexcorp.space/api/2.0/commodities_prices_all',
		array( 'timeout' => 12, 'headers' => array( 'Authorization' => 'Bearer ' . $key, 'Accept' => 'application/json' ) )
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( $code !== 200 || ! is_array( $body['data'] ?? null ) ) {
		return new WP_Error( 'ussalmc_uex_unreachable', 'UEX API returned HTTP ' . $code . '.' );
	}
	// Per commodity, keep whichever real terminal listing was most recently
	// updated (highest date_modified) — never a fabricated/zero price
	// standing in for "no data".
	$best = array();
	// Real bulk commodities (Aluminum, Agricium, ...) sell in the tens-to-
	// low-thousands aUEC/unit range; a handful of rare/event collectibles
	// (gift items, limited ores) sit 3-4 orders of magnitude higher and would
	// otherwise dominate the whole board. This ceiling is a heuristic, not a
	// real "is this a normal commodity" flag from the API — documented as
	// such since it could exclude a legitimately expensive real commodity.
	$price_ceiling = 50000;
	// UEX files these under "commodities" too (bulk-tradeable, sold by SCU),
	// but they read as weapon/combat gear to anyone glancing at the ticker,
	// not a raw material or good — user-reported ("weapons do not belong in
	// the commodities section... they should not be listed in the ticker").
	// Scoped to just this display widget: the KB entities themselves stay
	// correctly categorized 'commodity' (that classification is UEX's own,
	// not wrong), this only keeps them off the homepage market feed.
	$weapon_adjacent = '/^ship (ammunition|decoy countermeasures|noise countermeasures)/i';
	foreach ( $body['data'] as $row ) {
		$name     = $row['commodity_name'] ?? null;
		$price    = $row['price_sell'] ?? null;
		$modified = $row['date_modified'] ?? 0;
		if ( ! $name || ! $price || empty( $row['status_sell'] ) || $price > $price_ceiling ) {
			continue;
		}
		if ( preg_match( $weapon_adjacent, $name ) ) {
			continue;
		}
		if ( ! isset( $best[ $name ] ) || $modified > $best[ $name ]['modified'] ) {
			$best[ $name ] = array(
				'name'     => $name,
				'code'     => strtoupper( substr( preg_replace( '/[^A-Za-z]/', '', $name ), 0, 4 ) ),
				'price'    => (float) $price,
				'terminal' => $row['terminal_name'] ?? null,
				'modified' => (int) $modified,
			);
		}
	}
	$list = array_values( $best );
	// Most recently updated real price first — per the user's explicit ask
	// for "only the most recent trade data", not the highest price.
	usort( $list, function ( $a, $b ) { return $b['modified'] <=> $a['modified']; } );
	set_transient( $cache_key, $list, (int) ( getenv( 'UEX_TICKER_CACHE_TTL' ) ?: 300 ) );
	return array_slice( $list, 0, $limit );
}

function ussalmc_portal_normalize_commodity_name( string $s ): string {
	return strtolower( preg_replace( '/[^a-z0-9]+/i', '', $s ) );
}

/**
 * Normalized commodity name -> KB entity id, e.g. "gold" -> "commodity_gold".
 * Reuses the existing `ussalmc_portal_api_get()` core-API client (same
 * wiki/portal Bearer key the rest of this plugin already shares — see
 * inc/api.php) rather than hardcoding a slug scheme, so a ticker card only
 * ever links to a page that genuinely exists. Cached alongside the ticker's
 * own data (same TTL) since the commodity list changes about as often as
 * prices do; a card for a commodity with no KB match (not every real UEX
 * commodity has been scraped/enriched — see import-uex-commodities.ts)
 * simply renders non-clickable rather than linking to a 404.
 */
function ussalmc_portal_commodity_entity_map(): array {
	$cache_key = 'ussalmc_uex_ticker_entity_map_v1';
	$hit       = get_transient( $cache_key );
	if ( is_array( $hit ) ) {
		return $hit;
	}
	$ttl  = (int) ( getenv( 'UEX_TICKER_CACHE_TTL' ) ?: 300 );
	$body = ussalmc_portal_api_get( '/v1/entities?category=commodity&limit=200', $ttl );
	if ( is_wp_error( $body ) || ! is_array( $body['items'] ?? null ) ) {
		return array(); // core API unreachable — ticker still works, just non-clickable this cycle.
	}
	$map = array();
	foreach ( $body['items'] as $ent ) {
		if ( ! empty( $ent['id'] ) && ! empty( $ent['name'] ) ) {
			$map[ ussalmc_portal_normalize_commodity_name( $ent['name'] ) ] = $ent['id'];
		}
	}
	set_transient( $cache_key, $map, $ttl );
	return $map;
}

function ussalmc_portal_render_flip_card( array $it, array $entity_map = array() ): string {
	$entity_id = $entity_map[ ussalmc_portal_normalize_commodity_name( $it['name'] ) ] ?? null;
	$tag       = $entity_id ? 'a' : 'div';
	$open      = '<' . $tag . ' class="ussalmc-flip" data-name="' . esc_attr( $it['name'] ) . '"';
	$open     .= $entity_id ? ' href="' . esc_url( add_query_arg( 'entity', rawurlencode( $entity_id ), home_url( '/wiki/' ) ) ) . '"' : '';
	$open     .= '>';
	return $open
		. '<span class="ussalmc-flip__code">' . esc_html( $it['code'] ) . '</span>'
		. '<span class="ussalmc-flip__value" data-value="' . esc_attr( (int) $it['price'] ) . '">' . esc_html( number_format( $it['price'] ) ) . '</span>'
		. '</' . $tag . '>';
}

add_shortcode( 'ussalmc_ticker', function () {
	$rows_n = USSALMC_TICKER_ROWS;
	$items  = ussalmc_portal_uex_top_commodities( USSALMC_TICKER_MAX_ITEMS );
	if ( is_wp_error( $items ) ) {
		return '<div class="ussalmc-ticker ussalmc-ticker--error">Ticker unavailable: ' . esc_html( $items->get_error_message() ) . '</div>';
	}
	$n           = count( $items );
	$entity_map  = ussalmc_portal_commodity_entity_map();
	ob_start(); ?>
	<div class="ussalmc-ticker" data-widget="ussalmc-ticker" data-refresh-url="<?php echo esc_url( admin_url( 'admin-ajax.php?action=ussalmc_ticker_refresh' ) ); ?>">
		<?php for ( $i = 0; $i < $rows_n; $i++ ) :
			if ( $n === 0 ) { continue; }
			// EVERY row gets the FULL real distinct list — not an artificial
			// subset — rotated to a different starting point per row for
			// visual variety, so the 5 rows don't all show identical motion.
			$offset    = (int) round( $i * $n / $rows_n );
			$row_items = array_merge( array_slice( $items, $offset ), array_slice( $items, 0, $offset ) );
			$reverse   = ( $i % 2 === 1 ); // alternate scroll direction per row
			?>
			<div class="ussalmc-ticker-row<?php echo $reverse ? ' ussalmc-ticker-row--reverse' : ''; ?>">
				<div class="ussalmc-ticker-track">
					<?php
					// Rendered twice back-to-back so the -50% translateX loop point is
					// visually seamless (standard marquee technique) — same live data,
					// not a second data source. With the full real set (86 today) per
					// row, that loop point sits far past any realistic viewport width.
					foreach ( array( 1, 2 ) as $pass ) {
						foreach ( $row_items as $it ) {
							echo ussalmc_portal_render_flip_card( $it, $entity_map ); // phpcs:ignore -- already escaped in the helper
						}
					}
					?>
				</div>
			</div>
		<?php endfor; ?>
	</div>
	<?php
	return (string) ob_get_clean();
} );

/** AJAX refresh: same cached data, just as JSON for the JS poller to diff. */
function ussalmc_portal_ticker_refresh_ajax() {
	$items = ussalmc_portal_uex_top_commodities( USSALMC_TICKER_MAX_ITEMS );
	if ( is_wp_error( $items ) ) {
		wp_send_json_error( array( 'message' => $items->get_error_message() ), 503 );
	}
	wp_send_json_success( array_map( function ( $it ) {
		return array( 'name' => $it['name'], 'code' => $it['code'], 'price' => (int) $it['price'] );
	}, $items ) );
}
add_action( 'wp_ajax_ussalmc_ticker_refresh', 'ussalmc_portal_ticker_refresh_ajax' );
add_action( 'wp_ajax_nopriv_ussalmc_ticker_refresh', 'ussalmc_portal_ticker_refresh_ajax' );

/**
 * Poll every 45s; flip only the cards whose value actually changed. Each
 * commodity now appears up to 4 times in the DOM (2 passes x this row's
 * duplicate-for-looping copy) — update every matching instance, not just
 * the first, so the flip is consistent across the whole scrolling track.
 */
add_action( 'wp_footer', function () {
	if ( ! is_page() && ! is_singular() ) {
		return;
	}
	?>
	<script>
	(function(){
		document.querySelectorAll('[data-widget="ussalmc-ticker"]').forEach(function(ticker){
			var url = ticker.getAttribute('data-refresh-url');
			if (!url) return;
			setInterval(function(){
				fetch(url).then(function(r){ return r.json(); }).then(function(res){
					if (!res || !res.success || !Array.isArray(res.data)) return;
					res.data.forEach(function(item){
						var cards = ticker.querySelectorAll('.ussalmc-flip[data-name="' + CSS.escape(item.name) + '"]');
						cards.forEach(function(card){
							var valueEl = card.querySelector('.ussalmc-flip__value');
							var newVal = String(item.price);
							if (valueEl.getAttribute('data-value') === newVal) return;
							valueEl.setAttribute('data-value', newVal);
							card.classList.add('is-flipping');
							setTimeout(function(){
								valueEl.textContent = item.price.toLocaleString();
								card.classList.remove('is-flipping');
							}, 220);
						});
					});
				}).catch(function(){ /* transient network hiccup — try again next tick */ });
			}, 45000);
		});
	})();
	</script>
	<?php
} );
