<?php
/**
 * USSALMC Theme — generic page template (wraps page content in the app shell).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
get_header();
?>
<div class="content ussalmc-page">
	<?php
	while ( have_posts() ) :
		the_post();
		?>
		<div class="page-head"><div><h1><?php the_title(); ?></h1></div></div>
		<div class="ussalmc-content"><?php the_content(); ?></div>
		<?php
	endwhile;
	?>
</div>
<?php
get_footer();
