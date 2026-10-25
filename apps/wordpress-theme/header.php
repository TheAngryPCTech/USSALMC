<?php
/** Stellar Atlas — one calm, responsive navigation shared by every page. */
if ( ! defined( 'ABSPATH' ) ) { exit; }
$active_category = isset( $_GET['category'] ) ? sanitize_text_field( wp_unslash( $_GET['category'] ) ) : '';
$is_locations = ( isset( $_GET['tool'] ) && $_GET['tool'] === 'locations' ) || $active_category === 'location';
$nav = array(
	array( 'Explore', home_url( '/' ), is_front_page() ),
	array( 'Knowledge base', ussalmc_atlas_url(), ! is_front_page() && is_page( 'wiki' ) && ! $is_locations && ! in_array( $active_category, array( 'trade_route', 'guide' ), true ) ),
	array( 'Locations', ussalmc_atlas_url( array( 'tool' => 'locations' ) ), $is_locations ),
	array( 'Trade routes', ussalmc_atlas_url( array( 'category' => 'trade_route' ) ), $active_category === 'trade_route' ),
	array( 'Guides', ussalmc_atlas_url( array( 'category' => 'guide' ) ), $active_category === 'guide' ),
);
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'stellar-atlas' ); ?>>
<?php wp_body_open(); ?>
<a class="atlas-skip" href="#atlas-main">Skip to content</a>
<header class="atlas-header">
	<div class="atlas-header__inner">
		<a class="atlas-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" aria-label="USSA home">
			<img src="<?php echo esc_url( ussalmc_theme_asset( 'ussa-mark.png' ) ); ?>" width="34" height="42" alt="">
			<span><strong>USSA<span class="atlas-brand__dot">.</span></strong><small>United Space Securities Association</small></span>
		</a>
		<nav class="atlas-nav" aria-label="Primary navigation">
			<?php foreach ( $nav as $item ) : ?>
				<a href="<?php echo esc_url( $item[1] ); ?>" <?php if ( $item[2] ) { echo 'aria-current="page"'; } ?>><?php echo esc_html( $item[0] ); ?></a>
			<?php endforeach; ?>
		</nav>
		<?php if ( is_user_logged_in() ) : ?>
			<a class="atlas-account" href="<?php echo esc_url( admin_url( 'profile.php' ) ); ?>">My account <span aria-hidden="true">↗︎</span></a>
		<?php else : ?>
			<a class="atlas-account" href="<?php echo esc_url( wp_login_url( get_permalink() ?: home_url( '/' ) ) ); ?>">Sign in <span aria-hidden="true">↗︎</span></a>
		<?php endif; ?>
	</div>
</header>
<div class="app"><main class="main" id="atlas-main" tabindex="-1">
