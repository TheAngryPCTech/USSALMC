<?php
/**
 * USSALMC Theme — default template (index).
 * Wraps post/page content in the HUD app shell. Elementor "Canvas"/"Full Width"
 * page templates bypass this and render inside the shell via the content area,
 * so an Elementor-built dashboard page still gets the rail + topbar chrome.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
get_header();
?>
<div class="content ussalmc-page">
	<?php
	if ( have_posts() ) :
		while ( have_posts() ) :
			the_post();
			?>
			<article <?php post_class(); ?>>
				<div class="page-head"><div><h1><?php the_title(); ?></h1></div></div>
				<div class="ussalmc-content"><?php the_content(); ?></div>
			</article>
			<?php
		endwhile;
	else :
		echo '<div class="page-head"><div><h1>USSA Lore Master Core</h1></div></div>';
		echo '<p class="ussalmc-content">No content yet. o7</p>';
	endif;
	?>
</div>
<?php
get_footer();
