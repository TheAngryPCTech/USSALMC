<?php
/**
 * USSALMC Portal — gated trade-route submission.
 *
 * [ussalmc_trade_submit] lets an RSI-handle-verified member submit trade data
 * straight into the core API's confidence ladder, starting at 'corroborated'
 * instead of the anonymous default 'community' — since we already know who
 * they really are (see inc/rsi-verify.php). Uses a SEPARATE API key
 * (PORTAL_API_KEY / ussalmc_portal_trade_api_key) from the shared wiki key:
 * the core API only ever honors `rsi_verified` from that one client (see
 * apps/api/src/routes.ts), so no other caller — including the fully
 * anonymous, unauthenticated trade-submit app that already exists — can
 * spoof the trust boost by just setting a flag in its own request.
 *
 * The form itself is gated via ussalmc_portal_verify_gate() (same as the
 * other 3 widgets), but the admin-post handler ALSO independently re-checks
 * verification server-side — admin-post.php is directly reachable by URL
 * regardless of what any shortcode renders, so the real gate has to live
 * there, not just in the form's visibility.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function ussalmc_portal_trade_api_key(): string {
	$key = get_option( 'ussalmc_portal_trade_api_key' );
	if ( ! $key ) {
		$key = getenv( 'PORTAL_API_KEY' ) ?: '';
	}
	return (string) $key;
}

/** POST /v1/trade-routes/submit as the portal client. Returns [decoded body, http status] or WP_Error. */
function ussalmc_portal_submit_trade( array $body ) {
	$key = ussalmc_portal_trade_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_portal_key', 'Trade submission is not configured (missing portal API key).' );
	}
	$res = wp_remote_post(
		ussalmc_portal_api_base() . '/v1/trade-routes/submit',
		array(
			'timeout' => 8,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
				'Content-Type'  => 'application/json',
			),
			'body' => wp_json_encode( $body ),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$decoded = json_decode( wp_remote_retrieve_body( $res ), true );
	return array( is_array( $decoded ) ? $decoded : array(), $code );
}

add_shortcode( 'ussalmc_trade_submit', function () {
	$gate = ussalmc_portal_verify_gate();
	if ( $gate !== null ) {
		return $gate;
	}
	$notice  = isset( $_GET['ussalmc_trade_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['ussalmc_trade_notice'] ) ) : '';
	$user_id = get_current_user_id();
	$handle  = get_user_meta( $user_id, 'ussalmc_sc_handle', true );
	$count   = ussalmc_portal_trade_submission_count( $user_id );
	$history = ussalmc_portal_user_trade_log( $user_id, 10 );
	ob_start(); ?>
	<div class="panel" data-widget="ussalmc-trade-submit">
		<div class="panel-head"><h2>Submit Trade Data</h2></div>
		<div class="panel-body">
			<?php if ( $notice ) : ?><p class="ussalmc-error"><?php echo esc_html( $notice ); ?></p><?php endif; ?>
			<p>Submitting as verified citizen <strong><?php echo esc_html( $handle ); ?></strong> — your reports start at
				<strong>corroborated</strong> confidence instead of the anonymous default.</p>
			<p class="ussalmc-trade-count"><?php echo esc_html( $count ); ?> trade report<?php echo $count === 1 ? '' : 's'; ?> submitted so far.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="ussalmc_trade_submit" />
				<?php wp_nonce_field( 'ussalmc_trade_submit' ); ?>
				<p><label>Commodity<br /><input type="text" name="commodity" required /></label></p>
				<p><label>From<br /><input type="text" name="from_location" required /></label></p>
				<p><label>To<br /><input type="text" name="to_location" required /></label></p>
				<p><label>Buy price<br /><input type="number" step="0.01" name="buy_price" /></label></p>
				<p><label>Sell price<br /><input type="number" step="0.01" name="sell_price" /></label></p>
				<p><button type="submit">Submit</button></p>
			</form>
			<?php if ( $history ) : ?>
				<h3>Your recent submissions</h3>
				<table class="ussalmc-trade-history">
					<thead><tr><th>When</th><th>Commodity</th><th>Route</th><th>Outcome</th><th>Confidence</th></tr></thead>
					<tbody>
						<?php foreach ( $history as $row ) : ?>
							<tr>
								<td><?php echo esc_html( mysql2date( 'Y-m-d H:i', $row['submitted_at'] ) ); ?></td>
								<td><?php echo esc_html( $row['commodity'] ); ?></td>
								<td><?php echo esc_html( $row['from_location'] . ' → ' . $row['to_location'] ); ?></td>
								<td><?php echo esc_html( $row['outcome'] ); ?></td>
								<td><?php echo esc_html( $row['confidence'] ); ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
	</div>
	<?php
	return (string) ob_get_clean();
} );

add_action( 'admin_post_ussalmc_trade_submit', function () {
	check_admin_referer( 'ussalmc_trade_submit' );
	$redirect_back = wp_get_referer() ?: home_url( '/' );

	// Re-check verification server-side — never trust that only the gated
	// shortcode's form could have reached this handler.
	if ( ! is_user_logged_in() || ! ussalmc_portal_is_verified() ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_trade_notice', rawurlencode( 'Your account must be RSI-verified to submit trade data.' ), $redirect_back ) );
		exit;
	}

	$commodity = sanitize_text_field( wp_unslash( $_POST['commodity'] ?? '' ) );
	$from      = sanitize_text_field( wp_unslash( $_POST['from_location'] ?? '' ) );
	$to        = sanitize_text_field( wp_unslash( $_POST['to_location'] ?? '' ) );
	$buy       = isset( $_POST['buy_price'] ) && $_POST['buy_price'] !== '' ? (float) $_POST['buy_price'] : null;
	$sell      = isset( $_POST['sell_price'] ) && $_POST['sell_price'] !== '' ? (float) $_POST['sell_price'] : null;
	if ( $commodity === '' || $from === '' || $to === '' ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_trade_notice', rawurlencode( 'Commodity, from, and to are required.' ), $redirect_back ) );
		exit;
	}

	$user_id = get_current_user_id();
	$handle  = (string) get_user_meta( $user_id, 'ussalmc_sc_handle', true );
	$input   = array(
		'commodity'     => $commodity,
		'from_location' => $from,
		'to_location'   => $to,
		'buy_price'     => $buy,
		'sell_price'    => $sell,
	);
	$result = ussalmc_portal_submit_trade( array_merge( $input, array(
		'account'             => $handle,
		'rsi_verified'        => true,
		'rsi_verified_handle' => $handle,
	) ) );
	if ( is_wp_error( $result ) ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_trade_notice', rawurlencode( $result->get_error_message() ), $redirect_back ) );
		exit;
	}
	list( $body, $code ) = $result;
	if ( $code >= 300 ) {
		$msg = $body['error']['message'] ?? ( 'Core API returned HTTP ' . $code );
		wp_safe_redirect( add_query_arg( 'ussalmc_trade_notice', rawurlencode( $msg ), $redirect_back ) );
		exit;
	}
	// Tie this submission to the WP account that made it — for their own
	// history view and any future gamification (leaderboards/badges).
	ussalmc_portal_log_trade_submission( $user_id, $handle, $input, $body );
	wp_safe_redirect( add_query_arg( 'ussalmc_trade_notice', rawurlencode( 'Submitted — ' . ( $body['note'] ?? 'thanks!' ) ), $redirect_back ) );
	exit;
} );
