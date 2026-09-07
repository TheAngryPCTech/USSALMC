<?php
/**
 * Template Name: USSALMC Dashboard
 *
 * Full HUD dashboard page template. Renders the app shell (rail + topbar) then
 * the dashboard body (which supplies its own .content wrapper) then the footer.
 * Assign this template to a Page, or the theme auto-uses it for the front page
 * whose content is just [ussalmc_dashboard].
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
get_header();

while ( have_posts() ) {
	the_post();
	// Page content is expected to be the [ussalmc_dashboard] shortcode, which
	// outputs the full .content block itself.
	echo apply_filters( 'the_content', get_the_content() );
}

get_footer();
