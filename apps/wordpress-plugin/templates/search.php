<?php
/**
 * USSALMC Wiki — default SEARCH template.
 * Vars: $query (string), $results (array), $error (string|null).
 * Themes override at: <theme>/ussalmc-wiki/search.php
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$action = esc_url( remove_query_arg( array( 'entity', 'category' ) ) );
?>
<div class="ussalmc-search">
	<form class="ussalmc-search__form" method="get" action="<?php echo $action; ?>">
		<input class="ussalmc-search__input" type="search" name="q" value="<?php echo esc_attr( $query ); ?>" placeholder="Search the knowledge base…" aria-label="Search">
		<button class="btn-hud primary ussalmc-search__btn" type="submit">SEARCH</button>
	</form>

	<?php if ( ! empty( $error ) ) : ?>
		<div class="ussalmc-entity ussalmc-error">USSALMC: <?php echo esc_html( $error ); ?></div>
	<?php elseif ( $query === '' ) : ?>
		<p class="ussalmc-content">Enter a query to search entities (hybrid keyword + semantic).</p>
	<?php elseif ( empty( $results ) ) : ?>
		<p class="ussalmc-content">No results for “<?php echo esc_html( $query ); ?>”.</p>
	<?php else : ?>
		<?php foreach ( $results as $r ) :
			$href = add_query_arg( 'entity', rawurlencode( $r['id'] ?? '' ), remove_query_arg( array( 'category' ) ) );
			?>
			<a class="ussalmc-result" href="<?php echo esc_url( $href ); ?>" style="text-decoration:none;color:inherit">
				<div>
					<div class="ussalmc-result__name"><?php echo esc_html( $r['name'] ?? $r['id'] ?? '—' ); ?></div>
					<?php if ( ! empty( $r['summary'] ) ) : ?><div class="ussalmc-result__sum"><?php echo esc_html( wp_trim_words( $r['summary'], 24 ) ); ?></div><?php endif; ?>
				</div>
				<div class="ussalmc-result__score"><?php echo esc_html( number_format( (float) ( $r['score'] ?? 0 ), 3 ) ); ?></div>
			</a>
		<?php endforeach; ?>
	<?php endif; ?>
</div>
