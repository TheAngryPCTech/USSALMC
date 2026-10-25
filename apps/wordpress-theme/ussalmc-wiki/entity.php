<?php
/**
 * USSALMC Theme override — wiki ENTITY card.
 * Overrides ussalmc-wiki/templates/entity.php via the plugin's template loader.
 * Full HUD treatment: clipped panel, corner brackets, confidence/source badges,
 * category breadcrumb, cross-reference links — all in the theme's visual language.
 * Vars: $entity, $relations, $confidence.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$name    = $entity['name'] ?? ( $entity['id'] ?? 'Unknown' );
$summary = $entity['summary'] ?? '';
$gv      = $entity['game_version'] ?? 'n/a';
$cat     = $entity['attributes']['category'] ?? ( $entity['type'] ?? 'entity' );
$src     = '';
if ( isset( $entity['source'] ) && is_array( $entity['source'] ) ) {
	$src = $entity['source']['origin'] ?? ( $entity['source']['url'] ?? '' );
}
$rels = ( is_array( $relations ) && ! empty( $relations['relations'] ) ) ? $relations['relations'] : array();

// Images: primary first (fall back to first available), rest as gallery thumbs.
$images = ( isset( $entity['images'] ) && is_array( $entity['images'] ) ) ? $entity['images'] : array();
$hero   = null;
foreach ( $images as $img ) {
	if ( is_array( $img ) && ( $img['role'] ?? '' ) === 'primary' && is_string( $img['url'] ?? null ) && $img['url'] !== '' ) { $hero = $img; break; }
}
if ( ! $hero ) {
	foreach ( $images as $img ) { if ( is_array( $img ) && is_string( $img['url'] ?? null ) && $img['url'] !== '' ) { $hero = $img; break; } }
}

// Attributes/stats: skip category (already shown in the breadcrumb), the
// uex_* trade fields (own dedicated panel below instead), and empty values.
$attrs = ( isset( $entity['attributes'] ) && is_array( $entity['attributes'] ) ) ? $entity['attributes'] : array();
// Every commodity page shows the SAME set of trade-data sections in the SAME
// order, whether or not this particular commodity has UEX data — a section
// renders a real chart/table when data exists, or a plain "no data" line
// when it doesn't, rather than disappearing. Matches UEX's own commodity
// page layout (verified live against uexcorp.space/commodities/info/...),
// which always shows the full stat skeleton even for a thinly-traded
// commodity, so every commodity in the KB reports the same statistics
// consistently instead of richer/thinner pages looking structurally
// different depending on how much real data happens to exist.
$is_commodity  = ( $cat === 'commodity' );
$trade         = ussalmc_wiki_uex_trade_data( $attrs );
$profit        = $trade ? ussalmc_wiki_uex_profit_metrics( $trade ) : array( 'profit' => null, 'margin' => null, 'roi' => null );
$history       = $trade ? ussalmc_wiki_uex_price_history( $trade['commodity_id'] ?? null, $trade['sell_terminal_id'] ?? null, 20 ) : array();
$sparkline     = $history ? ussalmc_wiki_render_uex_sparkline_svg( $history, 'price_sell' ) : '';
$buy_history   = $trade ? ussalmc_wiki_uex_price_history( $trade['commodity_id'] ?? null, $trade['buy_terminal_id'] ?? null, 20 ) : array();
$buy_sparkline = $buy_history ? ussalmc_wiki_render_uex_sparkline_svg( $buy_history, 'price_buy' ) : '';
$all_terminals = $trade ? ussalmc_wiki_uex_all_commodity_terminals( $trade['commodity_id'] ?? null, 60 ) : array();
$stats = array();
foreach ( $attrs as $k => $v ) {
	if ( $k === 'category' ) { continue; }
	// uex_* fields are skipped here ONLY for commodities, which get their own
	// dedicated LIVE TRADE DATA panel (below) showing the same data properly
	// formatted with an age label. Non-commodity entities carrying uex_* data
	// (e.g. trade_route, whose only source IS UEX) have no such panel, so
	// hiding them here would silently drop their freshness info entirely —
	// violating the volatile-data rule that this data must always show its
	// age. `uex_route_id`/`commodity_entity_id` are internal linkage, not
	// reader-facing facts, so those two stay hidden for every entity type.
	if ( $is_commodity && strpos( (string) $k, 'uex_' ) === 0 ) { continue; }
	if ( in_array( $k, array( 'uex_route_id', 'commodity_entity_id', 'uex_item_id', 'uex_best_buy_terminal_id', 'uex_best_sell_terminal_id' ), true ) ) { continue; }
	if ( is_array( $v ) || is_object( $v ) ) { continue; }
	// Fields ending _raw are internal placeholders for a UI column whose exact
	// meaning wasn't confidently determined at import time (see
	// import-scmdb-missions.ts) — showing them to a reader as if they were
	// understood facts would be worse than not showing them at all.
	if ( substr( (string) $k, -4 ) === '_raw' ) { continue; }
	// PHP casts false to "" and true to "1" — without this, a false value is
	// silently indistinguishable from "no value" (dropped below) and a true
	// value shows the unhelpful literal "1".
	if ( is_bool( $v ) ) { $v = $v ? 'Yes' : 'No'; }
	$v = trim( (string) $v );
	if ( $v === '' ) { continue; }
	if ( $k === 'uex_last_updated' ) {
		$stats[] = array( 'key' => $k, 'label' => 'LAST OBSERVED', 'value' => ussalmc_wiki_time_ago_from_iso( $v ) );
		continue;
	}
	$label   = strtoupper( str_replace( '_', ' ', (string) $k ) );
	$stats[] = array( 'key' => (string) $k, 'label' => $label, 'value' => $v );
}
?>
<div class="ussalmc-entity">
	<span class="corner tl"></span><span class="corner br"></span>

	<div class="ussalmc-entity__breadcrumb">
		<a href="<?php echo esc_url( home_url( '/wiki/' ) ); ?>">KNOWLEDGE BASE</a>
		<b>/ <a href="<?php echo esc_url( add_query_arg( 'category', rawurlencode( (string) $cat ), home_url( '/wiki/' ) ) ); ?>"><?php echo esc_html( strtoupper( (string) $cat ) ); ?></a> / <?php echo esc_html( $name ); ?></b>
	</div>

	<h1 class="ussalmc-entity__name"><?php echo esc_html( $name ); ?></h1>
	<?php if ( $summary ) : ?>
		<p class="ussalmc-entity__summary"><?php echo esc_html( $summary ); ?><?php echo ussalmc_wiki_field_actions( $entity['id'] ?? '', 'summary', $summary ); ?></p>
	<?php endif; ?>

	<?php $body_html = ! empty( $entity['body'] ) ? ussalmc_wiki_render_body_html( (string) $entity['body'] ) : ''; ?>
	<?php if ( $body_html ) : ?>
		<div class="ussalmc-entity__body"><?php echo $body_html; // phpcs:ignore -- built entirely from our own esc_html'd text, see ussalmc_wiki_render_body_html() ?></div>
	<?php endif; ?>

	<?php if ( $hero ) : ?>
		<figure class="ussalmc-entity__media">
			<img class="ussalmc-entity__hero" src="<?php echo esc_url( $hero['url'] ); ?>" <?php if ( ! empty( $hero['full_url'] ) ) : ?>data-full="<?php echo esc_url( $hero['full_url'] ); ?>"<?php endif; ?> alt="<?php echo esc_attr( $hero['caption'] ?? $name ); ?>" loading="lazy" />
			<?php if ( ! empty( $hero['caption'] ) ) : ?><figcaption><?php echo esc_html( $hero['caption'] ); ?></figcaption><?php endif; ?>
		</figure>
		<?php if ( count( $images ) > 1 ) : ?>
			<div class="ussalmc-entity__gallery">
				<?php foreach ( $images as $img ) :
					if ( ! is_array( $img ) || ! is_string( $img['url'] ?? null ) || $img['url'] === '' || $img['url'] === $hero['url'] ) { continue; }
					?>
					<a class="ussalmc-thumb" href="<?php echo esc_url( $img['url'] ); ?>" <?php if ( ! empty( $img['full_url'] ) ) : ?>data-full="<?php echo esc_url( $img['full_url'] ); ?>"<?php endif; ?> target="_blank" rel="noopener">
						<img src="<?php echo esc_url( $img['url'] ); ?>" alt="<?php echo esc_attr( $img['caption'] ?? $name ); ?>" loading="lazy" />
					</a>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	<?php else : ?>
		<figure class="ussalmc-entity__media ussalmc-entity__media--empty">
			<div class="ussalmc-novisual">
				<?php echo ussalmc_wiki_render_novisual_icon(); // phpcs:ignore -- static inline SVG, no dynamic data ?>
				<span class="ussalmc-novisual__label">No Visual Data</span>
			</div>
		</figure>
	<?php endif; ?>

	<?php if ( $stats ) : ?>
		<div class="ussalmc-stats">
			<div class="ussalmc-stats__lbl">SPECIFICATIONS</div>
			<dl class="ussalmc-stats__grid">
				<?php foreach ( $stats as $s ) : ?>
					<div class="ussalmc-stat">
						<dt><?php echo esc_html( $s['label'] ); ?></dt>
						<dd><?php echo esc_html( $s['value'] ); ?><?php echo ussalmc_wiki_field_actions( $entity['id'] ?? '', 'attr:' . $s['key'], $s['value'] ); ?></dd>
					</div>
				<?php endforeach; ?>
			</dl>
		</div>
	<?php endif; ?>

	<?php if ( $is_commodity ) : ?>
		<div class="ussalmc-trade-data">
			<div class="ussalmc-trade-data__lbl">LIVE TRADE DATA</div>
			<?php if ( $trade ) : ?>
				<div class="ussalmc-trade-data__age"><?php echo esc_html( $trade['updated_label'] ); ?></div>
				<dl class="ussalmc-trade-data__grid">
					<div class="ussalmc-stat">
						<dt>BEST SELL</dt>
						<dd><?php echo $trade['sell_price'] !== null ? esc_html( number_format( (float) $trade['sell_price'] ) ) . ' aUEC' : '—'; ?><?php if ( $trade['sell_terminal'] ) : ?> <span class="ussalmc-trade-data__at">@ <?php echo esc_html( $trade['sell_terminal'] ); ?></span><?php endif; ?></dd>
					</div>
					<div class="ussalmc-stat">
						<dt>BEST BUY</dt>
						<dd><?php echo $trade['buy_price'] !== null ? esc_html( number_format( (float) $trade['buy_price'] ) ) . ' aUEC' : '—'; ?><?php if ( $trade['buy_terminal'] ) : ?> <span class="ussalmc-trade-data__at">@ <?php echo esc_html( $trade['buy_terminal'] ); ?></span><?php endif; ?></dd>
					</div>
					<div class="ussalmc-stat">
						<dt>TERMINALS TRADING</dt>
						<dd><?php echo $trade['terminal_count'] !== null ? esc_html( (int) $trade['terminal_count'] ) : '—'; ?></dd>
					</div>
					<div class="ussalmc-stat">
						<dt>PROFIT / SCU</dt>
						<dd><?php echo $profit['profit'] !== null ? esc_html( number_format( (float) $profit['profit'] ) ) . ' aUEC' : '—'; ?></dd>
					</div>
					<div class="ussalmc-stat">
						<dt>MARGIN</dt>
						<dd><?php echo $profit['margin'] !== null ? esc_html( number_format( (float) $profit['margin'], 1 ) ) . '%' : '—'; ?></dd>
					</div>
					<div class="ussalmc-stat">
						<dt>ROI</dt>
						<dd><?php echo $profit['roi'] !== null ? esc_html( number_format( (float) $profit['roi'], 1 ) ) . '%' : '—'; ?></dd>
					</div>
				</dl>
			<?php else : ?>
				<div class="ussalmc-trade-data__empty">No live trade data available for this commodity yet.</div>
			<?php endif; ?>
			<div class="ussalmc-trade-data__note">Source: UEX Corp (unofficial, community-maintained) — prices change frequently; verify age before relying on this.</div>
		</div>

		<div class="ussalmc-trade-chart">
			<div class="ussalmc-trade-chart__lbl">SELL PRICE TREND<?php if ( $trade['sell_terminal'] ?? null ) : ?> <span class="ussalmc-trade-chart__at">@ <?php echo esc_html( $trade['sell_terminal'] ); ?></span><?php endif; ?></div>
			<?php if ( $sparkline ) : ?>
				<div class="ussalmc-trade-chart__svg"><?php echo $sparkline; // phpcs:ignore -- built entirely from our own escaped numeric coordinates, see ussalmc_wiki_render_uex_sparkline_svg() ?></div>
				<div class="ussalmc-trade-chart__range">
					<span><?php echo esc_html( number_format( (float) min( array_column( $history, 'price_sell' ) ) ) ); ?> aUEC</span>
					<span><?php echo esc_html( number_format( (float) max( array_column( $history, 'price_sell' ) ) ) ); ?> aUEC</span>
				</div>
			<?php else : ?>
				<div class="ussalmc-trade-data__empty">No sell-price history available yet.</div>
			<?php endif; ?>
		</div>

		<div class="ussalmc-trade-chart">
			<div class="ussalmc-trade-chart__lbl">BUY PRICE TREND<?php if ( $trade['buy_terminal'] ?? null ) : ?> <span class="ussalmc-trade-chart__at">@ <?php echo esc_html( $trade['buy_terminal'] ); ?></span><?php endif; ?></div>
			<?php if ( $buy_sparkline ) : ?>
				<div class="ussalmc-trade-chart__svg"><?php echo $buy_sparkline; // phpcs:ignore -- built entirely from our own escaped numeric coordinates, see ussalmc_wiki_render_uex_sparkline_svg() ?></div>
				<div class="ussalmc-trade-chart__range">
					<span><?php echo esc_html( number_format( (float) min( array_column( $buy_history, 'price_buy' ) ) ) ); ?> aUEC</span>
					<span><?php echo esc_html( number_format( (float) max( array_column( $buy_history, 'price_buy' ) ) ) ); ?> aUEC</span>
				</div>
			<?php else : ?>
				<div class="ussalmc-trade-data__empty">No buy-price history available yet.</div>
			<?php endif; ?>
		</div>

		<div class="ussalmc-trade-locations">
			<div class="ussalmc-trade-locations__lbl">RECENT SELL ACTIVITY &amp; LOCATIONS</div>
			<?php if ( $history ) : ?>
				<table class="ussalmc-trade-locations__table">
					<thead>
						<tr><th>WHEN</th><th>LOCATION</th><th>TERMINAL</th><th>SELL PRICE</th></tr>
					</thead>
					<tbody>
						<?php foreach ( array_reverse( $history ) as $h ) :
							$loc_parts = array_filter( array( $h['star_system'] ?? null, $h['planet'] ?? null, $h['city'] ?? null ) );
							$loc       = implode( ' › ', $loc_parts );
							$when      = $h['date'] ? ussalmc_wiki_time_ago_from_iso( gmdate( 'c', (int) $h['date'] ) ) : '—';
							?>
							<tr>
								<td><?php echo esc_html( str_replace( 'Updated ', '', $when ) ); ?></td>
								<td><?php echo esc_html( $loc ?: '—' ); ?></td>
								<td><?php echo esc_html( $h['terminal'] ?? '—' ); ?></td>
								<td><?php echo $h['price_sell'] ? esc_html( number_format( (float) $h['price_sell'] ) . ' aUEC' ) : '—'; ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<div class="ussalmc-trade-data__note">Location and price history from UEX Corp — reflects real reported terminal data, not a live in-game feed.</div>
			<?php else : ?>
				<div class="ussalmc-trade-data__empty">No sell activity recorded yet.</div>
			<?php endif; ?>
		</div>

		<div class="ussalmc-trade-locations">
			<div class="ussalmc-trade-locations__lbl">RECENT BUY ACTIVITY &amp; LOCATIONS</div>
			<?php if ( $buy_history ) : ?>
				<table class="ussalmc-trade-locations__table">
					<thead>
						<tr><th>WHEN</th><th>LOCATION</th><th>TERMINAL</th><th>BUY PRICE</th></tr>
					</thead>
					<tbody>
						<?php foreach ( array_reverse( $buy_history ) as $h ) :
							$loc_parts = array_filter( array( $h['star_system'] ?? null, $h['planet'] ?? null, $h['city'] ?? null ) );
							$loc       = implode( ' › ', $loc_parts );
							$when      = $h['date'] ? ussalmc_wiki_time_ago_from_iso( gmdate( 'c', (int) $h['date'] ) ) : '—';
							?>
							<tr>
								<td><?php echo esc_html( str_replace( 'Updated ', '', $when ) ); ?></td>
								<td><?php echo esc_html( $loc ?: '—' ); ?></td>
								<td><?php echo esc_html( $h['terminal'] ?? '—' ); ?></td>
								<td><?php echo $h['price_buy'] ? esc_html( number_format( (float) $h['price_buy'] ) . ' aUEC' ) : '—'; ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<div class="ussalmc-trade-data__note">Location and price history from UEX Corp — reflects real reported terminal data, not a live in-game feed.</div>
			<?php else : ?>
				<div class="ussalmc-trade-data__empty">No buy activity recorded yet.</div>
			<?php endif; ?>
		</div>

		<div class="ussalmc-trade-locations">
			<div class="ussalmc-trade-locations__lbl">ALL TERMINALS TRADING <?php echo esc_html( strtoupper( $name ) ); ?><?php echo $all_terminals ? ' (' . esc_html( count( $all_terminals ) ) . ( ( $trade['terminal_count'] ?? 0 ) > count( $all_terminals ) ? ' of ' . esc_html( (int) $trade['terminal_count'] ) : '' ) . ')' : ''; ?></div>
			<?php if ( $all_terminals ) : ?>
				<table class="ussalmc-trade-locations__table">
					<thead>
						<tr><th>TERMINAL</th><th>SELL PRICE</th><th>BUY PRICE</th><th>STOCK (SCU)</th><th>UPDATED</th></tr>
					</thead>
					<tbody>
						<?php foreach ( $all_terminals as $t ) : ?>
							<tr>
								<td><?php echo esc_html( $t['terminal'] ); ?></td>
								<td><?php echo $t['sell_price'] !== null ? esc_html( number_format( (float) $t['sell_price'] ) . ' aUEC' ) : '—'; ?></td>
								<td><?php echo $t['buy_price'] !== null ? esc_html( number_format( (float) $t['buy_price'] ) . ' aUEC' ) : '—'; ?></td>
								<td><?php echo $t['stock'] !== null ? esc_html( number_format( (float) $t['stock'] ) ) : '—'; ?></td>
								<td><?php echo esc_html( str_replace( 'Updated ', '', $t['updated_label'] ) ); ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<div class="ussalmc-trade-data__note">Every real terminal UEX Corp currently tracks for this commodity, best sell price first — not just the single best terminal shown above.</div>
			<?php else : ?>
				<div class="ussalmc-trade-data__empty">No terminal data available for this commodity yet.</div>
			<?php endif; ?>
		</div>
	<?php endif; ?>

	<ul class="ussalmc-entity__meta">
		<li class="badge confidence-<?php echo esc_attr( $confidence ); ?>"><span class="k">CONFIDENCE</span> <?php echo esc_html( strtoupper( $confidence ) ); ?></li>
		<li class="badge"><span class="k">GAME VER</span> <?php echo esc_html( $gv ); ?></li>
		<?php if ( $src ) : ?><li class="badge"><span class="k">SOURCE</span> <?php echo esc_html( $src ); ?></li><?php endif; ?>
	</ul>

	<?php if ( $rels ) : ?>
		<div class="ussalmc-xrefs">
			<div class="lbl">CROSS-REFERENCES</div>
			<?php foreach ( $rels as $r ) :
				$rel = $r['relation'] ?? 'related';
				$te  = $r['entity'] ?? array();
				$tid = $te['id'] ?? '';
				$tn  = $te['name'] ?? $tid;
				if ( ! $tid ) { continue; }
				$href = add_query_arg( 'entity', rawurlencode( $tid ), home_url( '/wiki/' ) );
				?>
				<a class="ussalmc-xref" href="<?php echo esc_url( $href ); ?>"><span class="rel"><?php echo esc_html( str_replace( '_', ' ', $rel ) ); ?></span><?php echo esc_html( $tn ); ?></a>
			<?php endforeach; ?>
		</div>
	<?php endif; ?>
</div>
