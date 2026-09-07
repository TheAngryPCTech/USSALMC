<?php
/**
 * Elementor Global Kit sync — USSALMC design tokens.
 *
 * Writes the exact design-system colors + typography into Elementor's active Kit
 * (system_colors / custom_colors / system_typography) so any Elementor widget
 * that uses a Global Color/Font — including the portal plugin's Market, Stat
 * Readout and Module Grid widgets — inherits the correct palette automatically,
 * with NO plugin-side changes (requirement #1).
 *
 * The Kit is Elementor's own store of Global Colors/Fonts; syncing it here keeps
 * the palette in one place and mirrors the CSS custom properties in style.css.
 * Idempotent: safe to run repeatedly (only overwrites the USSALMC-managed keys).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The canonical token map — single source of truth, mirrors :root in style.css. */
function ussalmc_kit_tokens(): array {
	return array(
		// _id => [ title, hex ]. _id values are stable so Global Color refs persist.
		'colors' => array(
			array( '_id' => 'ussa_void',        'title' => 'Void',         'color' => '#0A0E14' ),
			array( '_id' => 'ussa_panel',       'title' => 'Panel',        'color' => '#111820' ),
			array( '_id' => 'ussa_panelraised', 'title' => 'Panel Raised', 'color' => '#151E28' ),
			array( '_id' => 'ussa_line',        'title' => 'Line',         'color' => '#28333F' ),
			array( '_id' => 'ussa_linebright',  'title' => 'Line Bright',  'color' => '#3A4757' ),
			array( '_id' => 'ussa_signal',      'title' => 'Signal',       'color' => '#4A9EFF' ),
			array( '_id' => 'ussa_signaldim',   'title' => 'Signal Dim',   'color' => '#1C69D4' ),
			array( '_id' => 'ussa_amber',       'title' => 'Amber',        'color' => '#E8A33D' ),
			array( '_id' => 'ussa_text',        'title' => 'Text',         'color' => '#E6EAEF' ),
			array( '_id' => 'ussa_textdim',     'title' => 'Text Dim',     'color' => '#8A97A6' ),
			array( '_id' => 'ussa_textfaint',   'title' => 'Text Faint',   'color' => '#4E5966' ),
			array( '_id' => 'ussa_green',       'title' => 'Green',        'color' => '#4FD1A5' ),
		),
		// Typography roles mapped to the correct use cases (req #3).
		'typography' => array(
			array(
				'_id'                 => 'ussa_display',
				'title'               => 'Display / Wordmark / Labels',
				'typography_typography'  => 'custom',
				'typography_font_family' => 'Aquire',
				'typography_font_weight' => '600',
				'typography_letter_spacing' => array( 'size' => 0.4, 'unit' => 'px' ),
			),
			array(
				'_id'                 => 'ussa_body',
				'title'               => 'Body / Data Copy',
				'typography_typography'  => 'custom',
				'typography_font_family' => 'Inter',
				'typography_font_weight' => '400',
			),
			array(
				'_id'                 => 'ussa_mono',
				'title'               => 'Mono Readouts',
				'typography_typography'  => 'custom',
				'typography_font_family' => 'Space Mono',
				'typography_font_weight' => '400',
			),
		),
	);
}

/**
 * Merge the USSALMC tokens into the active Elementor Kit's page settings.
 * Runs on admin/CLI when Elementor is present; the CLI bootstrap triggers it.
 */
function ussalmc_sync_elementor_kit(): array {
	if ( ! defined( 'ELEMENTOR_VERSION' ) && ! class_exists( '\\Elementor\\Plugin' ) ) {
		return array( 'ok' => false, 'reason' => 'Elementor not active' );
	}
	$kit_id = (int) get_option( 'elementor_active_kit' );
	if ( ! $kit_id ) {
		return array( 'ok' => false, 'reason' => 'no active kit' );
	}
	$settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
	if ( ! is_array( $settings ) ) {
		$settings = array();
	}
	$tokens = ussalmc_kit_tokens();

	// Custom Colors carry the full 12-token palette (system colors are only 4 slots).
	$settings['custom_colors'] = $tokens['colors'];
	// Map the 4 Elementor "system" colors to our primary roles so default widgets look right.
	$settings['system_colors'] = array(
		array( '_id' => 'primary',   'title' => 'Primary',   'color' => '#4A9EFF' ),
		array( '_id' => 'secondary', 'title' => 'Secondary', 'color' => '#1C69D4' ),
		array( '_id' => 'text',      'title' => 'Text',      'color' => '#E6EAEF' ),
		array( '_id' => 'accent',    'title' => 'Accent',    'color' => '#E8A33D' ),
	);
	$settings['custom_typography'] = $tokens['typography'];
	// Body defaults so inheriting widgets get the right base font.
	$settings['body_typography_typography']   = 'custom';
	$settings['body_typography_font_family']  = 'Inter';
	$settings['body_typography_font_weight']  = '400';

	update_post_meta( $kit_id, '_elementor_page_settings', $settings );

	// Clear Elementor's compiled CSS so the new globals take effect.
	if ( class_exists( '\\Elementor\\Plugin' ) ) {
		try {
			\Elementor\Plugin::$instance->files_manager->clear_cache();
		} catch ( \Throwable $e ) { /* non-fatal */ }
	}
	return array( 'ok' => true, 'kit_id' => $kit_id, 'colors' => count( $tokens['colors'] ) );
}

/** WP-CLI: `wp ussalmc sync-kit` — used by the container bootstrap. */
if ( defined( 'WP_CLI' ) && WP_CLI ) {
	\WP_CLI::add_command(
		'ussalmc sync-kit',
		function () {
			$r = ussalmc_sync_elementor_kit();
			if ( ! empty( $r['ok'] ) ) {
				\WP_CLI::success( "Synced USSALMC Kit into elementor kit {$r['kit_id']} ({$r['colors']} colors)." );
			} else {
				\WP_CLI::warning( 'Kit not synced: ' . ( $r['reason'] ?? 'unknown' ) );
			}
		}
	);
}

/** Also sync on theme switch so a fresh activation is styled immediately. */
add_action( 'after_switch_theme', 'ussalmc_sync_elementor_kit' );
