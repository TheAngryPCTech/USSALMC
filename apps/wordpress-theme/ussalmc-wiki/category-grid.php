<?php
/**
 * USSALMC Theme override — wiki CATEGORY INDEX view (card grid).
 * Overrides ussalmc-wiki/templates/category-grid.php. No inline <style> here —
 * styling lives in style.css (.ussalmc-catgrid*) using the theme's design
 * tokens, same pattern as ussalmc-wiki/category.php.
 * Vars: $categories, $error.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="ussalmc-catgrid">
	<?php if ( ! empty( $error ) ) : ?>
		<div class="ussalmc-entity ussalmc-error">USSALMC: <?php echo esc_html( $error ); ?></div>
	<?php else : ?>
		<div class="ussalmc-entity__breadcrumb" style="margin-bottom:16px">
			KNOWLEDGE BASE <b>/ CATEGORIES</b>
		</div>
		<?php if ( empty( $categories ) ) : ?>
			<div class="ussalmc-catgrid__empty">No categories yet.</div>
		<?php else : ?>
			<div class="ussalmc-catgrid__grid">
				<?php foreach ( $categories as $cat ) :
					$href        = add_query_arg( 'category', rawurlencode( $cat['slug'] ), home_url( '/wiki/' ) );
					$is_volatile = isset( $cat['freshness'] ) && $cat['freshness'] !== null;
					?>
					<a class="ussalmc-catcard" href="<?php echo esc_url( $href ); ?>">
						<span class="ussalmc-catcard__icon" aria-hidden="true"><?php echo esc_html( mb_strtoupper( mb_substr( (string) $cat['display_name'], 0, 1 ) ) ); ?></span>
						<span class="ussalmc-catcard__name"><?php echo esc_html( $cat['display_name'] ); ?></span>
						<span class="ussalmc-catcard__meta<?php echo $is_volatile ? ' ussalmc-catcard__meta--volatile' : ''; ?>">
							<?php if ( $is_volatile ) : ?>
								<?php echo esc_html( ussalmc_wiki_freshness_label( $cat['freshness'] ) ); ?>
							<?php else : ?>
								<?php echo esc_html( (int) $cat['entry_count'] ); ?> ENTRIES
							<?php endif; ?>
						</span>
						<?php if ( ! empty( $cat['subcategory_count'] ) ) : ?>
							<span class="ussalmc-catcard__sub"><?php echo esc_html( (int) $cat['subcategory_count'] ); ?> subcategories</span>
						<?php endif; ?>
					</a>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	<?php endif; ?>
</div>
