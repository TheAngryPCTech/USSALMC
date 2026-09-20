<?php
/**
 * USSALMC Theme override — TRADE ROUTES browse view.
 * Overrides ussalmc-wiki/templates/trade-routes.php.
 * Two views instead of a flat card grid — a "Commodity: A -> B" card doesn't
 * answer the actual question a player has ("what can I do FROM HERE?"):
 *   PICKING UP   — grouped by where you'd go to BUY (each route's origin)
 *   DROPPING OFF — grouped by where you'd go to SELL (each route's destination)
 * Both nested System -> Planet -> Terminal (native <details>/<summary>, no
 * JS needed for the drill-down), routes within a terminal sorted by
 * commodity name (ussalmc_wiki_trade_routes_grouped() already did the
 * grouping/sorting server-side — this template just renders the tree).
 * Vars: $picking_up, $dropping_off (both [system => [planet => [terminal => [route,...]]]]),
 *       $total (int), $error (string|null).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * $trees = [ [ $picking_up tree, 'destination' side shown per row ],
 *            [ $dropping_off tree, 'origin' side shown per row ] ]
 * — looped once below instead of duplicating the render markup twice.
 */
$trees = array(
	array( 'PICKING UP', "— browse by where you'd go to buy", $picking_up, 'destination', 'Sell at' ),
	array( 'DROPPING OFF', "— browse by where you'd go to sell", $dropping_off, 'origin', 'Buy at' ),
);
?>
<div class="ussalmc-catview">
	<?php if ( ! empty( $error ) ) : ?>
		<div class="ussalmc-entity ussalmc-error">USSALMC: <?php echo esc_html( $error ); ?></div>
	<?php else : ?>
		<div class="ussalmc-entity__breadcrumb" style="margin-bottom:16px">
			<a href="<?php echo esc_url( home_url( '/wiki/' ) ); ?>">KNOWLEDGE BASE</a>
			<b>/ TRADE ROUTES</b> · <?php echo esc_html( $total ); ?> REAL ROUTES
		</div>

		<?php if ( ! $total ) : ?>
			<div class="ussalmc-catgrid__empty">No profitable trade routes on file yet.</div>
		<?php else : ?>
			<?php foreach ( $trees as $section ) :
				list( $label, $sub, $tree, $other_side, $other_lbl ) = $section;
				?>
				<div class="ussalmc-route-section">
					<div class="ussalmc-route-section__lbl"><?php echo esc_html( $label ); ?> <span class="ussalmc-route-section__sub"><?php echo esc_html( $sub ); ?></span></div>

					<?php foreach ( $tree as $system => $planets ) :
						$system_count = 0;
						foreach ( $planets as $terms ) { foreach ( $terms as $routes ) { $system_count += count( $routes ); } }
						?>
						<details class="ussalmc-route-tree__system">
							<summary><?php echo esc_html( $system ); ?> <span class="ussalmc-route-tree__count"><?php echo esc_html( $system_count ); ?></span></summary>

							<?php foreach ( $planets as $planet => $terminals ) :
								$planet_count = 0;
								foreach ( $terminals as $routes ) { $planet_count += count( $routes ); }
								?>
								<details class="ussalmc-route-tree__planet">
									<summary><?php echo esc_html( $planet ); ?> <span class="ussalmc-route-tree__count"><?php echo esc_html( $planet_count ); ?></span></summary>

									<?php foreach ( $terminals as $terminal => $routes ) : ?>
										<details class="ussalmc-route-tree__terminal" open>
											<summary><?php echo esc_html( $terminal ); ?> <span class="ussalmc-route-tree__count"><?php echo esc_html( count( $routes ) ); ?></span></summary>
											<div class="ussalmc-route-rows">
												<?php foreach ( $routes as $route ) :
													$a         = $route['attributes'] ?? array();
													$href      = add_query_arg( 'entity', rawurlencode( $route['id'] ), home_url( '/wiki/' ) );
													$other_loc = $a[ $other_side . '_location' ] ?? '—';
													$profit    = $a['profit_per_scu'] ?? null;
													$margin    = $a['margin_pct'] ?? null;
													$age       = ussalmc_wiki_time_ago_from_iso( $a['uex_last_updated'] ?? null );
													?>
													<a class="ussalmc-route-row" href="<?php echo esc_url( $href ); ?>">
														<span class="ussalmc-route-row__commodity"><?php echo esc_html( $a['commodity_name'] ?? $route['name'] ); ?></span>
														<span class="ussalmc-route-row__other">
															<span class="ussalmc-route-row__other-lbl"><?php echo esc_html( $other_lbl ); ?></span>
															<?php echo esc_html( $other_loc ); ?>
														</span>
														<span class="ussalmc-route-row__profit">
															<?php echo $profit !== null ? esc_html( number_format( (float) $profit ) ) . ' aUEC/SCU' : '—'; ?>
															<?php if ( $margin !== null ) : ?><span class="ussalmc-route-row__margin"><?php echo esc_html( number_format( (float) $margin, 1 ) ); ?>%</span><?php endif; ?>
														</span>
														<span class="ussalmc-route-row__age"><?php echo esc_html( str_replace( 'Updated ', '', $age ) ); ?></span>
													</a>
												<?php endforeach; ?>
											</div>
										</details>
									<?php endforeach; ?>
								</details>
							<?php endforeach; ?>
						</details>
					<?php endforeach; ?>
				</div>
			<?php endforeach; ?>

			<div class="ussalmc-trade-data__note">Real routes computed from UEX Corp price data (unofficial, community-maintained) — prices change frequently; verify age before relying on this.</div>
		<?php endif; ?>
	<?php endif; ?>
</div>
