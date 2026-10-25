<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<section class="planetary-atlas" aria-labelledby="planetary-title">
	<header class="map-head"><div><span class="atlas-eyebrow">THE USSA PLANETARY ATLAS</span><h1 id="planetary-title">Know where you’re going.</h1><p>Explore systems, turn a world in your hands, and find the places that matter.</p></div><a class="atlas-map-list-link" href="<?php echo esc_url( $payload['listUrl'] ); ?>">Browse all location entries ↗︎</a></header>
	<?php if ( $payload['truncated'] ) : ?><p class="atlas-empty" role="status">The map shows the first 10,000 entries. Use the location directory for the full archive.</p><?php endif; ?>
	<div class="map-shell">
		<aside class="system-panel" aria-label="Location browser">
			<span class="atlas-eyebrow">01 / NAVIGATE</span><h2>Explore the ’verse.</h2>
			<label class="atlas-sr-only" for="planetary-search">Search locations</label><input id="planetary-search" type="search" placeholder="Search locations…">
			<label class="atlas-map-label" for="planetary-system">STAR SYSTEM</label><select id="planetary-system"></select>
			<nav id="planetary-tree" class="system-tree" aria-label="Planets and moons"></nav>
			<label class="layer"><input id="planetary-all" type="checkbox">Search all locations</label>
			<label class="atlas-map-label" for="planetary-service">SERVICE FILTER</label><select id="planetary-service"><option value="">All recorded services</option><option value="trading">Trading</option><option value="mining">Mining</option><option value="refinery">Refinery</option><option value="refueling">Refuelling</option><option value="repair">Repair</option><option value="restock">Restock</option><option value="medical">Medical</option><option value="habitation">Habitation</option></select>
			<div class="system-label" id="planetary-results-title">LOCATIONS</div><div id="planetary-results" role="list"></div><button id="planetary-more" class="atlas-map-more" type="button" hidden>Show more locations</button>
			<div class="system-label">MAP LAYERS</div><label class="layer"><input id="planetary-pins" type="checkbox" checked>Recorded location pins</label><label class="layer"><input id="planetary-grid" type="checkbox" checked>Survey grid</label><label class="layer"><input id="planetary-orbit" type="checkbox" checked>Orbital reference</label>
		</aside>
		<section class="map-view" aria-label="3D planetary explorer">
			<div id="planetary-scene" role="img" aria-label="Interactive globe. Use the location list for accessible navigation."></div>
			<div class="view-top"><div class="world-label"><small id="planetary-path">KNOWLEDGE BASE / LOCATION</small><strong id="planetary-world">Loading locations…</strong></div><div class="view-modes" role="group" aria-label="Map view"><button id="planetary-globe" type="button" aria-pressed="true">Globe</button><button id="planetary-system-view" type="button" aria-pressed="false">System</button></div></div>
			<div class="view-controls"><button id="planetary-zoom-in" type="button" aria-label="Zoom in">+</button><button id="planetary-zoom-out" type="button" aria-label="Zoom out">−</button><button id="planetary-reset" type="button" aria-label="Reset view">⌂</button></div>
			<div id="planetary-markers"></div><p id="planetary-render-status" class="map-render-status" role="status">Loading 3D view. Location entries remain available in the list.</p>
			<div class="view-bottom"><div>Drag to orbit · scroll to zoom<br><strong id="planetary-geometry">ILLUSTRATIVE TERRAIN · NOT A NAVIGATIONAL CHART</strong></div><span id="planetary-count"></span></div>
		</section>
		<aside class="location-panel" aria-labelledby="planetary-place-title">
			<span class="atlas-eyebrow">02 / SELECTED LOCATION</span><h2 id="planetary-place-title">Choose a location.</h2><div class="location-path" id="planetary-place-path"></div><img id="planetary-photo" class="location-photo" alt="" hidden>
			<p id="planetary-description">Select a world or a location to see its recorded details.</p>
			<div class="location-data"><span>RECORDED COORDINATES</span><strong id="planetary-coordinates">No verified surface position loaded</strong></div>
			<div class="location-data"><span>RECORDED SERVICES</span><strong id="planetary-services">No service data recorded</strong></div>
			<div class="location-data"><span>PROVENANCE</span><strong id="planetary-provenance">Not yet selected</strong></div>
			<a id="planetary-open" class="location-open" hidden>Open location entry ↗︎</a><a class="location-secondary" href="<?php echo esc_url( ussalmc_atlas_url( array( 'category' => 'trade_route' ) ) ); ?>">Explore commodities & trade ↗︎</a>
			<p class="atlas-map-disclosure">Globe terrain and orbital layouts are illustrative. Only recorded degree coordinates are plotted. Locations without a known body or position remain in the list.</p>
		</aside>
	</div>
	<p id="planetary-live-status" class="atlas-sr-only" role="status" aria-live="polite"></p>
	<noscript><div class="atlas-empty"><p>The 3D viewer needs JavaScript. All locations are still available in the <a href="<?php echo esc_url( $payload['listUrl'] ); ?>">location directory</a>.</p></div></noscript>
	<script type="application/json" id="planetary-data"><?php echo wp_json_encode( $payload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ); ?></script>
</section>
