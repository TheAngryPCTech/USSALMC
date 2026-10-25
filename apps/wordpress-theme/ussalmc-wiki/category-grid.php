<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<section class="atlas-directory" aria-labelledby="atlas-directory-title">
	<div class="atlas-section-heading"><div><span class="atlas-eyebrow">THE ARCHIVE</span><h1 id="atlas-directory-title">Explore by category.</h1><p>One place for everything you need to know.</p></div></div>
	<?php if ( ! empty( $error ) ) : ?>
		<p class="atlas-empty" role="status">The knowledge base is temporarily unavailable. Please try again shortly.</p>
	<?php elseif ( empty( $categories ) ) : ?>
		<p class="atlas-empty">No categories yet. Check back as the archive grows.</p>
	<?php else : ?>
		<div class="atlas-category-grid"><?php foreach ( $categories as $cat ) { ussalmc_atlas_category_card( $cat ); } ?></div>
	<?php endif; ?>
</section>
