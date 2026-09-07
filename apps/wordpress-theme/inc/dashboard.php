<?php
/**
 * USSALMC Theme — dashboard assembler.
 *
 * [ussalmc_dashboard] renders the HUD corporate dashboard body (everything
 * inside .content): page head, the hero instrument cluster (standing dial +
 * the portal plugin's real Stat Readout widget), and the two-column module grid.
 *
 * The module grid assembles the portal plugin's REAL widgets (Market, Module
 * Grid) alongside the theme's static placeholder panels (Contracts, Fleet,
 * Personnel, Comms) — matching corp-portal.html's left/right column layout.
 *
 * Portal widgets are invoked via their shortcodes so the dashboard works whether
 * or not the page itself is built in Elementor; the same widgets are ALSO
 * available natively in the Elementor editor (inc/widgets.php).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The standing dial (SVG arc). Mirrors the corp-portal.html instrument. */
function ussalmc_render_standing_dial( int $value = 82, int $max = 100 ): string {
	$circ   = 540;                        // matches reference stroke-dasharray
	$offset = (int) round( $circ * ( 1 - ( $value / $max ) ) );
	ob_start(); ?>
	<div class="dial-panel">
		<span class="corner tl"></span><span class="corner br"></span>
		<div class="dial">
			<svg viewBox="0 0 200 200">
				<circle cx="100" cy="100" r="86" fill="none" stroke="#1F2A35" stroke-width="10"/>
				<circle cx="100" cy="100" r="86" fill="none" stroke="#4A9EFF" stroke-width="10"
					stroke-dasharray="<?php echo esc_attr( $circ ); ?>" stroke-dashoffset="<?php echo esc_attr( $offset ); ?>"
					stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(74,158,255,0.6))"/>
			</svg>
			<div class="dial-center">
				<div class="num"><?php echo esc_html( $value ); ?></div>
				<div class="lbl">STANDING INDEX</div>
			</div>
		</div>
		<div class="dial-caption">
			<div class="title">USSA Standing: Trusted</div>
			<div class="sub">+4 pts this cycle · next tier at 90</div>
		</div>
	</div>
	<?php
	return ob_get_clean();
}

add_shortcode( 'ussalmc_dashboard', function () {
	$has_portal = shortcode_exists( 'ussalmc_stat_readout' );

	ob_start(); ?>
	<div class="content">

		<div class="page-head">
			<div>
				<h1>Corporate Dashboard</h1>
				<p>Extraction, industrial output, freight and security division status across USSA operating sectors.</p>
			</div>
			<div class="sync-status"><span class="dot"></span> LIVE FEED — <span id="ussa-clock">SYNCED</span></div>
		</div>

		<!-- INSTRUMENT CLUSTER: standing dial + portal Stat Readout widget -->
		<div class="cluster">
			<?php echo ussalmc_render_standing_dial( 82 ); ?>
			<?php
			// REAL portal widget (six-stat readout) — inherits theme + Kit palette.
			echo $has_portal ? do_shortcode( '[ussalmc_stat_readout]' ) : '<div class="readout-grid"><div class="readout"><span class="lbl">PORTAL PLUGIN INACTIVE</span></div></div>';
			?>
		</div>

		<!-- MODULE GRID: left = Contracts (placeholder) + Market (real);
		                  right = Fleet (placeholder) + Comms (placeholder) -->
		<div class="modules">
			<div class="col" id="contracts">
				<?php echo ussalmc_render_panel_contracts(); ?>
				<div id="market"><?php echo $has_portal ? do_shortcode( '[ussalmc_market]' ) : ''; ?></div>
			</div>
			<div class="col">
				<div id="fleet"><?php echo ussalmc_render_panel_fleet(); ?></div>
				<div id="comms"><?php echo ussalmc_render_panel_comms(); ?></div>
			</div>
		</div>

		<!-- SECOND ROW: Knowledge Base module grid (real) + Personnel (placeholder) -->
		<div class="modules">
			<div class="col">
				<?php echo $has_portal ? do_shortcode( '[ussalmc_module_grid limit="6"]' ) : ''; ?>
			</div>
			<div class="col" id="personnel">
				<?php echo ussalmc_render_panel_personnel(); ?>
			</div>
		</div>

	</div>
	<?php
	return ob_get_clean();
} );
