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
			<div class="breadcrumb">TERMINAL <b>/ HURSTON HUB / <?php echo esc_html( strtoupper( wp_get_document_title() ) ); ?></b></div>

			<nav class="topbar-nav" aria-label="Knowledge Base navigation">
				<?php
				wp_nav_menu(
					array(
						'theme_location' => 'topbar',
						'container'      => false,
						'menu_class'     => 'topbar-menu',
						'menu_id'        => 'menu-topbar',
						'depth'          => 1,
						'fallback_cb'    => 'ussalmc_topbar_menu_fallback',
					)
				);
				?>
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
