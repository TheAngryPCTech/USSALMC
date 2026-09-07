<?php
/**
 * USSALMC placeholder panels — Fleet, Personnel, Comms.
 *
 * These modules have NO real data source/API yet, so they render static,
 * clearly-labeled SAMPLE content in the exact design system. Each panel is split
 * into a data provider (`ussalmc_ph_*_data()`) and a pure renderer
 * (`ussalmc_render_panel_*()`). When a real API exists, ONLY the data provider
 * needs to change to fetch live data — the markup/visual layout stays identical.
 *
 * Every panel carries a visible "SAMPLE" flag and an inline
 * "TODO: wire to future API once defined." comment at its data boundary.
 *
 * CONTRACTS is no longer a placeholder — see ussalmc_render_panel_contracts()
 * below, which reads real quest entities from the core API. This does NOT
 * touch the portal plugin's separate Contract post type / accept-complete
 * system, which stays deferred as originally planned; this is a read-only
 * informational display only.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Small helper: the amber "SAMPLE" flag shown in each placeholder head. */
function ussalmc_ph_flag(): string {
	return '<span class="placeholder-flag" title="Static sample content — no live data source yet">SAMPLE</span>';
}

/* =========================================================================
   CONTRACTS — real data: the 5 most recently added/updated quest entities
   from the core knowledge base (GET /v1/entities?type=quest&sort=recent&limit=5).
   Read-only/informational, via the wiki plugin's existing API client
   (ussalmc_wiki_list_entities / ussalmc_wiki_confidence) so it uses the same
   Bearer key + error handling as every other real panel. No app-level cache —
   this is static/non-volatile mission data, queried live on each page load,
   same convention as the wiki plugin's own reads.
   ========================================================================= */
function ussalmc_render_panel_contracts(): string {
	$can_fetch = function_exists( 'ussalmc_wiki_list_entities' ) && function_exists( 'ussalmc_wiki_confidence' );
	$data      = $can_fetch
		? ussalmc_wiki_list_entities( array( 'type' => 'quest', 'sort' => 'recent', 'limit' => 5 ) )
		: new WP_Error( 'ussalmc_wiki_inactive', 'USSALMC Wiki plugin is not active.' );

	ob_start(); ?>
	<div class="panel" data-module="contracts" data-widget="ussalmc-contracts">
		<div class="panel-head">
			<h2>Active Contracts</h2>
			<span class="count">
				<?php echo is_wp_error( $data ) ? 'FEED DOWN' : (int) ( $data['total'] ?? 0 ) . ' TOTAL'; ?>
			</span>
		</div>
		<div class="panel-body">
		<?php if ( is_wp_error( $data ) ) : ?>
			<div class="contract-row">
				<span class="pri low"></span>
				<div>
					<div class="c-title">Contracts feed unavailable</div>
					<div class="c-sub"><?php echo esc_html( $data->get_error_message() ); ?></div>
				</div>
			</div>
		<?php elseif ( empty( $data['items'] ) ) : ?>
			<div class="contract-row">
				<span class="pri low"></span>
				<div>
					<div class="c-title">No missions in the knowledge base yet</div>
					<div class="c-sub">Run the connector's mission scan to populate this panel.</div>
				</div>
			</div>
		<?php else : foreach ( $data['items'] as $e ) :
			$conf  = ussalmc_wiki_confidence( $e );
			$title = $e['name'] ?? ( $e['id'] ?? '—' );
			$sub   = wp_trim_words( wp_strip_all_tags( $e['summary'] ?? '' ), 20, '…' );
			$link  = home_url( '/wiki/?entity=' . rawurlencode( $e['id'] ?? '' ) );
			?>
			<a class="contract-row quest-card" href="<?php echo esc_url( $link ); ?>">
				<span class="pri <?php echo esc_attr( $conf ); ?>"></span>
				<div>
					<div class="c-title"><?php echo esc_html( $title ); ?></div>
					<div class="c-sub"><?php echo esc_html( $sub ?: 'No summary yet.' ); ?></div>
				</div>
				<span class="badge confidence-<?php echo esc_attr( $conf ); ?>"><?php echo esc_html( strtoupper( $conf ) ); ?></span>
			</a>
		<?php endforeach; endif; ?>
		</div>
		<button class="btn-line" type="button" disabled title="Browse-all is out of scope for this display panel — see each card's link for its entity page">VIEW ALL CONTRACTS</button>
	</div>
	<?php
	return ob_get_clean();
}

/* =========================================================================
   FLEET
   ========================================================================= */
function ussalmc_ph_fleet_data(): array {
	// TODO: wire to future API once defined. Replace with live fleet telemetry
	// (e.g. GET /v1/fleet). Statuses map to .status-pill online|transit|dock.
	return array(
		array( 'icon' => 'MOL', 'name' => 'MOLE × 3 "Deepcut Wing"',        'loc' => 'Extracting · Aaron Halo, cluster B', 'status' => 'online',  'label' => 'ACTIVE' ),
		array( 'icon' => 'C2',  'name' => 'Hercules C2 "Longhaul"',         'loc' => 'En route · Hurston → Lorville',      'status' => 'transit', 'label' => 'TRANSIT' ),
		array( 'icon' => 'CAT', 'name' => 'Caterpillar "Ironback"',         'loc' => 'Docked · Baijini Point',             'status' => 'dock',    'label' => 'DOCKED' ),
		array( 'icon' => 'GLA', 'name' => 'Gladius Flight × 2 — Security Div.', 'loc' => 'Claim defense · Aaron Halo B7',    'status' => 'online',  'label' => 'ACTIVE' ),
	);
}
function ussalmc_render_panel_fleet(): string {
	$rows = ussalmc_ph_fleet_data();
	ob_start(); ?>
	<div class="panel" data-module="fleet">
		<div class="panel-head">
			<h2>Fleet Status</h2>
			<span class="count">21 / 26 ONLINE <?php echo ussalmc_ph_flag(); ?></span>
		</div>
		<div class="panel-body">
			<?php foreach ( $rows as $r ) : ?>
				<div class="ship-row">
					<div class="ship-icon"><?php echo esc_html( $r['icon'] ); ?></div>
					<div>
						<div class="ship-name"><?php echo esc_html( $r['name'] ); ?></div>
						<div class="ship-loc"><?php echo esc_html( $r['loc'] ); ?></div>
					</div>
					<span class="status-pill <?php echo esc_attr( $r['status'] ); ?>"><?php echo esc_html( $r['label'] ); ?></span>
				</div>
			<?php endforeach; ?>
		</div>
		<button class="btn-line" type="button" disabled>OPEN FLEET MANAGER</button>
	</div>
	<?php
	return ob_get_clean();
}

/* =========================================================================
   PERSONNEL
   ========================================================================= */
function ussalmc_ph_personnel_data(): array {
	// TODO: wire to future API once defined. Replace with live roster
	// (e.g. GET /v1/personnel). Renderer is data-shape stable.
	return array(
		array( 'name' => 'R. Voss',    'role' => 'EXTRACTION OPS LEAD // L4', 'status' => 'online',  'label' => 'ON DUTY' ),
		array( 'name' => 'J. Okafor',  'role' => 'MINING FOREMAN // L3',      'status' => 'online',  'label' => 'ON DUTY' ),
		array( 'name' => 'T. Reyes',   'role' => 'MARKET DESK // L3',         'status' => 'transit', 'label' => 'REMOTE' ),
		array( 'name' => 'S. Anand',   'role' => 'SECURITY DIVISION // L4',   'status' => 'online',  'label' => 'DEPLOYED' ),
		array( 'name' => 'K. Mbeki',   'role' => 'LOGISTICS // L2',           'status' => 'dock',    'label' => 'OFF DUTY' ),
	);
}
function ussalmc_render_panel_personnel(): string {
	$rows = ussalmc_ph_personnel_data();
	ob_start(); ?>
	<div class="panel" data-module="personnel">
		<div class="panel-head">
			<h2>Personnel</h2>
			<span class="count"><?php echo count( $rows ); ?> ON ROSTER <?php echo ussalmc_ph_flag(); ?></span>
		</div>
		<div class="panel-body">
			<?php foreach ( $rows as $r ) : ?>
				<div class="person-row">
					<div class="person-avatar"></div>
					<div>
						<div class="person-name"><?php echo esc_html( $r['name'] ); ?></div>
						<div class="person-role"><?php echo esc_html( $r['role'] ); ?></div>
					</div>
					<span class="status-pill <?php echo esc_attr( $r['status'] ); ?>"><?php echo esc_html( $r['label'] ); ?></span>
				</div>
			<?php endforeach; ?>
		</div>
		<button class="btn-line" type="button" disabled>OPEN PERSONNEL DIRECTORY</button>
	</div>
	<?php
	return ob_get_clean();
}

/* =========================================================================
   COMMS
   ========================================================================= */
function ussalmc_ph_comms_data(): array {
	// TODO: wire to future API once defined. Replace with live comms feed
	// (e.g. GET /v1/comms). `body` allows a single <b> speaker highlight.
	return array(
		array( 'from' => 'SECURITY DIV.',     'age' => '03m ago', 'body' => '<b>Auto-Alert:</b> Unregistered vessel detected near claim B7 — Gladius flight diverted to intercept.' ),
		array( 'from' => 'OPS // EXTRACTION',  'age' => '22m ago', 'body' => '<b>J. Okafor:</b> Deepcut Wing hit yield target early — clearing the site for a second pass.' ),
		array( 'from' => 'MARKET DESK',        'age' => '1h ago',  'body' => '<b>T. Reyes:</b> RMC prices climbing at Area18 — holding the refined haul for a better sell window.' ),
	);
}
function ussalmc_render_panel_comms(): string {
	$rows = ussalmc_ph_comms_data();
	ob_start(); ?>
	<div class="panel" data-module="comms">
		<div class="panel-head">
			<h2>Corp Comms</h2>
			<span class="count">3 NEW <?php echo ussalmc_ph_flag(); ?></span>
		</div>
		<div class="panel-body">
			<?php foreach ( $rows as $r ) : ?>
				<div class="comm-row">
					<div class="comm-top"><span><?php echo esc_html( $r['from'] ); ?></span><span><?php echo esc_html( $r['age'] ); ?></span></div>
					<div class="comm-body"><?php echo wp_kses( $r['body'], array( 'b' => array() ) ); ?></div>
				</div>
			<?php endforeach; ?>
		</div>
		<button class="btn-line" type="button" disabled>OPEN COMMS CHANNEL</button>
	</div>
	<?php
	return ob_get_clean();
}
