<?php
/** Server-side KB fetch: credentials never enter the map payload or browser. */
if ( ! defined( 'ABSPATH' ) ) { exit; }
function ussalmc_planetary_atlas(): string {
	$atlas = function_exists( 'ussalmc_wiki_api_get' ) ? ussalmc_wiki_api_get( '/v1/atlas' ) : new WP_Error( 'wiki_missing', 'The knowledge base is unavailable.' );
	if ( is_wp_error( $atlas ) ) {
		return '<section class="atlas-empty" role="status"><h1>Planetary Atlas</h1><p>The locations service is temporarily unavailable.</p><a href="' . esc_url( ussalmc_atlas_url( array( 'category' => 'location', 'view' => 'list' ) ) ) . '">Browse location entries instead ↗︎</a></section>';
	}
	$payload = array(
		'nodes' => $atlas['nodes'] ?? array(),
		'truncated' => ! empty( $atlas['truncated'] ),
		'kbUrl' => ussalmc_atlas_url(),
		'listUrl' => ussalmc_atlas_url( array( 'category' => 'location', 'view' => 'list' ) ),
		'body' => isset( $_GET['body'] ) && is_string( $_GET['body'] ) ? sanitize_text_field( wp_unslash( $_GET['body'] ) ) : '',
		'place' => isset( $_GET['place'] ) && is_string( $_GET['place'] ) ? sanitize_text_field( wp_unslash( $_GET['place'] ) ) : '',
	);
	ob_start();
	include get_stylesheet_directory() . '/ussalmc-wiki/planetary-atlas.php';
	return (string) ob_get_clean();
}
add_shortcode( 'ussalmc_planetary_atlas', 'ussalmc_planetary_atlas' );
