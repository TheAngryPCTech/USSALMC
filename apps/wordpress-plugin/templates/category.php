<?php
/**
 * USSALMC Wiki — default CATEGORY template.
 * Vars: $categories (array cat=>[{id,name}]), $total (int), $error (string|null),
 *       $active (string|null current category filter).
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
					<ul>
						<?php foreach ( array_slice( $items, 0, 12 ) as $it ) :
							$href = add_query_arg( 'entity', rawurlencode( $it['id'] ), remove_query_arg( array( 'q', 'category' ) ) );
							?>
							<li><a href="<?php echo esc_url( $href ); ?>"><?php echo esc_html( $it['name'] ); ?></a></li>
						<?php endforeach; ?>
						<?php if ( count( $items ) > 12 ) : ?>
							<li><a href="<?php echo esc_url( add_query_arg( 'category', rawurlencode( $cat ), remove_query_arg( array( 'q', 'entity' ) ) ) ); ?>">+ <?php echo esc_html( count( $items ) - 12 ); ?> more…</a></li>
						<?php endif; ?>
					</ul>
				</div>
			<?php endforeach; ?>
		</div>
	<?php endif; ?>
</div>
