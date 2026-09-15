<?php
/**
 * USSALMC Wiki — default CATEGORY INDEX template (card grid).
 * One card per top-level category: name, entry count (or, for trade_route,
 * its own freshness), subcategory count when >0. Clicking a card links to
 * that category's existing listing view (templates/category.php via
 * ?category=). Subcategories are NOT broken into their own cards here — they
 * stay nested under their parent, same as the listing view.
 *
 * Vars: $categories (array of {slug, display_name, description, entry_count,
 *       subcategory_count, subcategories, freshness}), $error (string|null).
 *
 * Generic baseline styling only — no theme colors/fonts/corner treatment
 * hardcoded here. Themes override at: <theme>/ussalmc-wiki/category-grid.php
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="ussalmc-catgrid">
	<?php if ( ! empty( $error ) ) : ?>
		<div class="ussalmc-entity ussalmc-error">USSALMC: <?php echo esc_html( $error ); ?></div>
	<?php elseif ( empty( $categories ) ) : ?>
		<div class="ussalmc-catgrid__empty">No categories yet.</div>
	<?php else : ?>
		<div class="ussalmc-catgrid__grid">
			<?php foreach ( $categories as $cat ) :
				$href      = add_query_arg( 'category', rawurlencode( $cat['slug'] ), remove_query_arg( array( 'q', 'entity' ) ) );
				$is_volatile = isset( $cat['freshness'] ) && $cat['freshness'] !== null;
				?>
				<a class="ussalmc-catcard" href="<?php echo esc_url( $href ); ?>">
					<span class="ussalmc-catcard__icon" aria-hidden="true"><?php echo esc_html( mb_strtoupper( mb_substr( (string) $cat['display_name'], 0, 1 ) ) ); ?></span>
					<span class="ussalmc-catcard__name"><?php echo esc_html( $cat['display_name'] ); ?></span>
					<span class="ussalmc-catcard__meta">
						<?php if ( $is_volatile ) : ?>
							<?php echo esc_html( ussalmc_wiki_freshness_label( $cat['freshness'] ) ); ?>
						<?php else : ?>
							<?php echo esc_html( (int) $cat['entry_count'] ); ?> entries
						<?php endif; ?>
					</span>
					<?php if ( ! empty( $cat['subcategory_count'] ) ) : ?>
						<span class="ussalmc-catcard__sub"><?php echo esc_html( (int) $cat['subcategory_count'] ); ?> subcategories</span>
					<?php endif; ?>
				</a>
			<?php endforeach; ?>
		</div>
	<?php endif; ?>
</div>
<style>
	/* Generic baseline so this is usable on any theme; the active theme
	   restyles these same classes (colors/fonts/corner treatment) via its own
	   ussalmc-wiki/category-grid.php override + stylesheet. */
	.ussalmc-catgrid__grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px; }
	.ussalmc-catcard{ display:flex; flex-direction:column; gap:6px; padding:16px; border:1px solid #ccc; border-radius:6px; text-decoration:none; color:inherit; }
	.ussalmc-catcard__icon{ display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:4px; background:#eee; font-weight:600; }
	.ussalmc-catcard__name{ font-weight:600; }
	.ussalmc-catcard__meta{ font-size:0.85em; opacity:0.75; }
	.ussalmc-catcard__sub{ font-size:0.8em; opacity:0.6; }
	@media (max-width:480px){
		.ussalmc-catgrid__grid{ grid-template-columns:1fr; }
	}
</style>
