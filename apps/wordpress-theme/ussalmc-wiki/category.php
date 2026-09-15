<?php
/**
 * USSALMC Theme override — wiki CATEGORY view.
 * Overrides ussalmc-wiki/templates/category.php.
 * Card-per-entity listing (image + name + category tag + stat chips where the
 * entity actually has the relevant attributes). No inline <style> here —
 * styling lives in style.css (.ussalmc-entcard*) using the theme's design
 * tokens, same pattern as the other wiki template overrides.
 * Vars: $categories (array cat=>[{id,name,category,attributes,thumb}]), $total, $error, $active.
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
			<a href="<?php echo esc_url( home_url( '/wiki/' ) ); ?>">KNOWLEDGE BASE</a>
			<b>/ CATEGORIES</b> · <?php echo esc_html( $total ); ?> ENTITIES
			<?php if ( $active ) : ?> · FILTER: <b><?php echo esc_html( strtoupper( (string) $active ) ); ?></b><?php endif; ?>
		</div>
		<div class="ussalmc-cats">
			<?php foreach ( $categories as $cat => $items ) :
				if ( $active && $active !== $cat ) { continue; } ?>
				<div class="ussalmc-cat">
					<h3><?php echo esc_html( ucfirst( (string) $cat ) ); ?></h3>
					<span class="n"><?php echo esc_html( count( $items ) ); ?> ENTITIES</span>
					<div class="ussalmc-entcard__grid">
						<?php foreach ( $items as $it ) :
							$href    = add_query_arg( 'entity', rawurlencode( $it['id'] ), home_url( '/wiki/' ) );
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
