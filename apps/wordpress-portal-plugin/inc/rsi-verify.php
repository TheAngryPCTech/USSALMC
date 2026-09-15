<?php
/**
 * USSALMC Portal — RSI handle ownership verification.
 *
 * Registration collects a claimed RSI handle and issues a one-time token the
 * user pastes into their public RSI profile bio. Verification checks that
 * token via the community StarCitizen-API (https://starcitizen-api.com) —
 * `GET /{apikey}/v1/eager/user/{handle}?json_path=$.profile.bio` — never by
 * fetching robertsspaceindustries.com directly (RSI's Terms of Service
 * explicitly bar bots/scrapers/automated data harvesting from their site;
 * StarCitizen-API is a separate, ToS-permitted third-party service with its
 * own API key + rate limits, which is what this integration actually calls).
 * The key stays server-side only, exactly like the core API's wiki key.
 *
 * A portal account is NOT fully active until this check passes: every widget
 * render (market/stat-readout/module-grid, whether via shortcode or the
 * Elementor widgets) is gated on `ussalmc_verified` user meta.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Resolve the StarCitizen-API key (option first, then env). Server-side only. */
function ussalmc_portal_starcitizen_api_key(): string {
	$key = get_option( 'ussalmc_starcitizen_api_key' );
	if ( ! $key ) {
		$key = getenv( 'STARCITIZEN_API_KEY' ) ?: '';
	}
	return (string) $key;
}

/**
 * Fetch a handle's public RSI profile bio via StarCitizen-API's json_path
 * filter (so the response is just the bio string, not the full profile).
 * Returns the bio string (may be empty), or WP_Error on failure/unknown handle.
 */
function ussalmc_portal_rsi_bio( string $handle ) {
	$key = ussalmc_portal_starcitizen_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_scapi_key', 'RSI verification is not configured (missing StarCitizen-API key).' );
	}
	$url = 'https://api.starcitizen-api.com/' . rawurlencode( $key ) . '/v1/eager/user/'
		. rawurlencode( $handle ) . '?json_path=' . rawurlencode( '$.profile.bio' );
	$res = wp_remote_get( $url, array( 'timeout' => 10 ) );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( $code !== 200 || ! is_array( $body ) ) {
		return new WP_Error( 'ussalmc_scapi_unreachable', 'StarCitizen-API returned HTTP ' . $code . ' (their service may be down).' );
	}
	// Key off `success`, not the `message` text: eager mode has been observed
	// returning success=1 with a stray "json_path malformed." message even
	// though `data` is the correct, real field value (live mode returns a
	// clean "ok" for the same request) — message isn't a reliable pass/fail
	// signal across modes, only `success` is.
	if ( empty( $body['success'] ) ) {
		$msg = (string) ( $body['message'] ?? 'unknown error' );
		return new WP_Error( 'ussalmc_scapi_no_handle', 'StarCitizen-API: ' . $msg );
	}
	return (string) ( $body['data'] ?? '' );
}

/**
 * The verified member's org sid (from the same user lookup, filtered to just
 * $.organization.sid), or null if they're not in an org. WP_Error on failure.
 * Used only after ussalmc_portal_rsi_bio() has already confirmed ownership —
 * this never gates verification itself, it only decides whether to also add
 * their org to the knowledge base (see ussalmc_portal_add_verified_org()).
 */
function ussalmc_portal_rsi_org_sid( string $handle ) {
	$key = ussalmc_portal_starcitizen_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_scapi_key', 'RSI verification is not configured (missing StarCitizen-API key).' );
	}
	$url = 'https://api.starcitizen-api.com/' . rawurlencode( $key ) . '/v1/cache/user/'
		. rawurlencode( $handle ) . '?json_path=' . rawurlencode( '$.organization.sid' );
	$res = wp_remote_get( $url, array( 'timeout' => 10 ) );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $body ) || empty( $body['success'] ) ) {
		return null; // no org, or lookup failed — never blocks verification either way
	}
	$sid = $body['data'] ?? null;
	return is_string( $sid ) && $sid !== '' ? $sid : null;
}

/**
 * Full org details by sid (archetype/commitment/focus/banner/logo only —
 * deliberately NEVER the org's charter/manifesto/headline text or member
 * roster: those are member-authored prose and other members' identities,
 * both out of scope for a lore knowledge base). WP_Error on failure.
 */
function ussalmc_portal_rsi_org_details( string $sid ) {
	$key = ussalmc_portal_starcitizen_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_scapi_key', 'RSI verification is not configured (missing StarCitizen-API key).' );
	}
	$url = 'https://api.starcitizen-api.com/' . rawurlencode( $key ) . '/v1/cache/organization/' . rawurlencode( $sid );
	$res = wp_remote_get( $url, array( 'timeout' => 10 ) );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $body ) || empty( $body['success'] ) || ! is_array( $body['data'] ?? null ) ) {
		return new WP_Error( 'ussalmc_scapi_org_lookup_failed', 'Could not look up organization "' . $sid . '".' );
	}
	$d = $body['data'];
	return array(
		'sid'            => $sid,
		'name'           => $d['name'] ?? $sid,
		'archetype'      => $d['archetype'] ?? null,
		'commitment'     => $d['commitment'] ?? null,
		'focus_primary'  => $d['focus']['primary']['name'] ?? null,
		'focus_secondary'=> $d['focus']['secondary']['name'] ?? null,
		'banner'         => $d['banner'] ?? null,
		'logo'           => $d['logo'] ?? null,
		'url'            => $d['url'] ?? null,
	);
}

/**
 * Called right after a successful bio verification: looks up the member's
 * org (if any) and submits it to the core API's POST /v1/organizations/submit
 * (portal-client-only — see apps/api/src/routes.ts + organizations.ts).
 * Never blocks or fails verification itself — an org lookup/submit problem
 * is logged (error_log) and swallowed, since the member's identity is already
 * confirmed at this point regardless of org data availability.
 */
function ussalmc_portal_add_verified_org( string $handle ): void {
	$sid = ussalmc_portal_rsi_org_sid( $handle );
	if ( is_wp_error( $sid ) || $sid === null ) {
		return; // no org, or a lookup hiccup — not fatal to verification
	}
	$details = ussalmc_portal_rsi_org_details( $sid );
	if ( is_wp_error( $details ) ) {
		error_log( 'USSALMC: org details lookup failed for ' . $sid . ': ' . $details->get_error_message() );
		return;
	}
	$result = ussalmc_portal_submit_organization( array_merge( $details, array( 'verified_by_handle' => $handle ) ) );
	if ( is_wp_error( $result ) ) {
		error_log( 'USSALMC: org submit failed for ' . $sid . ': ' . $result->get_error_message() );
	}
}

/**
 * POST /v1/organizations/submit as the portal client (the same dedicated key
 * as trade submission — ussalmc_portal_trade_api_key(), defined in
 * inc/trade-submit.php; despite the name it's the portal's one core-API
 * identity, not trade-specific). Restricted server-side to that client, same
 * as the trade rsi_verified boundary. Returns [decoded body, http status] or
 * WP_Error.
 */
function ussalmc_portal_submit_organization( array $org ) {
	$key = ussalmc_portal_trade_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_portal_key', 'Organization submission is not configured (missing portal API key).' );
	}
	$res = wp_remote_post(
		ussalmc_portal_api_base() . '/v1/organizations/submit',
		array(
			'timeout' => 8,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
				'Content-Type'  => 'application/json',
			),
			'body' => wp_json_encode( $org ),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	if ( $code >= 300 ) {
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		$msg  = $body['error']['message'] ?? ( 'core API returned HTTP ' . $code );
		return new WP_Error( 'ussalmc_org_submit_failed', $msg );
	}
	return json_decode( wp_remote_retrieve_body( $res ), true );
}

/** Random verification token, e.g. VERIFY-7F92K3-CITIZEN. */
function ussalmc_portal_generate_verify_token(): string {
	return 'VERIFY-' . strtoupper( wp_generate_password( 6, false, false ) ) . '-CITIZEN';
}

/** True if this user doesn't need gating (guests) or has completed RSI verification. */
function ussalmc_portal_is_verified( int $user_id = 0 ): bool {
	if ( ! $user_id ) {
		if ( ! is_user_logged_in() ) {
			return true; // gate only applies to logged-in, unverified accounts
		}
		$user_id = get_current_user_id();
	}
	return get_user_meta( $user_id, 'ussalmc_verified', true ) === '1';
}

/**
 * Access gate for portal widgets: null = proceed normally, otherwise the HTML
 * to show instead (a "verify your RSI handle first" notice). Call at the top
 * of every widget render function so shortcode + Elementor entry points are
 * both covered by one check.
 */
function ussalmc_portal_verify_gate(): ?string {
	if ( ussalmc_portal_is_verified() ) {
		return null;
	}
	ob_start(); ?>
	<div class="panel" data-widget="ussalmc-verify-gate">
		<div class="panel-head"><h2>Verification Required</h2></div>
		<div class="panel-body">
			<p>Your account isn't active yet. Finish RSI handle verification to unlock the portal.</p>
			<p><?php echo do_shortcode( '[ussalmc_verify]' ); ?></p>
		</div>
	</div>
	<?php
	return (string) ob_get_clean();
}

/**
 * [ussalmc_register] — custom registration form (RSI handle required).
 * Replaces relying on wp-login.php?action=register for portal accounts: this
 * is the only path that also collects + tracks the claimed RSI handle.
 */
add_shortcode( 'ussalmc_register', function () {
	if ( is_user_logged_in() ) {
		return do_shortcode( '[ussalmc_verify]' );
	}
	$error = isset( $_GET['ussalmc_reg_error'] ) ? sanitize_text_field( wp_unslash( $_GET['ussalmc_reg_error'] ) ) : '';
	ob_start(); ?>
	<div class="panel" data-widget="ussalmc-register">
		<div class="panel-head"><h2>Create Account</h2></div>
		<div class="panel-body">
			<?php if ( $error ) : ?>
				<p class="ussalmc-error"><?php echo esc_html( $error ); ?></p>
			<?php endif; ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="ussalmc_register" />
				<?php wp_nonce_field( 'ussalmc_register' ); ?>
				<p><label>Username<br /><input type="text" name="username" required /></label></p>
				<p><label>Email<br /><input type="email" name="email" required /></label></p>
				<p><label>Password<br /><input type="password" name="password" required /></label></p>
				<p><label>RSI Handle<br /><input type="text" name="rsi_handle" required
					placeholder="Your exact robertsspaceindustries.com handle" /></label></p>
				<p><button type="submit">Register</button></p>
			</form>
		</div>
	</div>
	<?php
	return (string) ob_get_clean();
} );

add_action( 'admin_post_nopriv_ussalmc_register', 'ussalmc_portal_handle_register' );
function ussalmc_portal_handle_register() {
	check_admin_referer( 'ussalmc_register' );
	$username = sanitize_user( wp_unslash( $_POST['username'] ?? '' ) );
	$email    = sanitize_email( wp_unslash( $_POST['email'] ?? '' ) );
	$password = (string) ( $_POST['password'] ?? '' );
	$handle   = sanitize_text_field( wp_unslash( $_POST['rsi_handle'] ?? '' ) );

	$redirect_back = wp_get_referer() ?: home_url( '/' );
	if ( $username === '' || $email === '' || $password === '' || $handle === '' ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_reg_error', rawurlencode( 'All fields are required.' ), $redirect_back ) );
		exit;
	}
	if ( username_exists( $username ) || email_exists( $email ) ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_reg_error', rawurlencode( 'That username or email is already registered.' ), $redirect_back ) );
		exit;
	}
	$user_id = wp_insert_user( array(
		'user_login' => $username,
		'user_email' => $email,
		'user_pass'  => $password,
		'role'       => 'subscriber',
	) );
	if ( is_wp_error( $user_id ) ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_reg_error', rawurlencode( $user_id->get_error_message() ), $redirect_back ) );
		exit;
	}
	update_user_meta( $user_id, 'ussalmc_sc_handle', $handle );
	update_user_meta( $user_id, 'ussalmc_verify_token', ussalmc_portal_generate_verify_token() );
	update_user_meta( $user_id, 'ussalmc_verified', '0' );
	update_user_meta( $user_id, 'ussalmc_verify_last_check', 0 );

	wp_set_current_user( $user_id );
	wp_set_auth_cookie( $user_id );
	wp_safe_redirect( home_url( '/' ) );
	exit;
}

/**
 * [ussalmc_verify] — shows the pending token + a Verify button for the
 * logged-in, not-yet-verified user. Renders nothing useful for guests
 * (registration happens via [ussalmc_register]) or already-verified users.
 */
add_shortcode( 'ussalmc_verify', function () {
	if ( ! is_user_logged_in() ) {
		return do_shortcode( '[ussalmc_register]' );
	}
	$user_id = get_current_user_id();
	if ( ussalmc_portal_is_verified( $user_id ) ) {
		return '<div class="panel"><div class="panel-body"><p>Your RSI handle is verified. o7</p></div></div>';
	}
	$handle  = get_user_meta( $user_id, 'ussalmc_sc_handle', true );
	$token   = get_user_meta( $user_id, 'ussalmc_verify_token', true );
	$notice  = isset( $_GET['ussalmc_verify_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['ussalmc_verify_notice'] ) ) : '';
	ob_start(); ?>
	<div class="panel" data-widget="ussalmc-verify">
		<div class="panel-head"><h2>Verify RSI Handle: <?php echo esc_html( $handle ); ?></h2></div>
		<div class="panel-body">
			<?php if ( $notice ) : ?><p class="ussalmc-error"><?php echo esc_html( $notice ); ?></p><?php endif; ?>
			<p>Paste this token anywhere in your RSI profile's Bio / Short Description, save it, then click Verify:</p>
			<p><code><?php echo esc_html( $token ); ?></code></p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="ussalmc_verify_rsi" />
				<?php wp_nonce_field( 'ussalmc_verify_rsi' ); ?>
				<button type="submit">Verify Now</button>
			</form>
			<p>Once verified, you can remove the token from your bio.</p>
		</div>
	</div>
	<?php
	return (string) ob_get_clean();
} );

add_action( 'admin_post_ussalmc_verify_rsi', function () {
	check_admin_referer( 'ussalmc_verify_rsi' );
	if ( ! is_user_logged_in() ) {
		wp_safe_redirect( home_url( '/' ) );
		exit;
	}
	$user_id = get_current_user_id();
	$redirect_back = wp_get_referer() ?: home_url( '/' );

	// Cooldown: each check spends one of the shared StarCitizen-API live-mode
	// requests (1000/day, site-wide) — don't let rapid re-clicks drain it.
	$last = (int) get_user_meta( $user_id, 'ussalmc_verify_last_check', true );
	if ( $last && ( time() - $last ) < 30 ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_verify_notice', rawurlencode( 'Please wait a bit before trying again.' ), $redirect_back ) );
		exit;
	}
	update_user_meta( $user_id, 'ussalmc_verify_last_check', time() );

	$handle = (string) get_user_meta( $user_id, 'ussalmc_sc_handle', true );
	$token  = (string) get_user_meta( $user_id, 'ussalmc_verify_token', true );
	$bio    = ussalmc_portal_rsi_bio( $handle );
	if ( is_wp_error( $bio ) ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_verify_notice', rawurlencode( $bio->get_error_message() ), $redirect_back ) );
		exit;
	}
	if ( $token === '' || strpos( (string) $bio, $token ) === false ) {
		wp_safe_redirect( add_query_arg( 'ussalmc_verify_notice', rawurlencode( "Token not found in that handle's bio yet — save your profile and try again." ), $redirect_back ) );
		exit;
	}
	update_user_meta( $user_id, 'ussalmc_verified', '1' );
	delete_user_meta( $user_id, 'ussalmc_verify_token' );
	ussalmc_portal_add_verified_org( $handle );
	wp_safe_redirect( home_url( '/' ) );
	exit;
} );
