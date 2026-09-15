<?php
/**
 * USSALMC Wiki — default CATEGORY template.
 * Card-per-entity listing (image + name + category tag + stat chips where the
 * entity actually has the relevant attributes — never a fabricated chip).
 * Vars: $categories (array cat=>[{id,name,category,attributes,thumb}]), $total (int),
 *       $error (string|null), $active (string|null current category filter).
 * Themes override at: <theme>/ussalmc-wiki/category.php
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="ussalmc-catview">
	<?php if ( ! empty( $error ) ) : ?>
		<div class="ussalmc-entity ussalmc-error">USSALMC: <?php echo esc_html( $error ); ?></div>
	<?php else : ?>
		<div class="ussalmc-entity__breadcrumb" style="margin-bottom:16px">
			KNOWLEDGE BASE <b>/ CATEGORIES</b> · <?php echo esc_html( $total ); ?> ENTITIES
		</div>
		<div class="ussalmc-cats">
			<?php foreach ( $categories as $cat => $items ) :
				if ( $active && $active !== $cat ) { continue; } ?>
				<div class="ussalmc-cat">
					<h3><?php echo esc_html( ucfirst( (string) $cat ) ); ?></h3>
					<span class="n"><?php echo esc_html( count( $items ) ); ?> ENTITIES</span>
					<div class="ussalmc-entcard__grid">
						<?php foreach ( $items as $it ) :
							$href    = add_query_arg( 'entity', rawurlencode( $it['id'] ), remove_query_arg( array( 'q', 'category' ) ) );
							$itemCat = $it['category'] ?? $cat;
							$chips   = ussalmc_wiki_category_stat_chips( $itemCat, $it['attributes'] ?? array() );
							?>
							<a class="ussalmc-entcard" href="<?php echo esc_url( $href ); ?>">
								<?php if ( ! empty( $it['thumb'] ) ) : ?>
									<img class="ussalmc-entcard__thumb" src="<?php echo esc_url( $it['thumb'] ); ?>" alt="" loading="lazy" />
								<?php else : ?>
									<span class="ussalmc-entcard__thumb ussalmc-entcard__thumb--placeholder" aria-hidden="true"><?php echo esc_html( mb_strtoupper( mb_substr( (string) $it['name'], 0, 1 ) ) ); ?></span>
								<?php endif; ?>
								<span class="ussalmc-entcard__body">
									<span class="ussalmc-entcard__name"><?php echo esc_html( $it['name'] ); ?></span>
									<span class="ussalmc-entcard__tag"><?php echo esc_html( ucfirst( str_replace( '_', ' ', $itemCat ) ) ); ?></span>
									<?php if ( $chips ) : ?>
										<span class="ussalmc-entcard__stats">
											<?php foreach ( $chips as $c ) : ?>
												<span class="ussalmc-cat__chip"><?php echo esc_html( $c['label'] ); ?>: <?php echo esc_html( $c['value'] ); ?></span>
											<?php endforeach; ?>
										</span>
									<?php endif; ?>
								</span>
							</a>
						<?php endforeach; ?>
					</div>
				</div>
			<?php endforeach; ?>
		</div>
	<?php endif; ?>
</div>
<style>
	/* Generic baseline so this is usable on any theme; the active theme
	   restyles these same classes via its own ussalmc-wiki/category.php
	   override + stylesheet. Fills all available width on any viewport —
	   auto-fill adds/removes columns rather than capping total width. */
	.ussalmc-entcard__grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px; width:100%; }
	.ussalmc-entcard{ display:flex; flex-direction:column; border:1px solid #ddd; border-radius:6px; overflow:hidden; text-decoration:none; color:inherit; }
	.ussalmc-entcard__thumb{ width:100%; aspect-ratio:16/9; object-fit:cover; background:#eee; }
	.ussalmc-entcard__thumb--placeholder{ display:flex; align-items:center; justify-content:center; font-weight:700; font-size:2em; color:#888; }
	.ussalmc-entcard__body{ display:flex; flex-direction:column; gap:6px; padding:10px 12px; }
	.ussalmc-entcard__name{ font-weight:600; font-size:14px; }
	.ussalmc-entcard__tag{ align-self:flex-start; font-size:0.72em; opacity:0.65; border:1px solid currentColor; border-radius:3px; padding:1px 6px; }
	.ussalmc-entcard__stats{ display:flex; flex-wrap:wrap; gap:8px; }
	.ussalmc-cat__chip{ font-size:0.78em; opacity:0.8; white-space:nowrap; }
</style>
