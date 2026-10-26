<?php
/**
 * Stellar Atlas theme: original USSA identity, knowledge-first homepage,
 * shared search/category/entity views, and existing Elementor integration.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'USSALMC_THEME_VERSION', '0.6.5' );

require_once get_stylesheet_directory() . '/inc/elementor-kit.php';
require_once get_stylesheet_directory() . '/inc/atlas.php';
require_once get_stylesheet_directory() . '/inc/planetary-atlas.php';
require_once get_stylesheet_directory() . '/inc/dashboard.php';
require_once get_stylesheet_directory() . '/inc/placeholders.php';

add_action(
	'after_setup_theme',
	function () {
		add_theme_support( 'title-tag' );
		add_theme_support( 'post-thumbnails' );
		add_theme_support( 'html5', array( 'search-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
		add_theme_support( 'align-wide' );
		register_nav_menus(
			array(
				'rail' => 'Left Rail',
			)
		);
	}
);

/**
 * Fonts + stylesheet.
 * Aquire is commercial and not on a CDN — it is declared via @font-face in
 * style.css and falls back to Rajdhani (loaded here) until a licensed file is
 * dropped into assets/fonts/. Inter = body/data copy; Space Mono = readouts.
 */
add_action(
	'wp_enqueue_scripts',
	function () {
		wp_enqueue_style(
			'ussalmc-fonts',
			'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap',
			array(),
			null
		);
		wp_enqueue_style( 'ussalmc-theme', get_stylesheet_uri(), array( 'ussalmc-fonts' ), USSALMC_THEME_VERSION );
		wp_enqueue_style( 'ussalmc-planetary', get_stylesheet_directory_uri() . '/assets/planetary-atlas.css', array( 'ussalmc-atlas' ), USSALMC_THEME_VERSION );
		wp_enqueue_script( 'ussalmc-planetary', get_stylesheet_directory_uri() . '/assets/js/planetary-atlas.js', array(), USSALMC_THEME_VERSION, true );
		wp_enqueue_style( 'ussalmc-atlas', get_stylesheet_directory_uri() . '/assets/atlas.css', array( 'ussalmc-theme' ), USSALMC_THEME_VERSION );

		// Inline image lightbox for wiki entity pages (opens images in an
		// on-page overlay instead of navigating away / opening a new tab).
		wp_enqueue_script(
			'ussalmc-lightbox',
			get_stylesheet_directory_uri() . '/assets/js/lightbox.js',
			array(),
			USSALMC_THEME_VERSION,
			true
		);
	}
);

/** Convenience: expose the mark/logo asset URLs to templates. */
function ussalmc_theme_asset( string $file ): string {
	return get_stylesheet_directory_uri() . '/assets/' . ltrim( $file, '/' );
}

/** Give category tabs a useful title without changing stored WordPress pages. */
add_filter( 'document_title_parts', function ( $parts ) {
	if ( is_front_page() ) { $parts['title'] = 'Stellar Atlas'; }
	elseif ( is_page( 'wiki' ) && isset( $_GET['category'] ) && is_string( $_GET['category'] ) ) {
		$slug = sanitize_text_field( wp_unslash( $_GET['category'] ) );
		$parts['title'] = $slug === 'ship' ? 'Ships' : ussalmc_atlas_category_label( $slug );
	}
	return $parts;
} );

// Modules self-host their pinned Three.js imports; no CDN/global import map.
add_filter( 'script_loader_tag', function ( $tag, $handle, $src ) {
	return $handle === 'ussalmc-planetary' ? wp_get_script_tag( array( 'type' => 'module', 'src' => $src, 'id' => 'ussalmc-planetary-js' ) ) : $tag;
}, 10, 3 );
