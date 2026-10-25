<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<div class="ussalmc-search">
	<?php ussalmc_atlas_search_form( $query, 'atlas-wiki-search' ); ?>
	<?php if ( ! empty( $error ) ) : ?>
		<p class="atlas-empty" role="status">Search is temporarily unavailable. Please try again shortly.</p>
	<?php elseif ( $query !== '' && empty( $results ) ) : ?>
		<div class="atlas-empty"><h2>No matches for “<?php echo esc_html( $query ); ?>”.</h2><p>Try a ship name, a location, or a broader term.</p><a href="<?php echo esc_url( ussalmc_atlas_url() ); ?>">Browse all categories ↗︎</a></div>
	<?php elseif ( ! empty( $results ) ) : ?>
		<div class="atlas-section-heading"><h1>Results for “<?php echo esc_html( $query ); ?>”</h1><span><?php echo esc_html( count( $results ) ); ?> matches</span></div>
		<?php foreach ( $results as $r ) : ?>
			<a class="ussalmc-result" href="<?php echo esc_url( ussalmc_atlas_url( array( 'entity' => $r['id'] ?? '' ) ) ); ?>">
				<div><span class="atlas-eyebrow"><?php echo esc_html( ussalmc_atlas_category_label( $r['type'] ?? '' ) ); ?></span><h3 class="ussalmc-result__name"><?php echo esc_html( $r['name'] ?? 'Untitled entry' ); ?></h3><?php if ( ! empty( $r['summary'] ) ) : ?><p class="ussalmc-result__sum"><?php echo esc_html( wp_trim_words( $r['summary'], 32 ) ); ?></p><?php endif; ?></div><span aria-hidden="true">↗︎</span>
			</a>
		<?php endforeach; ?>
	<?php endif; ?>
</div>
