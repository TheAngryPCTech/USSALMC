<?php
/**
 * USSALMC placeholder panels — Fleet, Contracts, Personnel, Comms.
 *
 * These four modules have NO real data source/API yet, so they render static,
 * clearly-labeled SAMPLE content in the exact design system. Each panel is split
 * into a data provider (`ussalmc_ph_*_data()`) and a pure renderer
 * (`ussalmc_render_panel_*()`). When a real API exists, ONLY the data provider
 * needs to change to fetch live data — the markup/visual layout stays identical.
 *
 * Every panel carries a visible "SAMPLE" flag and an inline
 * "TODO: wire to future API once defined." comment at its data boundary.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Small helper: the amber "SAMPLE" flag shown in each placeholder head. */
function ussalmc_ph_flag(): string {
	return '<span class="placeholder-flag" title="Static sample content — no live data source yet">SAMPLE</span>';
}

/* =========================================================================
   CONTRACTS
   ========================================================================= */
function ussalmc_ph_contracts_data(): array {
	// TODO: wire to future API once defined. Replace this static array with a
	// fetch (e.g. GET /v1/contracts). Renderer below is data-shape stable.
	return array(
		array( 'pri' => 'high', 'title' => 'Claim defense — Hostile incursion, Aaron Halo B7', 'sub' => 'Priority · Deadline 1h 40m', 'reward' => '94,000', 'tag' => 'SECURITY' ),
		array( 'pri' => 'norm', 'title' => 'Refined RMC bulk delivery — Aaron Halo belt',       'sub' => 'Standard · Deadline 1d 4h',  'reward' => '112,000', 'tag' => 'MINING' ),
		array( 'pri' => 'norm', 'title' => 'Armed escort — Refinery freight, Yela corridor',    'sub' => 'Standard · Deadline 8h 00m', 'reward' => '76,500',  'tag' => 'SECURITY' ),
		array( 'pri' => 'norm', 'title' => 'Industrial equipment transfer — Hurston → Lorville', 'sub' => 'Standard · Deadline 14h',    'reward' => '58,300',  'tag' => 'LOGISTICS' ),
		array( 'pri' => 'low',  'title' => 'Asteroid survey — New extraction site, belt C',      'sub' => 'Low priority · Deadline 3d', 'reward' => '29,900',  'tag' => 'MINING' ),
	);
}
function ussalmc_render_panel_contracts(): string {
	$rows = ussalmc_ph_contracts_data();
	ob_start(); ?>
	<div class="panel" data-module="contracts">
		<div class="panel-head">
			<h2>Active Contracts</h2>
			<span class="count"><?php echo count( $rows ); ?> OPEN <?php echo ussalmc_ph_flag(); ?></span>
		</div>
		<div class="panel-body">
			<?php foreach ( $rows as $r ) : ?>
				<div class="contract-row">
					<span class="pri <?php echo esc_attr( $r['pri'] ); ?>"></span>
					<div>
						<div class="c-title"><?php echo esc_html( $r['title'] ); ?></div>
						<div class="c-sub"><?php echo esc_html( $r['sub'] ); ?></div>
					</div>
					<div class="c-reward"><?php echo esc_html( $r['reward'] ); ?><span class="aUEC">aUEC</span></div>
					<div class="c-tag"><?php echo esc_html( $r['tag'] ); ?></div>
				</div>
			<?php endforeach; ?>
		</div>
		<button class="btn-line" type="button" disabled>VIEW ALL CONTRACTS</button>
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
