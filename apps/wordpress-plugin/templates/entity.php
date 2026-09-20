<?php
/**
 * USSALMC Wiki — default ENTITY template.
 * Vars: $entity (array), $relations (array|WP_Error), $confidence (string).
 * Themes override at: <theme>/ussalmc-wiki/entity.php
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

// Attributes/stats: skip category (shown in breadcrumb), the uex_* trade
// fields (shown in their own dedicated panel below instead), and empty/complex
// values.
// Every commodity page shows the SAME set of trade-data sections in the SAME
// order, whether or not this particular commodity has UEX data — see the
// matching comment in the theme override for why (matches UEX's own
// commodity page layout, verified live).
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
	// See the matching comment in the theme override: uex_* fields hide here
	// only for commodities (which get their own dedicated panel below); other
	// entity types whose only source IS uex_* data (e.g. trade_route) would
	// otherwise have their freshness info silently dropped entirely.
	if ( $is_commodity && strpos( (string) $k, 'uex_' ) === 0 ) { continue; }
	if ( in_array( $k, array( 'uex_route_id', 'commodity_entity_id', 'uex_item_id', 'uex_best_buy_terminal_id', 'uex_best_sell_terminal_id' ), true ) ) { continue; }
	if ( is_array( $v ) || is_object( $v ) ) { continue; }
	if ( substr( (string) $k, -4 ) === '_raw' ) { continue; }
	if ( is_bool( $v ) ) { $v = $v ? 'Yes' : 'No'; }
	$v = trim( (string) $v );
	if ( $v === '' ) { continue; }
	if ( $k === 'uex_last_updated' ) {
		$stats[] = array( 'key' => $k, 'label' => 'LAST OBSERVED', 'value' => ussalmc_wiki_time_ago_from_iso( $v ) );
		continue;
	}
	$stats[] = array( 'key' => (string) $k, 'label' => strtoupper( str_replace( '_', ' ', (string) $k ) ), 'value' => $v );
}
?>
<div class="ussalmc-entity">
	<span class="corner tl" style="position:absolute;top:10px;left:10px;width:14px;height:14px;border-top:1px solid var(--signal-dim);border-left:1px solid var(--signal-dim);opacity:.7"></span>
	<span class="corner br" style="position:absolute;bottom:10px;right:10px;width:14px;height:14px;border-bottom:1px solid var(--signal-dim);border-right:1px solid var(--signal-dim);opacity:.7"></span>

	<div class="ussalmc-entity__breadcrumb">
		KNOWLEDGE BASE <b>/ <?php echo esc_html( strtoupper( (string) $cat ) ); ?> / <?php echo esc_html( $name ); ?></b>
	</div>

	<h3 class="ussalmc-entity__name"><?php echo esc_html( $name ); ?></h3>
	<?php if ( $summary ) : ?>
		<p class="ussalmc-entity__summary"><?php echo esc_html( $summary ); ?><?php echo ussalmc_wiki_field_actions( $entity['id'] ?? '', 'summary', $summary ); ?></p>
	<?php endif; ?>

	<?php $body_html = ! empty( $entity['body'] ) ? ussalmc_wiki_render_body_html( (string) $entity['body'] ) : ''; ?>
	<?php if ( $body_html ) : ?>
		<div class="ussalmc-entity__body"><?php echo $body_html; // phpcs:ignore -- built entirely from our own esc_html'd text, see ussalmc_wiki_render_body_html() ?></div>
	<?php endif; ?>

	<?php if ( $hero ) : ?>
		<figure class="ussalmc-entity__media" style="margin:16px 0 0">
			<img class="ussalmc-entity__hero" src="<?php echo esc_url( $hero['url'] ); ?>" <?php if ( ! empty( $hero['full_url'] ) ) : ?>data-full="<?php echo esc_url( $hero['full_url'] ); ?>"<?php endif; ?> alt="<?php echo esc_attr( $hero['caption'] ?? $name ); ?>" loading="lazy" style="display:block;width:100%;max-width:560px;height:auto;border:1px solid var(--line-bright,#333)" />
			<?php if ( ! empty( $hero['caption'] ) ) : ?><figcaption style="font-size:11px;opacity:.6;margin-top:6px"><?php echo esc_html( $hero['caption'] ); ?></figcaption><?php endif; ?>
		</figure>
		<?php if ( count( $images ) > 1 ) : ?>
			<div class="ussalmc-entity__gallery" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
				<?php foreach ( $images as $img ) :
					if ( ! is_array( $img ) || ! is_string( $img['url'] ?? null ) || $img['url'] === '' || $img['url'] === $hero['url'] ) { continue; }
					?>
					<a class="ussalmc-thumb" href="<?php echo esc_url( $img['url'] ); ?>" <?php if ( ! empty( $img['full_url'] ) ) : ?>data-full="<?php echo esc_url( $img['full_url'] ); ?>"<?php endif; ?> target="_blank" rel="noopener" style="display:block;width:84px;height:56px;border:1px solid var(--line,#333);overflow:hidden">
						<img src="<?php echo esc_url( $img['url'] ); ?>" alt="<?php echo esc_attr( $img['caption'] ?? $name ); ?>" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" />
					</a>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	<?php else : ?>
		<figure class="ussalmc-entity__media" style="margin:16px 0 0">
			<div style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;max-width:560px;aspect-ratio:16/9;background:var(--panel-raised,#151e28);background-image:linear-gradient(var(--line,#28333f) 1px, transparent 1px),linear-gradient(90deg, var(--line,#28333f) 1px, transparent 1px);background-size:14px 14px;background-position:center;border:1px solid var(--line-bright,#333);overflow:hidden">
				<span style="position:absolute;top:8px;left:8px;width:12px;height:12px;border-top:1px solid var(--signal-dim,#1c69d4);border-left:1px solid var(--signal-dim,#1c69d4);opacity:.6"></span>
				<span style="position:absolute;bottom:8px;right:8px;width:12px;height:12px;border-bottom:1px solid var(--signal-dim,#1c69d4);border-right:1px solid var(--signal-dim,#1c69d4);opacity:.6"></span>
				<span style="width:30px;height:30px;color:var(--text-faint,#4e5966)"><?php echo ussalmc_wiki_render_novisual_icon(); // phpcs:ignore -- static inline SVG, no dynamic data ?></span>
				<span style="font-family:'Space Mono',monospace;font-size:8.5px;letter-spacing:1.5px;color:var(--text-faint,#4e5966);text-transform:uppercase">No Visual Data</span>
			</div>
		</figure>
	<?php endif; ?>

	<?php if ( $stats ) : ?>
		<div class="ussalmc-stats" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#333)">
			<div class="ussalmc-stats__lbl" style="font-size:10.5px;letter-spacing:1.5px;opacity:.5;margin-bottom:12px">SPECIFICATIONS</div>
			<dl class="ussalmc-stats__grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1px;background:var(--line,#333);border:1px solid var(--line,#333);margin:0">
				<?php foreach ( $stats as $s ) : ?>
					<div class="ussalmc-stat" style="background:var(--panel-raised,#111);padding:8px 12px;display:flex;flex-direction:column;gap:2px">
						<dt style="font-size:9.5px;letter-spacing:.5px;opacity:.5"><?php echo esc_html( $s['label'] ); ?></dt>
						<dd style="margin:0;font-size:13px"><?php echo esc_html( $s['value'] ); ?><?php echo ussalmc_wiki_field_actions( $entity['id'] ?? '', 'attr:' . $s['key'], $s['value'] ); ?></dd>
					</div>
				<?php endforeach; ?>
			</dl>
		</div>
	<?php endif; ?>

	<?php if ( $is_commodity ) : ?>
		<div class="ussalmc-trade-data" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#333)">
			<div class="ussalmc-trade-data__lbl" style="font-size:10.5px;letter-spacing:1.5px;opacity:.5;margin-bottom:4px">LIVE TRADE DATA</div>
			<?php if ( $trade ) : ?>
				<div class="ussalmc-trade-data__age" style="font-size:11px;color:var(--amber,#c90);margin-bottom:10px"><?php echo esc_html( $trade['updated_label'] ); ?></div>
				<dl class="ussalmc-trade-data__grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1px;background:var(--line,#333);border:1px solid var(--line,#333);margin:0">
					<div class="ussalmc-stat" style="background:var(--panel-raised,#111);padding:8px 12px;display:flex;flex-direction:column;gap:2px">
						<dt style="font-size:9.5px;letter-spacing:.5px;opacity:.5">BEST SELL</dt>
						<dd style="margin:0;font-size:13px;color:var(--signal,#4af)"><?php echo $trade['sell_price'] !== null ? esc_html( number_format( (float) $trade['sell_price'] ) ) . ' aUEC' : '—'; ?><?php if ( $trade['sell_terminal'] ) : ?> <span style="opacity:.6">@ <?php echo esc_html( $trade['sell_terminal'] ); ?></span><?php endif; ?></dd>
					</div>
					<div class="ussalmc-stat" style="background:var(--panel-raised,#111);padding:8px 12px;display:flex;flex-direction:column;gap:2px">
						<dt style="font-size:9.5px;letter-spacing:.5px;opacity:.5">BEST BUY</dt>
						<dd style="margin:0;font-size:13px;color:var(--signal,#4af)"><?php echo $trade['buy_price'] !== null ? esc_html( number_format( (float) $trade['buy_price'] ) ) . ' aUEC' : '—'; ?><?php if ( $trade['buy_terminal'] ) : ?> <span style="opacity:.6">@ <?php echo esc_html( $trade['buy_terminal'] ); ?></span><?php endif; ?></dd>
					</div>
					<div class="ussalmc-stat" style="background:var(--panel-raised,#111);padding:8px 12px;display:flex;flex-direction:column;gap:2px">
						<dt style="font-size:9.5px;letter-spacing:.5px;opacity:.5">TERMINALS TRADING</dt>
						<dd style="margin:0;font-size:13px"><?php echo $trade['terminal_count'] !== null ? esc_html( (int) $trade['terminal_count'] ) : '—'; ?></dd>
					</div>
					<div class="ussalmc-stat" style="background:var(--panel-raised,#111);padding:8px 12px;display:flex;flex-direction:column;gap:2px">
						<dt style="font-size:9.5px;letter-spacing:.5px;opacity:.5">PROFIT / SCU</dt>
						<dd style="margin:0;font-size:13px"><?php echo $profit['profit'] !== null ? esc_html( number_format( (float) $profit['profit'] ) ) . ' aUEC' : '—'; ?></dd>
					</div>
					<div class="ussalmc-stat" style="background:var(--panel-raised,#111);padding:8px 12px;display:flex;flex-direction:column;gap:2px">
						<dt style="font-size:9.5px;letter-spacing:.5px;opacity:.5">MARGIN</dt>
						<dd style="margin:0;font-size:13px"><?php echo $profit['margin'] !== null ? esc_html( number_format( (float) $profit['margin'], 1 ) ) . '%' : '—'; ?></dd>
					</div>
					<div class="ussalmc-stat" style="background:var(--panel-raised,#111);padding:8px 12px;display:flex;flex-direction:column;gap:2px">
						<dt style="font-size:9.5px;letter-spacing:.5px;opacity:.5">ROI</dt>
						<dd style="margin:0;font-size:13px"><?php echo $profit['roi'] !== null ? esc_html( number_format( (float) $profit['roi'], 1 ) ) . '%' : '—'; ?></dd>
					</div>
				</dl>
			<?php else : ?>
				<div style="font-size:12px;opacity:.5;margin:6px 0">No live trade data available for this commodity yet.</div>
			<?php endif; ?>
			<div style="font-size:10px;opacity:.45;margin-top:8px">Source: UEX Corp (unofficial, community-maintained) — prices change frequently; verify age before relying on this.</div>
		</div>

		<div class="ussalmc-trade-chart" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#333)">
			<div style="font-size:10.5px;letter-spacing:1.5px;opacity:.5;margin-bottom:10px">SELL PRICE TREND<?php if ( $trade['sell_terminal'] ?? null ) : ?> <span style="opacity:.6">@ <?php echo esc_html( $trade['sell_terminal'] ); ?></span><?php endif; ?></div>
			<?php if ( $sparkline ) : ?>
				<div style="max-width:420px"><?php echo $sparkline; // phpcs:ignore -- built entirely from our own escaped numeric coordinates, see ussalmc_wiki_render_uex_sparkline_svg() ?></div>
				<div style="display:flex;justify-content:space-between;max-width:420px;font-size:10px;opacity:.5;margin-top:4px">
					<span><?php echo esc_html( number_format( (float) min( array_column( $history, 'price_sell' ) ) ) ); ?> aUEC</span>
					<span><?php echo esc_html( number_format( (float) max( array_column( $history, 'price_sell' ) ) ) ); ?> aUEC</span>
				</div>
			<?php else : ?>
				<div style="font-size:12px;opacity:.5">No sell-price history available yet.</div>
			<?php endif; ?>
		</div>

		<div class="ussalmc-trade-chart" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#333)">
			<div style="font-size:10.5px;letter-spacing:1.5px;opacity:.5;margin-bottom:10px">BUY PRICE TREND<?php if ( $trade['buy_terminal'] ?? null ) : ?> <span style="opacity:.6">@ <?php echo esc_html( $trade['buy_terminal'] ); ?></span><?php endif; ?></div>
			<?php if ( $buy_sparkline ) : ?>
				<div style="max-width:420px"><?php echo $buy_sparkline; // phpcs:ignore -- built entirely from our own escaped numeric coordinates, see ussalmc_wiki_render_uex_sparkline_svg() ?></div>
				<div style="display:flex;justify-content:space-between;max-width:420px;font-size:10px;opacity:.5;margin-top:4px">
					<span><?php echo esc_html( number_format( (float) min( array_column( $buy_history, 'price_buy' ) ) ) ); ?> aUEC</span>
					<span><?php echo esc_html( number_format( (float) max( array_column( $buy_history, 'price_buy' ) ) ) ); ?> aUEC</span>
				</div>
			<?php else : ?>
				<div style="font-size:12px;opacity:.5">No buy-price history available yet.</div>
			<?php endif; ?>
		</div>

		<div class="ussalmc-trade-locations" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#333)">
			<div style="font-size:10.5px;letter-spacing:1.5px;opacity:.5;margin-bottom:10px">RECENT SELL ACTIVITY &amp; LOCATIONS</div>
			<?php if ( $history ) : ?>
				<table style="width:100%;border-collapse:collapse;font-size:12px">
					<thead>
						<tr style="opacity:.5;font-size:9.5px;letter-spacing:.5px;text-align:left">
							<th style="padding:4px 8px 4px 0">WHEN</th><th style="padding:4px 8px">LOCATION</th><th style="padding:4px 8px">TERMINAL</th><th style="padding:4px 0 4px 8px;text-align:right">SELL PRICE</th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( array_reverse( $history ) as $h ) :
							$loc_parts = array_filter( array( $h['star_system'] ?? null, $h['planet'] ?? null, $h['city'] ?? null ) );
							$loc       = implode( ' › ', $loc_parts );
							$when      = $h['date'] ? ussalmc_wiki_time_ago_from_iso( gmdate( 'c', (int) $h['date'] ) ) : '—';
							?>
							<tr style="border-top:1px solid var(--line,#222)">
								<td style="padding:6px 8px 6px 0;white-space:nowrap"><?php echo esc_html( str_replace( 'Updated ', '', $when ) ); ?></td>
								<td style="padding:6px 8px"><?php echo esc_html( $loc ?: '—' ); ?></td>
								<td style="padding:6px 8px"><?php echo esc_html( $h['terminal'] ?? '—' ); ?></td>
								<td style="padding:6px 0 6px 8px;text-align:right"><?php echo $h['price_sell'] ? esc_html( number_format( (float) $h['price_sell'] ) . ' aUEC' ) : '—'; ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<div style="font-size:10px;opacity:.45;margin-top:8px">Location and price history from UEX Corp — reflects real reported terminal data, not a live in-game feed.</div>
			<?php else : ?>
				<div style="font-size:12px;opacity:.5">No sell activity recorded yet.</div>
			<?php endif; ?>
		</div>

		<div class="ussalmc-trade-locations" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#333)">
			<div style="font-size:10.5px;letter-spacing:1.5px;opacity:.5;margin-bottom:10px">RECENT BUY ACTIVITY &amp; LOCATIONS</div>
			<?php if ( $buy_history ) : ?>
				<table style="width:100%;border-collapse:collapse;font-size:12px">
					<thead>
						<tr style="opacity:.5;font-size:9.5px;letter-spacing:.5px;text-align:left">
							<th style="padding:4px 8px 4px 0">WHEN</th><th style="padding:4px 8px">LOCATION</th><th style="padding:4px 8px">TERMINAL</th><th style="padding:4px 0 4px 8px;text-align:right">BUY PRICE</th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( array_reverse( $buy_history ) as $h ) :
							$loc_parts = array_filter( array( $h['star_system'] ?? null, $h['planet'] ?? null, $h['city'] ?? null ) );
							$loc       = implode( ' › ', $loc_parts );
							$when      = $h['date'] ? ussalmc_wiki_time_ago_from_iso( gmdate( 'c', (int) $h['date'] ) ) : '—';
							?>
							<tr style="border-top:1px solid var(--line,#222)">
								<td style="padding:6px 8px 6px 0;white-space:nowrap"><?php echo esc_html( str_replace( 'Updated ', '', $when ) ); ?></td>
								<td style="padding:6px 8px"><?php echo esc_html( $loc ?: '—' ); ?></td>
								<td style="padding:6px 8px"><?php echo esc_html( $h['terminal'] ?? '—' ); ?></td>
								<td style="padding:6px 0 6px 8px;text-align:right"><?php echo $h['price_buy'] ? esc_html( number_format( (float) $h['price_buy'] ) . ' aUEC' ) : '—'; ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<div style="font-size:10px;opacity:.45;margin-top:8px">Location and price history from UEX Corp — reflects real reported terminal data, not a live in-game feed.</div>
			<?php else : ?>
				<div style="font-size:12px;opacity:.5">No buy activity recorded yet.</div>
			<?php endif; ?>
		</div>

		<div class="ussalmc-trade-locations" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#333)">
			<div style="font-size:10.5px;letter-spacing:1.5px;opacity:.5;margin-bottom:10px">ALL TERMINALS TRADING <?php echo esc_html( strtoupper( $name ) ); ?><?php echo $all_terminals ? ' (' . esc_html( count( $all_terminals ) ) . ( ( $trade['terminal_count'] ?? 0 ) > count( $all_terminals ) ? ' of ' . esc_html( (int) $trade['terminal_count'] ) : '' ) . ')' : ''; ?></div>
			<?php if ( $all_terminals ) : ?>
				<table style="width:100%;border-collapse:collapse;font-size:12px">
					<thead>
						<tr style="opacity:.5;font-size:9.5px;letter-spacing:.5px;text-align:left">
							<th style="padding:4px 8px 4px 0">TERMINAL</th><th style="padding:4px 8px">SELL PRICE</th><th style="padding:4px 8px">BUY PRICE</th><th style="padding:4px 8px">STOCK (SCU)</th><th style="padding:4px 0 4px 8px;text-align:right">UPDATED</th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $all_terminals as $t ) : ?>
							<tr style="border-top:1px solid var(--line,#222)">
								<td style="padding:6px 8px 6px 0"><?php echo esc_html( $t['terminal'] ); ?></td>
								<td style="padding:6px 8px"><?php echo $t['sell_price'] !== null ? esc_html( number_format( (float) $t['sell_price'] ) . ' aUEC' ) : '—'; ?></td>
								<td style="padding:6px 8px"><?php echo $t['buy_price'] !== null ? esc_html( number_format( (float) $t['buy_price'] ) . ' aUEC' ) : '—'; ?></td>
								<td style="padding:6px 8px"><?php echo $t['stock'] !== null ? esc_html( number_format( (float) $t['stock'] ) ) : '—'; ?></td>
								<td style="padding:6px 0 6px 8px;text-align:right;white-space:nowrap"><?php echo esc_html( str_replace( 'Updated ', '', $t['updated_label'] ) ); ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<div style="font-size:10px;opacity:.45;margin-top:8px">Every real terminal UEX Corp currently tracks for this commodity, best sell price first — not just the single best terminal shown above.</div>
			<?php else : ?>
				<div style="font-size:12px;opacity:.5">No terminal data available for this commodity yet.</div>
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
				$href = add_query_arg( 'entity', rawurlencode( $tid ), remove_query_arg( array( 'q', 'category' ) ) );
				?>
				<a class="ussalmc-xref" href="<?php echo esc_url( $href ); ?>"><span class="rel"><?php echo esc_html( str_replace( '_', ' ', $rel ) ); ?></span><?php echo esc_html( $tn ); ?></a>
			<?php endforeach; ?>
		</div>
	<?php endif; ?>
</div>
