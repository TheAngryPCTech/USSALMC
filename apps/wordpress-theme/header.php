<?php
/**
 * USSALMC Theme — app shell header: left icon rail + top status bar.
 * Ported from reference/corp-portal.html (visual source of truth).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$rail_items = array(
	array( 'Dashboard',        home_url( '/' ),      true,  '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>' ),
	array( 'Fleet',            '#fleet',             false, '<path d="M2 12l6-7h8l6 7-6 7H8z"/>' ),
	array( 'Contracts',        '#contracts',         false, '<path d="M6 2h9l5 5v15H6z"/><path d="M9 12h6M9 16h6M9 8h3"/>' ),
	array( 'Market',           '#market',            false, '<path d="M3 17l5-6 4 4 8-9"/>' ),
	array( 'Personnel',        '#personnel',         false, '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>' ),
	array( 'Security Division','#security',          false, '<path d="M12 2l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z"/>' ),
	array( 'Comms',            '#comms',             false, '<path d="M4 4h16v12H8l-4 4z"/>' ),
);
$mark = ussalmc_theme_asset( 'ussa-mark.png' );

/**
 * Top menu (replaces the old decorative "TERMINAL / HURSTON HUB / ..."
 * breadcrumb text with real site navigation). "Knowledge Base" is a
 * dropdown built from the live category index (ussalmc_wiki_category_index(),
 * server-side cached — see API_CATEGORIES_CACHE_TTL_SEC) so it always
 * reflects what's actually in the KB, never a hand-maintained list that
 * drifts from reality. Falls back to just the "All Categories" link if the
 * core API is unreachable — never lets a header include break the page.
 */
$kb_categories = array();
if ( function_exists( 'ussalmc_wiki_category_index' ) ) {
	$cats = ussalmc_wiki_category_index();
	if ( ! is_wp_error( $cats ) && is_array( $cats ) ) {
		$kb_categories = array_filter(
			$cats,
			static function ( $c ) {
				return ( (int) ( $c['entry_count'] ?? 0 ) > 0 ) || isset( $c['freshness'] );
			}
		);
		usort( $kb_categories, static function ( $a, $b ) {
			return (int) ( $b['entry_count'] ?? 0 ) <=> (int) ( $a['entry_count'] ?? 0 );
		} );
	}
}
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<div class="app">

	<!-- LEFT RAIL -->
	<nav class="rail" aria-label="Primary">
		<div class="rail-mark" title="USSA"><img src="<?php echo esc_url( $mark ); ?>" alt="USSA"></div>
		<div class="rail-nav">
			<?php foreach ( $rail_items as $it ) : ?>
				<a class="rail-item<?php echo $it[2] ? ' active' : ''; ?>" href="<?php echo esc_url( $it[1] ); ?>" title="<?php echo esc_attr( $it[0] ); ?>" aria-label="<?php echo esc_attr( $it[0] ); ?>">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><?php echo $it[3]; // phpcs:ignore — static inline SVG ?></svg>
				</a>
			<?php endforeach; ?>
		</div>
		<div class="rail-foot">
			<div class="dot" title="Systems nominal"></div>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="color:var(--text-faint)"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8L7 17M17 7l2.8-2.8"/></svg>
		</div>
	</nav>

	<!-- MAIN -->
	<div class="main">

		<header class="topbar">
			<div class="brand">
				<div class="brand-mark"><img src="<?php echo esc_url( $mark ); ?>" alt=""></div>
				<div class="brand-text">USSA<span>UNITED SPACE SECURITIES ASSOC.</span><small>CORP-NET</small></div>
			</div>
			<div class="topbar-div"></div>

			<nav class="topmenu" aria-label="Primary site navigation">
				<div class="topmenu__item">
					<a class="topmenu__link" href="<?php echo esc_url( home_url( '/' ) ); ?>">Dashboard</a>
				</div>
				<div class="topmenu__item">
					<a class="topmenu__link" href="<?php echo esc_url( home_url( '/wiki/' ) ); ?>">Knowledge Base <span class="topmenu__caret">▾</span></a>
					<div class="topmenu__panel">
						<a class="topmenu__sublink topmenu__sublink--all" href="<?php echo esc_url( home_url( '/wiki/' ) ); ?>">All Categories</a>
						<?php foreach ( $kb_categories as $cat ) :
							$slug = $cat['slug'] ?? '';
							if ( ! $slug || $slug === 'trade_route' ) { continue; } // trade routes get their own top-level item below
							$href  = add_query_arg( 'category', rawurlencode( $slug ), home_url( '/wiki/' ) );
							$count = (int) ( $cat['entry_count'] ?? 0 );
							?>
							<a class="topmenu__sublink" href="<?php echo esc_url( $href ); ?>">
								<?php echo esc_html( $cat['display_name'] ?? ucfirst( $slug ) ); ?>
								<span class="topmenu__count"><?php echo esc_html( $count ); ?></span>
							</a>
						<?php endforeach; ?>
					</div>
				</div>
				<div class="topmenu__item">
					<a class="topmenu__link" href="<?php echo esc_url( add_query_arg( 'category', 'trade_route', home_url( '/wiki/' ) ) ); ?>">Trade Routes</a>
				</div>
			</nav>

			<div class="topbar-right">
				<div class="stat-chip">
					<div class="label">CORP BALANCE</div>
					<div class="value">4,218,600 <span style="color:var(--text-faint);font-size:10px">aUEC</span></div>
				</div>
				<div class="stat-chip">
					<div class="label">ALERT LEVEL</div>
					<div class="value amber">GREEN</div>
				</div>
				<div class="pilot-tag">
					<div class="pilot-avatar"></div>
					<div>
						<div class="name">R. VOSS</div>
						<div class="rank">EXTRACTION OPS LEAD // L4</div>
					</div>
				</div>
			</div>
		</header>
