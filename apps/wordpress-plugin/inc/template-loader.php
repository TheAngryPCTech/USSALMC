<?php
/**
 * USSALMC Wiki — template loader (theme override system).
 *
 * Renders a template by name, checking the ACTIVE THEME first, then the plugin's
 * own bundled default. This is the mechanism by which the USSALMC theme restyles
 * wiki output (entity cards, search, category views) WITHOUT any change to this
 * plugin's code — a theme drops a file at:
 *
 *     wp-content/themes/<theme>/ussalmc-wiki/<name>.php
 *
 * and it overrides the plugin's templates/<name>.php. $vars are extracted into
 * the template's scope. Output is returned as a string.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'USSALMC_WIKI_DIR', plugin_dir_path( dirname( __FILE__ ) ) );

function ussalmc_wiki_render_template( string $name, array $vars = array() ): string {
	$name = preg_replace( '/[^a-z0-9\-]/', '', $name );

	// 1) active theme (child then parent) override dir, via locate_template.
	$located = locate_template( array( "ussalmc-wiki/{$name}.php" ) );

	// 2) fall back to the plugin's bundled default template.
	if ( ! $located ) {
		$candidate = USSALMC_WIKI_DIR . "templates/{$name}.php";
		$located   = file_exists( $candidate ) ? $candidate : '';
	}
	if ( ! $located ) {
		return '<div class="ussalmc-entity ussalmc-error">Missing wiki template: ' . esc_html( $name ) . '</div>';
	}

	extract( $vars, EXTR_SKIP ); // phpcs:ignore — controlled template vars
	ob_start();
	include $located;
	return (string) ob_get_clean();
}
