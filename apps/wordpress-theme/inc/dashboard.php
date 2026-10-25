<?php
/** The existing homepage shortcode now presents Stellar Atlas. */
if ( ! defined( 'ABSPATH' ) ) { exit; }
add_shortcode( 'ussalmc_dashboard', function () {
	$categories = ussalmc_atlas_categories();
	$recent = ussalmc_atlas_recent();
	$featured = array();
	if ( ! is_wp_error( $categories ) ) {
		$by_slug = array_column( $categories, null, 'slug' );
		foreach ( array( 'ship', 'trade_route', 'location', 'weapon', 'species', 'guide' ) as $slug ) {
			if ( isset( $by_slug[$slug] ) ) { $featured[$slug] = $by_slug[$slug]; }
		}
		foreach ( $categories as $cat ) {
			if ( count( $featured ) >= 6 ) { break; }
			$featured[$cat['slug']] = $cat;
		}
	}
	// Editorial labels and imagery from the approved mockup; preserve real URLs.
	$labels = array( 'ship' => 'Ships', 'trade_route' => 'Trade routes', 'location' => 'Locations', 'weapon' => 'Equipment', 'species' => 'Lore & species', 'guide' => 'Guides' );
	$descriptions = array( 'ship' => 'From your first flight to your next flagship.', 'trade_route' => 'Commodities, terminals, and your next run.', 'location' => 'Find your bearings across the ’verse.', 'weapon' => 'Weapons, components, and the details that matter.', 'species' => 'Meet the people behind the universe.', 'guide' => 'Practical knowledge for life in the field.' );
	foreach ( $featured as $key => &$cat ) {
		$cat['display_name'] = $labels[$key] ?? $cat['display_name'];
		$cat['description'] = $descriptions[$key] ?? $cat['description'];
		$editorial = array( 'ship' => 'ship_400i', 'trade_route' => 'commodity_laranite', 'location' => 'location_area18', 'weapon' => 'item_10_series_greatsword_cannon', 'species' => 'lore_species_banu', 'guide' => 'ship_prospector' );
		if ( isset( $editorial[$key] ) ) {
			$image = ussalmc_atlas_editorial_image( $editorial[$key] );
			if ( $image ) { $cat['image'] = $image; }
		}
	}
	unset( $cat );
	ob_start(); ?>
	<div class="content atlas-home">
		<section class="atlas-hero" aria-labelledby="atlas-title">
			<div class="atlas-eyebrow"><span></span> THE USSA KNOWLEDGE BASE</div>
			<h1 id="atlas-title">A little knowledge.<br><em>An entire universe.</em></h1>
			<p>Your field guide to the ships, places, and possibilities of Star Citizen.<br class="atlas-desktop-break"> Find what you need. Make your next move.</p>
			<?php ussalmc_atlas_search_form(); ?>
			<div class="atlas-hero__links"><span>Start exploring</span><a href="<?php echo esc_url( ussalmc_atlas_url( array( 'category' => 'ship' ) ) ); ?>">Ships</a><a href="<?php echo esc_url( ussalmc_atlas_url( array( 'category' => 'location' ) ) ); ?>">Locations</a><a href="<?php echo esc_url( ussalmc_atlas_url( array( 'category' => 'guide' ) ) ); ?>">Guides</a></div>
			<div class="atlas-hero__coordinate" aria-hidden="true">USSA / STELLAR ATLAS<br>KNOWLEDGE. SHARED.</div>
		</section>
		<div class="atlas-home__body">
			<section class="atlas-browse" aria-labelledby="atlas-browse-title">
				<div class="atlas-section-heading"><div><span class="atlas-eyebrow">01 / DISCOVER</span><h2 id="atlas-browse-title">Find your corner of the ’verse.</h2></div><a href="<?php echo esc_url( ussalmc_atlas_url() ); ?>">All categories ↗︎</a></div>
				<?php if ( is_wp_error( $categories ) ) : ?>
					<p class="atlas-empty" role="status">The knowledge base is temporarily unavailable. Please try again shortly.</p>
				<?php elseif ( ! $featured ) : ?>
					<p class="atlas-empty">The archive is taking shape. Categories will appear as entries are added.</p>
				<?php else : ?>
					<div class="atlas-category-grid"><?php foreach ( $featured as $cat ) { ussalmc_atlas_category_card( $cat ); } ?></div>
				<?php endif; ?>
			</section>
			<aside class="atlas-recent" aria-labelledby="atlas-recent-title">
				<div class="atlas-section-heading"><div><span class="atlas-eyebrow">02 / THE LATEST</span><h2 id="atlas-recent-title">Fresh from the archive.</h2></div></div>
				<p class="atlas-recent__intro">Recently added and updated knowledge.</p>
				<?php if ( is_wp_error( $recent ) ) : ?>
					<p class="atlas-empty">Recent updates are temporarily unavailable.</p>
				<?php elseif ( empty( $recent['items'] ) ) : ?>
					<p class="atlas-empty">No updates yet. Check back as the archive grows.</p>
				<?php else : ?>
					<?php foreach ( $recent['items'] as $entry ) : $image = ussalmc_atlas_image( $entry ); ?>
						<a class="atlas-recent-entry" href="<?php echo esc_url( ussalmc_atlas_url( array( 'entity' => $entry['id'] ) ) ); ?>">
							<?php if ( $image ) : ?><img src="<?php echo esc_url( $image['url'] ); ?>" alt="" loading="lazy" width="72" height="72"><?php else : ?><span class="atlas-recent-entry__placeholder" aria-hidden="true">◇</span><?php endif; ?>
							<span><small><?php echo esc_html( ussalmc_atlas_category_label( $entry['attributes']['category'] ?? $entry['type'] ?? '' ) ); ?></small><strong><?php echo esc_html( $entry['name'] ); ?></strong><?php if ( ! empty( $entry['updated_at'] ) ) : ?><time datetime="<?php echo esc_attr( $entry['updated_at'] ); ?>"><?php echo esc_html( ussalmc_wiki_time_ago_from_iso( $entry['updated_at'] ) ); ?></time><?php endif; ?></span>
						</a>
					<?php endforeach; ?>
				<?php endif; ?>
				<div class="atlas-note"><span class="atlas-eyebrow">BUILT ON SHARED KNOWLEDGE</span><p>Every entry has a source.<br>Every discovery moves us forward.</p><a href="<?php echo esc_url( ussalmc_atlas_url() ); ?>">Explore the knowledge base ↗︎</a></div>
			</aside>
		</div>
		<section class="atlas-tools" aria-label="Field tools"><span class="atlas-eyebrow">OUT IN THE FIELD?</span><div><a href="<?php echo esc_url( ussalmc_atlas_url( array( 'category' => 'trade_route' ) ) ); ?>">Plan a trade route ↗︎</a><a href="<?php echo esc_url( ussalmc_atlas_url( array( 'tool' => 'sig-ident' ) ) ); ?>">Identify a mining signature ↗︎</a></div></section>
	</div>
	<?php return ob_get_clean();
} );
