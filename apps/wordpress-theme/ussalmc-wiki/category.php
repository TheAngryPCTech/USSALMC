<?php
/** Stellar Atlas category browser. Filter the whole fetched category before paging. */
if ( ! defined( 'ABSPATH' ) ) { exit; }
$slug = (string) ( $active ?: '' );
$is_ships = $slug === 'ship';
$label = ussalmc_atlas_category_label( $slug );
$filter = isset( $_GET['filter'] ) && is_string( $_GET['filter'] ) ? sanitize_text_field( wp_unslash( $_GET['filter'] ) ) : '';
$sort = isset( $_GET['sort'] ) && $_GET['sort'] === 'za' ? 'za' : 'az';
$requested_page = isset( $_GET['kb_page'] ) ? max( 1, absint( $_GET['kb_page'] ) ) : 1;
// Ships only: 'all' (flat, sortable, paginated — unchanged default) or a
// grouped browse by manufacturer/role (no pagination; 236 ships render fine
// on one page grouped, and "page 2 of manufacturers" isn't a useful idea).
$view = $is_ships && isset( $_GET['view'] ) && in_array( $_GET['view'], array( 'manufacturer', 'role' ), true )
	? sanitize_text_field( wp_unslash( $_GET['view'] ) )
	: 'all';
$items = array();
foreach ( $categories as $cat => $batch ) {
	if ( ! $active || $active === $cat ) { array_push( $items, ...$batch ); }
}
$all_count = count( $items );
if ( $filter !== '' ) {
	$items = array_values( array_filter( $items, static function ( $item ) use ( $filter ) {
		return stripos( $item['name'], $filter ) !== false;
	} ) );
}
$matched = count( $items );
// Renders one entity card — shared by the flat grid and every grouped
// section below, so the markup never drifts between the two.
$render_card = static function ( array $item ) use ( $is_ships, $slug ) {
	$chips = ussalmc_wiki_category_stat_chips( $item['category'] ?? $slug, $item['attributes'] ?? array() );
	// A zero/missing pledge price is not an offer to buy a free ship.
	if ( $is_ships && (float) ( $item['attributes']['price_usd'] ?? 0 ) <= 0 ) {
		$chips = array_values( array_filter( $chips, static function ( $chip ) { return $chip['label'] !== 'Price'; } ) );
	}
	?>
	<a class="atlas-entity-card" href="<?php echo esc_url( ussalmc_atlas_url( array( 'entity' => $item['id'] ) ) ); ?>">
		<div class="atlas-entity-card__visual"><?php if ( ! empty( $item['thumb'] ) ) : ?><img src="<?php echo esc_url( $item['thumb'] ); ?>" alt="" loading="lazy" decoding="async" width="640" height="360"><?php else : ?><span class="atlas-entity-card__placeholder">Image not yet available</span><?php endif; ?></div>
		<div class="atlas-entity-card__copy"><div class="atlas-entity-card__heading"><h2><?php echo esc_html( $item['name'] ); ?></h2><span aria-hidden="true">↗︎</span></div><p class="atlas-entity-card__category"><?php echo esc_html( ussalmc_atlas_category_label( $item['category'] ?? $slug ) ); ?></p>
		<?php if ( $chips ) : ?><div class="atlas-entity-card__stats"><?php foreach ( array_slice( $chips, 0, 3 ) as $chip ) : ?><span><small><?php echo esc_html( $chip['label'] ); ?></small><?php echo esc_html( $chip['value'] ); ?></span><?php endforeach; ?></div><?php endif; ?></div>
	</a>
	<?php
};
// Ships-by-manufacturer / ships-by-role: group the (already filtered) items,
// alphabetize sections and the ships within each, and skip the sort/
// pagination controls that don't apply to a grouped browse.
$groups = array();
if ( $is_ships && $view !== 'all' ) {
	if ( $view === 'manufacturer' ) {
		$mfr_map = ussalmc_wiki_manufacturer_name_map();
		if ( is_wp_error( $mfr_map ) ) { $mfr_map = array(); }
		foreach ( $items as $item ) {
			$mfr_id = null;
			foreach ( $item['relations'] ?? array() as $rel ) {
				if ( ( $rel['type'] ?? '' ) === 'manufactured_by' ) { $mfr_id = $rel['target_id'] ?? null; break; }
			}
			$key = ( $mfr_id && isset( $mfr_map[ $mfr_id ] ) ) ? $mfr_map[ $mfr_id ] : 'Unlisted manufacturer';
			$groups[ $key ][] = $item;
		}
	} else {
		foreach ( $items as $item ) {
			$role = trim( (string) ( $item['attributes']['role'] ?? '' ) );
			// Case-normalize so "Heavy fighter" and "Heavy Fighter" (an import
			// casing inconsistency, not two different roles) share one bucket.
			$key = $role !== '' ? ucwords( strtolower( $role ) ) : 'Unspecified role';
			$groups[ $key ][] = $item;
		}
	}
	ksort( $groups, SORT_STRING | SORT_FLAG_CASE );
	foreach ( $groups as &$group_items ) {
		usort( $group_items, static function ( $a, $b ) { return strnatcasecmp( $a['name'], $b['name'] ); } );
	}
	unset( $group_items );
}
usort( $items, static function ( $a, $b ) use ( $sort ) {
	$cmp = strnatcasecmp( $a['name'], $b['name'] );
	return $sort === 'za' ? -$cmp : $cmp;
} );
$per_page = 24;
$pages = max( 1, (int) ceil( $matched / $per_page ) );
$current_page = min( $requested_page, $pages );
$visible = array_slice( $items, ( $current_page - 1 ) * $per_page, $per_page );
$pagination_args = array( 'category' => $slug, 'sort' => $sort );
if ( $filter !== '' ) { $pagination_args['filter'] = $filter; }
$ship_tab_url = static function ( string $tab_view, string $filter ) use ( $slug ) {
	$args = array( 'category' => $slug );
	if ( $tab_view !== 'all' ) { $args['view'] = $tab_view; }
	if ( $filter !== '' ) { $args['filter'] = $filter; }
	return ussalmc_atlas_url( $args );
};
?>
<section class="atlas-listing" aria-labelledby="atlas-listing-title">
	<nav class="atlas-breadcrumb" aria-label="Breadcrumb"><a href="<?php echo esc_url( home_url( '/' ) ); ?>">Explore</a><span aria-hidden="true">/</span><a href="<?php echo esc_url( ussalmc_atlas_url() ); ?>">Knowledge base</a><span aria-hidden="true">/</span><span aria-current="page"><?php echo esc_html( $is_ships ? 'Ships' : $label ); ?></span></nav>
	<header class="atlas-listing-head"><div><span class="atlas-eyebrow">THE USSA SHARED ARCHIVE / <?php echo esc_html( strtoupper( $label ) ); ?></span><h1 id="atlas-listing-title"><?php echo esc_html( $is_ships ? 'Find your next ship.' : $label ); ?></h1><p><?php echo esc_html( $is_ships ? 'From your first flight to your next flagship. Explore ships, compare the essentials, and get to know what you fly.' : 'Explore the knowledge base. Every detail starts with a source.' ); ?></p></div><?php if ( empty( $error ) ) : ?><span class="atlas-count"><?php echo esc_html( number_format_i18n( $all_count ) . ( $is_ships ? ' ships in the archive' : ' entries in the archive' ) ); ?></span><?php endif; ?></header>
	<?php if ( ! empty( $error ) ) : ?>
		<p class="atlas-empty" role="status">This part of the archive is temporarily unavailable. Please try again shortly.</p>
	<?php else : ?>
		<?php if ( $is_ships ) : ?>
			<nav class="atlas-ship-tabs" aria-label="Browse ships by">
				<a class="<?php echo $view === 'all' ? 'active' : ''; ?>" href="<?php echo esc_url( $ship_tab_url( 'all', $filter ) ); ?>">All ships</a>
				<a class="<?php echo $view === 'manufacturer' ? 'active' : ''; ?>" href="<?php echo esc_url( $ship_tab_url( 'manufacturer', $filter ) ); ?>">By manufacturer</a>
				<a class="<?php echo $view === 'role' ? 'active' : ''; ?>" href="<?php echo esc_url( $ship_tab_url( 'role', $filter ) ); ?>">By role</a>
			</nav>
		<?php endif; ?>
		<form class="atlas-filter" method="get" action="<?php echo esc_url( ussalmc_atlas_url() ); ?>" role="search" aria-label="Filter <?php echo esc_attr( $label ); ?>">
			<input type="hidden" name="category" value="<?php echo esc_attr( $slug ); ?>">
			<?php if ( $view !== 'all' ) : ?><input type="hidden" name="view" value="<?php echo esc_attr( $view ); ?>"><?php endif; ?>
			<label for="atlas-category-filter"><?php echo $is_ships ? 'Find a ship' : 'Find an entry'; ?><input id="atlas-category-filter" type="search" name="filter" value="<?php echo esc_attr( $filter ); ?>" placeholder="<?php echo $is_ships ? 'Search ships by name…' : 'Search this category…'; ?>"></label>
			<?php if ( $view === 'all' ) : ?>
				<label for="atlas-category-sort">Sort by<select id="atlas-category-sort" name="sort"><option value="az" <?php selected( $sort, 'az' ); ?>>Name: A–Z</option><option value="za" <?php selected( $sort, 'za' ); ?>>Name: Z–A</option></select></label>
			<?php endif; ?>
			<button type="submit">Apply</button><?php if ( $filter !== '' || $sort !== 'az' ) : ?><a href="<?php echo esc_url( $ship_tab_url( $view, '' ) ); ?>">Reset</a><?php endif; ?>
		</form>
		<?php if ( $view !== 'all' ) : ?>
			<div class="atlas-listing-meta" aria-live="polite"><span><?php echo esc_html( $matched ? number_format_i18n( $matched ) . ' ships, grouped by ' . $view : 'No matching entries' ); ?></span><span>Images and specifications from the knowledge base</span></div>
			<?php if ( ! $groups ) : ?>
				<div class="atlas-empty"><h2>No matches this time.</h2><p>Try a shorter name or reset your search to browse everything.</p><a href="<?php echo esc_url( $ship_tab_url( $view, '' ) ); ?>">Browse this category ↗︎</a></div>
			<?php else : ?>
				<?php foreach ( $groups as $group_label => $group_items ) : ?>
					<section class="atlas-group-section">
						<h2 class="atlas-group-heading"><?php echo esc_html( $group_label ); ?> <span class="atlas-group-count"><?php echo esc_html( number_format_i18n( count( $group_items ) ) ); ?></span></h2>
						<div class="atlas-entity-grid">
							<?php foreach ( $group_items as $item ) : $render_card( $item ); endforeach; ?>
						</div>
					</section>
				<?php endforeach; ?>
			<?php endif; ?>
		<?php else : ?>
		<div class="atlas-listing-meta" aria-live="polite"><span><?php echo esc_html( $matched ? 'Showing ' . ( ( $current_page - 1 ) * $per_page + 1 ) . '–' . min( $current_page * $per_page, $matched ) . ' of ' . number_format_i18n( $matched ) : 'No matching entries' ); ?></span><span>Images and specifications from the knowledge base</span></div>
		<?php if ( ! $visible ) : ?>
			<div class="atlas-empty"><h2><?php echo $filter !== '' ? 'No matches this time.' : 'This part of the archive is taking shape.'; ?></h2><p><?php echo $filter !== '' ? 'Try a shorter name or reset your search to browse everything.' : 'Entries will appear here as they are added to the knowledge base.'; ?></p><a href="<?php echo esc_url( ussalmc_atlas_url( array( 'category' => $slug ) ) ); ?>">Browse this category ↗︎</a></div>
		<?php else : ?>
			<div class="atlas-entity-grid">
				<?php foreach ( $visible as $item ) : $render_card( $item ); endforeach; ?>
			</div>
			<?php if ( $pages > 1 ) : ?><nav class="atlas-pagination" aria-label="Category pages"><?php if ( $current_page > 1 ) : ?><a rel="prev" href="<?php echo esc_url( ussalmc_atlas_url( array_merge( $pagination_args, array( 'kb_page' => $current_page - 1 ) ) ) ); ?>">← Previous</a><?php endif; ?><span>Page <?php echo esc_html( $current_page . ' of ' . $pages ); ?></span><?php if ( $current_page < $pages ) : ?><a rel="next" href="<?php echo esc_url( ussalmc_atlas_url( array_merge( $pagination_args, array( 'kb_page' => $current_page + 1 ) ) ) ); ?>">Next →</a><?php endif; ?></nav><?php endif; ?>
		<?php endif; ?>
		<?php endif; ?>
	<?php endif; ?>
	<a class="atlas-back" href="<?php echo esc_url( ussalmc_atlas_url() ); ?>">← All categories</a>
</section>
