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
	if ( is_array( $img ) && ( $img['role'] ?? '' ) === 'primary' && ! empty( $img['url'] ) ) { $hero = $img; break; }
}
if ( ! $hero ) {
	foreach ( $images as $img ) { if ( is_array( $img ) && ! empty( $img['url'] ) ) { $hero = $img; break; } }
}

// Attributes/stats: skip category (shown in breadcrumb) and empty/complex values.
$attrs = ( isset( $entity['attributes'] ) && is_array( $entity['attributes'] ) ) ? $entity['attributes'] : array();
$stats = array();
foreach ( $attrs as $k => $v ) {
	if ( $k === 'category' ) { continue; }
	if ( is_array( $v ) || is_object( $v ) ) { continue; }
	$v = trim( (string) $v );
	if ( $v === '' ) { continue; }
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

	<?php if ( $hero ) : ?>
		<figure class="ussalmc-entity__media" style="margin:16px 0 0">
			<img class="ussalmc-entity__hero" src="<?php echo esc_url( $hero['url'] ); ?>" alt="<?php echo esc_attr( $hero['caption'] ?? $name ); ?>" loading="lazy" style="display:block;width:100%;max-width:560px;height:auto;border:1px solid var(--line-bright,#333)" />
			<?php if ( ! empty( $hero['caption'] ) ) : ?><figcaption style="font-size:11px;opacity:.6;margin-top:6px"><?php echo esc_html( $hero['caption'] ); ?></figcaption><?php endif; ?>
		</figure>
		<?php if ( count( $images ) > 1 ) : ?>
			<div class="ussalmc-entity__gallery" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
				<?php foreach ( $images as $img ) :
					if ( ! is_array( $img ) || empty( $img['url'] ) || $img['url'] === $hero['url'] ) { continue; }
					?>
					<a class="ussalmc-thumb" href="<?php echo esc_url( $img['url'] ); ?>" target="_blank" rel="noopener" style="display:block;width:84px;height:56px;border:1px solid var(--line,#333);overflow:hidden">
						<img src="<?php echo esc_url( $img['url'] ); ?>" alt="<?php echo esc_attr( $img['caption'] ?? $name ); ?>" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" />
					</a>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
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
