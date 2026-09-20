<?php
/**
 * USSALMC Wiki — default SIG IDENT template ("Sig Ident", Phase 23).
 * Vars: $sig (string), $result (array|null decoded /v1/mining/signature body), $error (string|null).
 * Themes override at: <theme>/ussalmc-wiki/sig-ident.php
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$action = esc_url( remove_query_arg( array( 'entity', 'category' ) ) );
?>
<div class="ussalmc-search ussalmc-sig-ident">
	<form class="ussalmc-search__form" method="get" action="<?php echo $action; ?>">
		<input class="ussalmc-search__input" type="text" name="sig" value="<?php echo esc_attr( $sig ); ?>" placeholder="Scan value: 8600, ~8600, or 8000-9000" aria-label="Mining scan signature">
		<button class="btn-hud primary ussalmc-search__btn" type="submit">IDENTIFY</button>
	</form>

	<?php if ( ! empty( $error ) ) : ?>
		<div class="ussalmc-entity ussalmc-error">USSALMC: <?php echo esc_html( $error ); ?></div>
	<?php elseif ( $sig === '' ) : ?>
		<p class="ussalmc-content">Enter a scan signature value from the in-game mining scanner to identify the ore. Exact match, "~value" for ±10% tolerance, or "min-max" for a range — same as scmdb.net's own tool.</p>
	<?php elseif ( empty( $result['matches'] ) ) : ?>
		<p class="ussalmc-content">No known ore matches signature “<?php echo esc_html( $sig ); ?>”.</p>
	<?php else : ?>
		<p class="ussalmc-content" style="opacity:.75">
			<?php echo esc_html( $result['count'] ); ?> match<?php echo ( (int) $result['count'] === 1 ) ? '' : 'es'; ?>
			for “<?php echo esc_html( $sig ); ?>” (<?php echo esc_html( $result['mode'] ); ?>, range <?php echo esc_html( number_format( (float) $result['range']['lo'] ) ); ?>–<?php echo esc_html( number_format( (float) $result['range']['hi'] ) ); ?>)
		</p>
		<?php foreach ( $result['matches'] as $m ) :
			$href = add_query_arg( 'entity', rawurlencode( $m['commodity_id'] ?? '' ), remove_query_arg( array( 'category' ) ) );
			?>
			<a class="ussalmc-result" href="<?php echo esc_url( $href ); ?>" style="text-decoration:none;color:inherit">
				<div>
					<div class="ussalmc-result__name"><?php echo esc_html( $m['commodity_name'] ?? $m['commodity_id'] ?? '—' ); ?></div>
					<div class="ussalmc-result__sum">matched <?php echo esc_html( number_format( (float) ( $m['matched_value'] ?? 0 ) ) ); ?> (tier <?php echo esc_html( $m['tier'] ?? '?' ); ?> of <?php echo esc_html( $m['tier_count'] ?? '?' ); ?>) — confidence: <?php echo esc_html( $m['confidence'] ?? 'unknown' ); ?></div>
				</div>
			</a>
		<?php endforeach; ?>
		<?php if ( ! empty( $result['source_note'] ) ) : ?>
			<p class="ussalmc-content" style="opacity:.6;font-size:.85em;margin-top:1em"><?php echo esc_html( $result['source_note'] ); ?></p>
		<?php endif; ?>
	<?php endif; ?>
</div>
