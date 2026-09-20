<?php
/**
 * USSALMC Wiki — default TRADE ROUTES browse view.
 * Themes override at: <theme>/ussalmc-wiki/trade-routes.php
 * See the theme override for the full design rationale (PICKING UP /
 * DROPPING OFF, grouped System -> Planet -> Terminal via native
 * <details>/<summary>, no JS).
 * Vars: $picking_up, $dropping_off (both [system => [planet => [terminal => [route,...]]]]),
 *       $total (int), $error (string|null).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
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
			KNOWLEDGE BASE <b>/ TRADE ROUTES</b> · <?php echo esc_html( $total ); ?> REAL ROUTES
		</div>

		<?php if ( ! $total ) : ?>
			<div>No profitable trade routes on file yet.</div>
		<?php else : ?>
			<?php foreach ( $trees as $section ) :
				list( $label, $sub, $tree, $other_side, $other_lbl ) = $section;
				?>
				<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#333)">
					<div style="font-size:10.5px;letter-spacing:1.5px;opacity:.5;margin-bottom:10px">
						<?php echo esc_html( $label ); ?> <span style="opacity:.7;letter-spacing:0;text-transform:none"><?php echo esc_html( $sub ); ?></span>
					</div>

					<?php foreach ( $tree as $system => $planets ) :
						$system_count = 0;
						foreach ( $planets as $terms ) { foreach ( $terms as $routes ) { $system_count += count( $routes ); } }
						?>
						<details style="margin-bottom:4px">
							<summary style="cursor:pointer;font-family:'Aquire','Rajdhani',sans-serif;font-weight:600;font-size:14px;padding:8px 0"><?php echo esc_html( $system ); ?> <span style="font-family:'Space Mono',monospace;font-size:11px;color:var(--signal,#4af)"><?php echo esc_html( $system_count ); ?></span></summary>

							<?php foreach ( $planets as $planet => $terminals ) :
								$planet_count = 0;
								foreach ( $terminals as $routes ) { $planet_count += count( $routes ); }
								?>
								<details style="margin:0 0 4px 16px">
									<summary style="cursor:pointer;font-size:13px;padding:6px 0"><?php echo esc_html( $planet ); ?> <span style="font-family:'Space Mono',monospace;font-size:10.5px;color:var(--signal,#4af)"><?php echo esc_html( $planet_count ); ?></span></summary>

									<?php foreach ( $terminals as $terminal => $routes ) : ?>
										<details open style="margin:0 0 4px 16px">
											<summary style="cursor:pointer;font-size:12.5px;opacity:.85;padding:5px 0"><?php echo esc_html( $terminal ); ?> <span style="font-family:'Space Mono',monospace;font-size:10px;color:var(--signal,#4af)"><?php echo esc_html( count( $routes ) ); ?></span></summary>
											<div style="margin-left:16px">
												<?php foreach ( $routes as $route ) :
													$a         = $route['attributes'] ?? array();
													$href      = add_query_arg( 'entity', rawurlencode( $route['id'] ), home_url( '/wiki/' ) );
													$other_loc = $a[ $other_side . '_location' ] ?? '—';
													$profit    = $a['profit_per_scu'] ?? null;
													$margin    = $a['margin_pct'] ?? null;
													$age       = ussalmc_wiki_time_ago_from_iso( $a['uex_last_updated'] ?? null );
													?>
													<a href="<?php echo esc_url( $href ); ?>" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:8px 10px;border-top:1px solid var(--line,#222);text-decoration:none;color:inherit;font-size:12.5px">
														<span style="font-weight:600;min-width:140px"><?php echo esc_html( $a['commodity_name'] ?? $route['name'] ); ?></span>
														<span style="opacity:.7;flex:1">
															<span style="opacity:.6"><?php echo esc_html( $other_lbl ); ?>:</span>
															<?php echo esc_html( $other_loc ); ?>
														</span>
														<span style="font-family:'Space Mono',monospace;color:var(--signal,#4af);white-space:nowrap">
															<?php echo $profit !== null ? esc_html( number_format( (float) $profit ) ) . ' aUEC/SCU' : '—'; ?>
															<?php if ( $margin !== null ) : ?> <span style="opacity:.6"><?php echo esc_html( number_format( (float) $margin, 1 ) ); ?>%</span><?php endif; ?>
														</span>
														<span style="font-size:10.5px;opacity:.45;white-space:nowrap"><?php echo esc_html( str_replace( 'Updated ', '', $age ) ); ?></span>
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

			<div style="font-size:10px;opacity:.45;margin-top:16px">Real routes computed from UEX Corp price data (unofficial, community-maintained) — prices change frequently; verify age before relying on this.</div>
		<?php endif; ?>
	<?php endif; ?>
</div>
