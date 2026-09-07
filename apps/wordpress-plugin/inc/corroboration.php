<?php
/**
 * USSALMC Wiki — field-level corroboration (green confirm) and correction
 * (red flag) UI + AJAX handlers. Renders inline so it works whether or not
 * the active theme styles it (matches the plugin-default-vs-theme-override
 * pattern already used for entity.php).
 *
 * Attribution: uses the logged-in WordPress username when available, else
 * 'anonymous'. Rate limiting + abuse handling live server-side in the core
 * API (apps/api/src/field-signals.ts) — this layer just forwards the click.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The WordPress identity to attribute a signal to. */
function ussalmc_wiki_current_username(): string {
	if ( is_user_logged_in() ) {
		$user = wp_get_current_user();
		if ( $user && $user->user_login ) {
			return $user->user_login;
		}
	}
	return 'anonymous';
}

/**
 * Render the green-confirm / red-flag controls for one field. $field is the
 * encoding the core API + admin tool understand: 'name' | 'summary' | 'body'
 * | 'attr:<key>'. $value is the field's current display value (shown back to
 * the reviewer, and sent along so "confirmed" always records what was true
 * at the time).
 */
function ussalmc_wiki_field_actions( string $entity_id, string $field, $value ): string {
	$value_str = is_scalar( $value ) ? (string) $value : '';
	ob_start();
	?>
	<span class="ussalmc-field-actions" style="display:inline-flex;gap:6px;margin-left:8px;vertical-align:middle"
		data-entity="<?php echo esc_attr( $entity_id ); ?>"
		data-field="<?php echo esc_attr( $field ); ?>"
		data-value="<?php echo esc_attr( $value_str ); ?>">
		<button type="button" class="ussalmc-confirm-btn" title="Confirm this is correct"
			style="background:transparent;border:1px solid var(--green,#4FD1A5);color:var(--green,#4FD1A5);font-size:11px;line-height:1;padding:3px 7px;cursor:pointer;border-radius:2px">✓</button>
		<button type="button" class="ussalmc-flag-btn" title="Flag this as wrong / suggest a correction"
			style="background:transparent;border:1px solid var(--red,#E86B5A);color:var(--red,#E86B5A);font-size:11px;line-height:1;padding:3px 7px;cursor:pointer;border-radius:2px">✕</button>
		<span class="ussalmc-field-status" style="font-size:11px;opacity:.7"></span>
	</span>
	<?php
	return ob_get_clean();
}

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_script(
		'ussalmc-corroboration',
		plugins_url( 'assets/js/corroboration.js', dirname( __FILE__ ) ),
		array(),
		'0.1.0',
		true
	);
	wp_localize_script( 'ussalmc-corroboration', 'USSALMC_SIGNAL', array(
		'ajax_url' => admin_url( 'admin-ajax.php' ),
		'nonce'    => wp_create_nonce( 'ussalmc_wiki_signal' ),
	) );
} );

function ussalmc_wiki_ajax_confirm_field() {
	check_ajax_referer( 'ussalmc_wiki_signal', 'nonce' );
	$entity_id = sanitize_text_field( wp_unslash( $_POST['entity_id'] ?? '' ) );
	$field     = sanitize_text_field( wp_unslash( $_POST['field'] ?? '' ) );
	$value     = sanitize_text_field( wp_unslash( $_POST['value'] ?? '' ) );
	if ( $entity_id === '' || $field === '' ) {
		wp_send_json_error( array( 'message' => 'Missing entity_id or field.' ), 400 );
	}
	list( $body, $code ) = ussalmc_wiki_api_post( "/v1/entities/$entity_id/fields/confirm", array(
		'field'         => $field,
		'current_value' => $value,
		'submitted_by'  => ussalmc_wiki_current_username(),
	) );
	if ( $code === 201 ) {
		wp_send_json_success( $body );
	}
	wp_send_json_error( array( 'message' => $body['error']['message'] ?? "core API returned HTTP $code" ), $code ?: 502 );
}
add_action( 'wp_ajax_ussalmc_confirm_field', 'ussalmc_wiki_ajax_confirm_field' );
add_action( 'wp_ajax_nopriv_ussalmc_confirm_field', 'ussalmc_wiki_ajax_confirm_field' );

function ussalmc_wiki_ajax_flag_field() {
	check_ajax_referer( 'ussalmc_wiki_signal', 'nonce' );
	$entity_id = sanitize_text_field( wp_unslash( $_POST['entity_id'] ?? '' ) );
	$field     = sanitize_text_field( wp_unslash( $_POST['field'] ?? '' ) );
	$value     = sanitize_text_field( wp_unslash( $_POST['value'] ?? '' ) );
	$suggested = sanitize_text_field( wp_unslash( $_POST['suggested'] ?? '' ) );
	$note      = sanitize_textarea_field( wp_unslash( $_POST['note'] ?? '' ) );
	if ( $entity_id === '' || $field === '' || $suggested === '' ) {
		wp_send_json_error( array( 'message' => 'Missing entity_id, field, or suggested value.' ), 400 );
	}
	list( $body, $code ) = ussalmc_wiki_api_post( "/v1/entities/$entity_id/fields/flag", array(
		'field'           => $field,
		'current_value'   => $value,
		'suggested_value' => $suggested,
		'note'            => $note !== '' ? $note : null,
		'submitted_by'    => ussalmc_wiki_current_username(),
	) );
	if ( $code === 201 ) {
		wp_send_json_success( $body );
	}
	wp_send_json_error( array( 'message' => $body['error']['message'] ?? "core API returned HTTP $code" ), $code ?: 502 );
}
add_action( 'wp_ajax_ussalmc_flag_field', 'ussalmc_wiki_ajax_flag_field' );
add_action( 'wp_ajax_nopriv_ussalmc_flag_field', 'ussalmc_wiki_ajax_flag_field' );
