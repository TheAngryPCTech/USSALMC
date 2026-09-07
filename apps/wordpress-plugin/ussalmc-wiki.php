<?php
/**
 * Plugin Name:       USSALMC Wiki
 * Plugin URI:        https://api.ussa.space
 * Description:       Star Citizen wiki consumer for the USSA Lore Master Core. Reads entities from the core REST API (versioned /v1) using a server-side Bearer key and renders entity cards, hybrid search, and category views via shortcodes. Output goes through a theme template-override system, so an active theme can restyle it with no plugin changes. Never exposes the API key to the browser.
 * Version:           0.3.0
 * Requires PHP:      8.0
 * Author:            USSALMC
 * License:           MIT
 * Text Domain:       ussalmc-wiki
 *
 * Configuration lives in wp_options (set at container startup via WP-CLI):
 *   ussalmc_api_base  e.g. http://api:3000   (in-network core API base)
 *   ussalmc_api_key   the wiki client's Bearer key (server-side only)
 * Falls back to the USSALMC_API_BASE / USSALMC_API_KEY environment variables.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

require_once plugin_dir_path( __FILE__ ) . 'inc/fetch.php';
require_once plugin_dir_path( __FILE__ ) . 'inc/template-loader.php';
require_once plugin_dir_path( __FILE__ ) . 'inc/corroboration.php';
require_once plugin_dir_path( __FILE__ ) . 'inc/sso.php';

/** Resolve the core API base (option first, then env, then in-network default). */
function ussalmc_wiki_api_base(): string {
	$base = get_option( 'ussalmc_api_base' );
	if ( ! $base ) {
		$base = getenv( 'USSALMC_API_BASE' ) ?: 'http://api:3000';
	}
	return rtrim( (string) $base, '/' );
}

/** Resolve the wiki Bearer key (option first, then env). Server-side only. */
function ussalmc_wiki_api_key(): string {
	$key = get_option( 'ussalmc_api_key' );
	if ( ! $key ) {
		$key = getenv( 'USSALMC_API_KEY' ) ?: '';
	}
	return (string) $key;
}

/** Is the plugin pointed at a core API with a key? Surfaced on the admin notice. */
function ussalmc_wiki_is_configured(): bool {
	return ussalmc_wiki_api_base() !== '' && ussalmc_wiki_api_key() !== '';
}

/**
 * Fetch a single entity from GET {base}/v1/entities/{id} as the wiki client.
 * Returns the decoded array, or a WP_Error on any failure.
 */
function ussalmc_wiki_fetch_entity( string $id ) {
	$key = ussalmc_wiki_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_key', 'USSALMC Wiki is not configured with an API key.' );
	}
	$url = ussalmc_wiki_api_base() . '/v1/entities/' . rawurlencode( $id );
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
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( $code !== 200 ) {
		$msg = is_array( $body ) && isset( $body['error']['message'] )
			? $body['error']['message']
			: ( 'core API returned HTTP ' . $code );
		return new WP_Error( 'ussalmc_api_error', $msg );
	}
	return is_array( $body ) ? $body : new WP_Error( 'ussalmc_bad_json', 'core API returned an unparseable body.' );
}

/**
 * [ussalmc_entity id="ship_carrack"] — render an entity card.
 * Confidence / source / game_version are always surfaced, per the project spec.
 * Rendered through the theme template-override system (templates/entity.php,
 * overridable at <theme>/ussalmc-wiki/entity.php).
 */
function ussalmc_wiki_entity_shortcode( $atts ): string {
	$atts = shortcode_atts( array( 'id' => '' ), $atts, 'ussalmc_entity' );
	$id   = sanitize_text_field( $atts['id'] );
	if ( $id === '' ) {
		return '<div class="ussalmc-entity ussalmc-error">Missing entity <code>id</code>.</div>';
	}
	$entity = ussalmc_wiki_fetch_entity( $id );
	if ( is_wp_error( $entity ) ) {
		return '<div class="ussalmc-entity ussalmc-error">USSALMC: ' . esc_html( $entity->get_error_message() ) . '</div>';
	}
	$relations = ussalmc_wiki_entity_relations( $id );
	return ussalmc_wiki_render_template(
		'entity',
		array(
			'entity'     => $entity,
			'relations'  => $relations,
			'confidence' => ussalmc_wiki_confidence( $entity ),
		)
	);
}
add_shortcode( 'ussalmc_entity', 'ussalmc_wiki_entity_shortcode' );

/**
 * [ussalmc_search] — hybrid keyword+semantic search box + results.
 * Reads ?q= from the query string. Rendered via templates/search.php.
 */
add_shortcode( 'ussalmc_search', function ( $atts ) {
	$atts    = shortcode_atts( array( 'limit' => 10 ), $atts, 'ussalmc_search' );
	$query   = isset( $_GET['q'] ) ? sanitize_text_field( wp_unslash( $_GET['q'] ) ) : '';
	$results = array();
	$error   = null;
	if ( $query !== '' ) {
		$res = ussalmc_wiki_search( $query, (int) $atts['limit'] );
		if ( is_wp_error( $res ) ) {
			$error = $res->get_error_message();
		} else {
			$results = $res['results'] ?? array();
		}
	}
	return ussalmc_wiki_render_template( 'search', compact( 'query', 'results', 'error' ) );
} );

/**
 * [ussalmc_categories] — category index of the knowledge base.
 * Honors ?category= to filter to one category. Rendered via templates/category.php.
 */
add_shortcode( 'ussalmc_categories', function () {
	$data   = ussalmc_wiki_categories();
	$active = isset( $_GET['category'] ) ? sanitize_text_field( wp_unslash( $_GET['category'] ) ) : null;
	if ( is_wp_error( $data ) ) {
		return ussalmc_wiki_render_template( 'category', array( 'categories' => array(), 'total' => 0, 'error' => $data->get_error_message(), 'active' => $active ) );
	}
	return ussalmc_wiki_render_template( 'category', array(
		'categories' => $data['categories'],
		'total'      => $data['total'],
		'error'      => null,
		'active'     => $active,
	) );
} );

/**
 * [ussalmc_wiki] — unified wiki surface. Dispatches on the query string:
 *   ?entity=<id>   -> entity card
 *   ?q=<query>     -> search results (always shows the search box)
 *   ?category=<c>  -> category filter
 *   (none)         -> search box + category index
 * One shortcode a theme can drop on a single /wiki/ page.
 */
add_shortcode( 'ussalmc_wiki', function () {
	$entity = isset( $_GET['entity'] ) ? sanitize_text_field( wp_unslash( $_GET['entity'] ) ) : '';
	if ( $entity !== '' ) {
		return do_shortcode( '[ussalmc_search]' ) . ussalmc_wiki_entity_shortcode( array( 'id' => $entity ) );
	}
	$out = do_shortcode( '[ussalmc_search]' );
	if ( empty( $_GET['q'] ) ) {
		$out .= do_shortcode( '[ussalmc_categories]' );
	}
	return $out;
} );

/** Admin heads-up if the plugin is active but not yet pointed at the core API. */
add_action(
	'admin_notices',
	function () {
		if ( ! ussalmc_wiki_is_configured() ) {
			echo '<div class="notice notice-warning"><p><strong>USSALMC Wiki</strong> is active but not configured (missing core API base or key).</p></div>';
		}
	}
);

