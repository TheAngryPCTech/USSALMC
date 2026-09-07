<?php
/**
 * USSALMC Portal — render functions for the three real widgets.
 *
 * These emit the theme's design-system markup (.panel/.market-row/.readout/etc.)
 * so the ACTIVE theme styles them with no widget-side CSS. Colors come from the
 * theme stylesheet's CSS custom properties (mirrored into the Elementor Kit), so
 * the widgets inherit the palette automatically.
 *
 * Data is REAL where the core API provides it:
 *  - Commodity Market  -> GET /v1/trade-routes  (confirmed, volatile)
 *  - Stat Readout      -> GET /v1/entities?type=item (live corpus counts) + /v1/trade-routes
 *  - Module Grid       -> GET /v1/entities?type=item (recent corpus entities)
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* ---------------------------------------------------------------------------
   1) COMMODITY MARKET — real confirmed trade routes from the core API.
   --------------------------------------------------------------------------- */
function ussalmc_portal_render_market( array $args = array() ): string {
	$title = $args['title'] ?? 'Commodity Market';
	$data  = ussalmc_portal_api_get( '/v1/trade-routes', 15 );

	ob_start(); ?>
	<div class="panel" data-widget="ussalmc-market">
		<div class="panel-head">
			<h2><?php echo esc_html( $title ); ?></h2>
			<span class="count">USSALMC TRADE NET</span>
		</div>
		<div class="panel-body">
		<?php if ( is_wp_error( $data ) ) : ?>
			<div class="market-row"><div class="market-name">Market feed unavailable</div>
				<div class="market-price flat"><?php echo esc_html( $data->get_error_message() ); ?></div></div>
		<?php elseif ( empty( $data['routes'] ) ) : ?>
			<div class="market-row"><div><div class="market-name">No confirmed routes yet</div>
				<div class="market-loc">Submit trade data via Trader.USSA.SPACE</div></div></div>
		<?php else : foreach ( $data['routes'] as $r ) :
			$profit = (float) ( $r['profit_per_unit'] ?? 0 );
			$dir    = $profit > 0 ? 'up' : ( $profit < 0 ? 'down' : 'flat' );
			$arrow  = $profit > 0 ? '▲' : ( $profit < 0 ? '▼' : '—' );
			$age    = isset( $r['last_verified_age_minutes'] ) ? (int) $r['last_verified_age_minutes'] : null;
			?>
			<div class="market-row">
				<div>
					<div class="market-name"><?php echo esc_html( $r['commodity'] ?? '—' ); ?></div>
					<div class="market-loc">
						<?php echo esc_html( ( $r['from_location'] ?? '?' ) . ' → ' . ( $r['to_location'] ?? '?' ) ); ?>
						<?php if ( null !== $age ) : ?>
							· <span title="Trade data is volatile — verify age">verified <?php echo esc_html( $age ); ?>m ago</span>
						<?php endif; ?>
					</div>
				</div>
				<div class="market-price <?php echo esc_attr( $dir ); ?>">
					<?php echo esc_html( number_format( (float) ( $r['sell_price'] ?? 0 ) ) ); ?> <?php echo esc_html( $arrow ); ?>
					<div class="market-loc" style="text-align:right">+<?php echo esc_html( number_format( $profit ) ); ?>/u</div>
				</div>
			</div>
		<?php endforeach; endif; ?>
		</div>
	</div>
	<?php
	return ob_get_clean();
}

/* ---------------------------------------------------------------------------
   2) STAT READOUT — six-cell instrument grid. Live corpus/market figures where
      the API provides them; clearly derived, never fabricated.
   --------------------------------------------------------------------------- */
function ussalmc_portal_render_stat_readout( array $args = array() ): string {
	$entities = ussalmc_portal_api_get( '/v1/entities?type=item&limit=1', 60 );
	$routes   = ussalmc_portal_api_get( '/v1/trade-routes', 15 );

	$entity_total = is_wp_error( $entities ) ? null : (int) ( $entities['total'] ?? 0 );
	$route_count  = is_wp_error( $routes ) ? null : (int) ( $routes['count'] ?? 0 );
	$top_profit   = null;
	if ( ! is_wp_error( $routes ) && ! empty( $routes['routes'][0]['profit_per_unit'] ) ) {
		$top_profit = (float) $routes['routes'][0]['profit_per_unit'];
	}

	// Each cell: [label, value, unit, trend-class|null, trend-text|null].
	$cells = array(
		array( 'KB ENTITIES',        $entity_total !== null ? number_format( $entity_total ) : '—', '', null, null ),
		array( 'CONFIRMED ROUTES',   $route_count !== null ? (string) $route_count : '—', '', null, null ),
		array( 'TOP ROUTE PROFIT',   $top_profit !== null ? number_format( $top_profit ) : '—', 'aUEC/u', $top_profit ? 'up' : null, $top_profit ? '▲' : null ),
		array( 'GAME VERSION',       '4.10', 'LIVE', null, null ),
		array( 'KB CONFIDENCE',      'TRACKED', '', null, null ),
		array( 'DATA FRESHNESS',     'VOLATILE', '', 'down', 'AGE-AWARE' ),
	);

	ob_start(); ?>
	<div class="readout-grid" data-widget="ussalmc-stat-readout">
		<?php foreach ( $cells as $c ) : ?>
			<div class="readout">
				<div class="top-row">
					<span class="lbl"><?php echo esc_html( $c[0] ); ?></span>
					<?php if ( $c[3] ) : ?><span class="trend <?php echo esc_attr( $c[3] ); ?>"><?php echo esc_html( $c[4] ); ?></span><?php endif; ?>
				</div>
				<div class="big"><?php echo esc_html( $c[1] ); ?><?php if ( $c[2] ) : ?><span class="unit"><?php echo esc_html( $c[2] ); ?></span><?php endif; ?></div>
			</div>
		<?php endforeach; ?>
	</div>
	<?php
	return ob_get_clean();
}

/* ---------------------------------------------------------------------------
   3) MODULE GRID — recent knowledge-base entities from the core API, as cards
      linking into the wiki. Real data (GET /v1/entities).
   --------------------------------------------------------------------------- */
function ussalmc_portal_render_module_grid( array $args = array() ): string {
	$title = $args['title'] ?? 'Knowledge Base — Recent Entities';
	$limit = (int) ( $args['limit'] ?? 6 );
	$data  = ussalmc_portal_api_get( '/v1/entities?type=item&limit=' . $limit, 60 );

	ob_start(); ?>
	<div class="panel" data-widget="ussalmc-module-grid">
		<div class="panel-head">
			<h2><?php echo esc_html( $title ); ?></h2>
			<span class="count"><?php echo is_wp_error( $data ) ? 'FEED DOWN' : (int) ( $data['total'] ?? 0 ) . ' TOTAL'; ?></span>
		</div>
		<div class="panel-body">
		<?php if ( is_wp_error( $data ) ) : ?>
			<div class="ship-row"><div class="ship-icon">ERR</div>
				<div><div class="ship-name">Knowledge base unavailable</div>
				<div class="ship-loc"><?php echo esc_html( $data->get_error_message() ); ?></div></div></div>
		<?php else : foreach ( array_slice( $data['items'] ?? array(), 0, $limit ) as $e ) :
			$cat  = ( $e['attributes']['category'] ?? '' ) ?: ( $e['type'] ?? 'item' );
			$icon = strtoupper( substr( preg_replace( '/[^A-Za-z0-9]/', '', $e['name'] ?? 'XX' ), 0, 3 ) );
			$link = home_url( '/wiki/?entity=' . rawurlencode( $e['id'] ?? '' ) );
			?>
			<a class="ship-row" href="<?php echo esc_url( $link ); ?>" style="text-decoration:none;color:inherit">
				<div class="ship-icon"><?php echo esc_html( $icon ); ?></div>
				<div>
					<div class="ship-name"><?php echo esc_html( $e['name'] ?? $e['id'] ?? '—' ); ?></div>
					<div class="ship-loc"><?php echo esc_html( $cat . ' · ' . ( $e['game_version'] ?? 'n/a' ) ); ?></div>
				</div>
				<span class="status-pill dock"><?php echo esc_html( strtoupper( $cat ) ); ?></span>
			</a>
		<?php endforeach; endif; ?>
		</div>
		<a class="btn-line" href="<?php echo esc_url( home_url( '/wiki/' ) ); ?>">OPEN KNOWLEDGE BASE</a>
	</div>
	<?php
	return ob_get_clean();
}
