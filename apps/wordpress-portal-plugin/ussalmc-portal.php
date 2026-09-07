<?php
/**
 * Plugin Name:       USSALMC Portal
 * Plugin URI:        https://ussa.space
 * Description:       Member/community portal for the USSA Lore Master Core. Provides three real Elementor widgets — Market, Stat Readout, Module Grid — that read the core REST API and render in the USSALMC theme's HUD design system (palette inherited from the Elementor Global Kit, no widget-side colors). Also exposes matching shortcodes.
 * Version:           0.2.0
 * Requires PHP:      8.0
 * Author:            USSALMC
 * License:           MIT
 * Text Domain:       ussalmc-portal
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'USSALMC_PORTAL_VERSION', '0.2.0' );
define( 'USSALMC_PORTAL_DIR', plugin_dir_path( __FILE__ ) );

require_once USSALMC_PORTAL_DIR . 'inc/api.php';
require_once USSALMC_PORTAL_DIR . 'inc/render.php';
require_once USSALMC_PORTAL_DIR . 'inc/widgets.php';

/**
 * Shortcodes mirroring the three widgets, so the layout can be assembled from a
 * theme template or a classic page too (and to make them scriptable/testable):
 *   [ussalmc_market] [ussalmc_stat_readout] [ussalmc_module_grid limit="6"]
 */
add_shortcode( 'ussalmc_market', function ( $atts ) {
	$atts = shortcode_atts( array( 'title' => 'Commodity Market' ), $atts, 'ussalmc_market' );
	return ussalmc_portal_render_market( array( 'title' => sanitize_text_field( $atts['title'] ) ) );
} );

add_shortcode( 'ussalmc_stat_readout', function () {
	return ussalmc_portal_render_stat_readout();
} );

add_shortcode( 'ussalmc_module_grid', function ( $atts ) {
	$atts = shortcode_atts( array( 'title' => 'Knowledge Base — Recent Entities', 'limit' => 6 ), $atts, 'ussalmc_module_grid' );
	return ussalmc_portal_render_module_grid( array(
		'title' => sanitize_text_field( $atts['title'] ),
		'limit' => (int) $atts['limit'],
	) );
} );

/** Legacy landing shortcode kept for back-compat. */
add_shortcode( 'ussalmc_portal', function () {
	return '<div class="ussalmc-portal"><p>USSALMC Portal — online. o7</p></div>';
} );
