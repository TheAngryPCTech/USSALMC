<?php
/**
 * USSALMC Theme — functions.
 * HUD / corporate-portal identity for the USSA Lore Master Core.
 *
 * Responsibilities:
 *  - Load fonts (Aquire @font-face + Rajdhani fallback, Inter, Space Mono).
 *  - Load the design-system stylesheet (style.css).
 *  - Register/sync the Elementor Global Colors + Typography Kit (inc/elementor-kit.php)
 *    so theme-inheriting plugin widgets pick up the exact palette with no plugin changes.
 *  - Provide the [ussalmc_dashboard] shortcode that assembles the HUD dashboard
 *    (rail + topbar + instrument cluster + module grid + placeholder panels),
 *    using the portal plugin's real widgets when Elementor renders them.
 *  - Register the theme's wiki template-override directory so the wiki plugin's
 *    entity/search/category output inherits this visual language.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'USSALMC_THEME_VERSION', '0.2.0' );

require_once get_stylesheet_directory() . '/inc/elementor-kit.php';
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
				'rail'   => 'Left Rail',
				// Navigation shown in the top status bar. Manage its items from
				// WP Admin -> Appearance -> Menus (assign a menu to "Top Bar").
				// If no menu is assigned, header.php falls back to a single
				// auto-generated "Knowledge Base" link to the wiki landing page.
				'topbar' => 'Top Bar',
			)
		);
	}
);

/**
 * URL of the wiki plugin's main/landing page (entities/search/categories).
 * Prefers a Page whose content uses the [ussalmc_wiki] dispatcher shortcode;
 * falls back to the conventional /wiki/ path the bootstrap creates.
 */
function ussalmc_wiki_url(): string {
	$page = get_page_by_path( 'wiki' );
	if ( $page instanceof WP_Post ) {
		return get_permalink( $page );
	}
	// Also honour any page actually containing the dispatcher shortcode.
	$found = get_posts(
		array(
			'post_type'      => 'page',
			'post_status'    => 'publish',
			'posts_per_page' => 1,
			's'              => '[ussalmc_wiki',
			'fields'         => 'ids',
		)
	);
	if ( ! empty( $found ) ) {
		return get_permalink( $found[0] );
	}
	return home_url( '/wiki/' );
}

/**
 * Fallback for the Top Bar menu when no menu is assigned in WP Admin: a single
 * "Knowledge Base" link to the wiki landing page, styled like a menu.
 */
function ussalmc_topbar_menu_fallback(): void {
	echo '<ul id="menu-topbar" class="topbar-menu">';
	echo '<li class="menu-item"><a href="' . esc_url( ussalmc_wiki_url() ) . '">Knowledge Base</a></li>';
	echo '</ul>';
}

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
