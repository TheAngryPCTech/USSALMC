<?php
/** Shared Stellar Atlas presentation helpers. All content comes from the KB. */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function ussalmc_atlas_url( array $args = array() ): string {
	return $args ? add_query_arg( $args, home_url( '/wiki/' ) ) : home_url( '/wiki/' );
}

function ussalmc_atlas_image( array $entity ): ?array {
	$images = is_array( $entity['images'] ?? null ) ? $entity['images'] : array();
	$valid = array_values( array_filter( $images, static function ( $image ) {
		return is_array( $image ) && is_string( $image['url'] ?? null ) && preg_match( '~^https?://~i', $image['url'] );
	} ) );
	foreach ( $valid as $image ) {
		if ( ( $image['role'] ?? '' ) === 'primary' ) { return $image; }
	}
	return $valid[0] ?? null;
}

/** Request-local reuse plus short-lived WP cache; failures are never cached. */
function ussalmc_atlas_recent() {
	static $data;
	if ( isset( $data ) ) { return $data; }
	if ( ! function_exists( 'ussalmc_wiki_api_get' ) ) { return new WP_Error( 'wiki_missing', 'The knowledge base is unavailable.' ); }
	$key = 'ussa_atlas_recent_' . md5( ussalmc_wiki_api_base() );
	$data = get_transient( $key );
	if ( false !== $data ) { return $data; }
	$data = ussalmc_wiki_api_get( '/v1/entities?sort=recent&limit=6' );
	if ( ! is_wp_error( $data ) ) { set_transient( $key, $data, 60 ); }
	return $data;
}

function ussalmc_atlas_categories() {
	static $categories;
	if ( isset( $categories ) ) { return $categories; }
	$categories = function_exists( 'ussalmc_wiki_category_index' ) ? ussalmc_wiki_category_index() : new WP_Error( 'wiki_missing', 'The knowledge base is unavailable.' );
	return $categories;
}

function ussalmc_atlas_category_label( string $slug ): string {
	$categories = ussalmc_atlas_categories();
	if ( ! is_wp_error( $categories ) ) {
		$find = static function ( array $nodes ) use ( &$find, $slug ): ?string {
			foreach ( $nodes as $node ) {
				if ( $node['slug'] === $slug ) { return $node['display_name']; }
				$label = $find( $node['subcategories'] ?? array() );
				if ( $label ) { return $label; }
			}
			return null;
		};
		$label = $find( $categories );
		if ( $label ) { return $label; }
	}
	return ucwords( str_replace( '_', ' ', $slug ) );
}

function ussalmc_atlas_category_card( array $cat ): void {
	$image = $cat['image'] ?? null;
	?>
	<a class="atlas-category" href="<?php echo esc_url( ussalmc_atlas_url( array( 'category' => $cat['slug'] ) ) ); ?>">
		<div class="atlas-category__visual">
			<?php if ( is_array( $image ) && ! empty( $image['url'] ) ) : ?>
				<img src="<?php echo esc_url( $image['url'] ); ?>" alt="<?php echo esc_attr( $image['entity_name'] ?? '' ); ?>" loading="lazy" decoding="async" width="640" height="360">
				<span class="atlas-category__credit"><?php echo esc_html( $image['entity_name'] ?? '' ); ?></span>
			<?php else : ?>
				<span class="atlas-category__placeholder" aria-hidden="true">◇</span>
				<span class="atlas-category__credit">Image not yet available</span>
			<?php endif; ?>
		</div>
		<div class="atlas-category__copy">
			<div class="atlas-category__heading"><h3><?php echo esc_html( $cat['display_name'] ); ?></h3><span aria-hidden="true">↗︎</span></div>
			<p><?php echo esc_html( wp_trim_words( $cat['description'] ?? '', 14 ) ); ?></p>
			<span class="atlas-category__meta"><?php
			if ( $cat['slug'] === 'trade_route' ) {
				echo esc_html( ussalmc_wiki_freshness_label( $cat['freshness'] ?? null ) );
			} else {
				echo esc_html( number_format_i18n( (int) ( $cat['entry_count'] ?? 0 ) ) . ' entries' );
			}
			?></span>
		</div>
	</a>
	<?php
}

function ussalmc_atlas_search_form( string $query = '', string $id = 'atlas-search' ): void {
	?>
	<form class="atlas-search" role="search" method="get" action="<?php echo esc_url( ussalmc_atlas_url() ); ?>">
		<label class="atlas-sr-only" for="<?php echo esc_attr( $id ); ?>">Search the USSA knowledge base</label>
		<span aria-hidden="true" class="atlas-search__icon">⌕</span>
		<input id="<?php echo esc_attr( $id ); ?>" type="search" name="q" value="<?php echo esc_attr( $query ); ?>" placeholder="Search ships, places, equipment, guides…" required>
		<button type="submit">Search <span aria-hidden="true">↗︎</span></button>
	</form>
	<?php
}

/** Editorial tile images refer to a real entity and preserve its name. */
function ussalmc_atlas_editorial_image( string $id ): ?array {
	if ( ! function_exists( 'ussalmc_wiki_fetch_entity' ) ) { return null; }
	$key = 'ussa_atlas_image_' . md5( ussalmc_wiki_api_base() . $id );
	$cached = get_transient( $key );
	if ( false !== $cached ) { return $cached; }
	$entry = ussalmc_wiki_fetch_entity( $id );
	if ( is_wp_error( $entry ) || ( $entry['status'] ?? '' ) === 'removed' ) { return null; }
	$image = ussalmc_atlas_image( $entry );
	if ( ! $image ) { return null; }
	$result = array( 'url' => $image['url'], 'entity_id' => $id, 'entity_name' => $entry['name'] ?? '' );
	set_transient( $key, $result, 300 );
	return $result;
}
