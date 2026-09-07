<?php
/**
 * USSALMC Wiki — SSO handoff from wp-admin into the USSA Admin tool.
 * Adds a top-level wp-admin menu page ("USSA Admin") that embeds the admin
 * app via an iframe with a short-lived, HMAC-signed token in the URL. The
 * admin app verifies the token, matches the email against admin_users, and
 * either signs the visitor straight in (no separate login prompt) or shows a
 * themed "no matching account" error — see apps/admin/src/server.ts (GET /sso).
 *
 * Config (option first, then env, matching the pattern used for the API
 * base/key elsewhere in this plugin):
 *   ussalmc_admin_url    browser-reachable admin app base, e.g. http://localhost:8091
 *   ussalmc_sso_secret   shared HMAC secret (must match ADMIN_SSO_SECRET on the admin app)
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function ussalmc_admin_url(): string {
	$url = get_option( 'ussalmc_admin_url' );
	if ( ! $url ) {
		$url = getenv( 'ADMIN_APP_PUBLIC_URL' ) ?: 'http://localhost:8091';
	}
	return rtrim( (string) $url, '/' );
}

function ussalmc_sso_secret(): string {
	$secret = get_option( 'ussalmc_sso_secret' );
	if ( ! $secret ) {
		$secret = getenv( 'ADMIN_SSO_SECRET' ) ?: '';
	}
	return (string) $secret;
}

function ussalmc_base64url_encode( string $data ): string {
	return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
}

/** Build a short-lived (120s) signed token for the given WP user. */
function ussalmc_generate_sso_token( WP_User $user ): ?string {
	$secret = ussalmc_sso_secret();
	if ( $secret === '' || ! $user->user_email ) {
		return null;
	}
	$payload = wp_json_encode( array(
		'email'        => $user->user_email,
		'display_name' => $user->display_name,
		'exp'          => ( time() + 120 ) * 1000, // ms, to match the admin app's Date.now()
	) );
	$b64 = ussalmc_base64url_encode( $payload );
	$sig = hash_hmac( 'sha256', $b64, $secret );
	return $b64 . '.' . $sig;
}

add_action( 'admin_menu', function () {
	add_menu_page(
		'USSA Admin',
		'USSA Admin',
		'manage_options',
		'ussalmc-admin',
		'ussalmc_render_admin_page',
		'dashicons-shield',
		3
	);
} );

function ussalmc_render_admin_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Insufficient permissions.' );
	}
	$secret = ussalmc_sso_secret();
	echo '<div class="wrap" style="margin:0"><h1 class="wp-heading-inline" style="padding:12px 12px 0">USSA Admin</h1>';
	if ( $secret === '' ) {
		echo '<div class="notice notice-error" style="margin:12px"><p>USSALMC Wiki is not configured with an SSO secret (<code>ussalmc_sso_secret</code> option / <code>ADMIN_SSO_SECRET</code> env). The USSA Admin tool cannot be embedded until this is set.</p></div>';
		return;
	}
	$token = ussalmc_generate_sso_token( wp_get_current_user() );
	$src   = ussalmc_admin_url() . '/sso?token=' . rawurlencode( (string) $token );
	echo '<iframe src="' . esc_url( $src ) . '" style="width:100%;height:calc(100vh - 140px);border:0;display:block;margin-top:8px;background:#0A0E14"></iframe></div>';
}
