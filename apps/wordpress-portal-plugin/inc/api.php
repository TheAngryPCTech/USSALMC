<?php
/**
 * USSALMC Portal — core API client.
 *
 * Reuses the same wp_options the wiki plugin sets at container startup
 * (`ussalmc_api_base`, `ussalmc_api_key`) so the portal reads the core REST API
 * with no separate configuration. Key stays server-side, never sent to browser.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function ussalmc_portal_api_base(): string {
	$base = get_option( 'ussalmc_api_base' );
	if ( ! $base ) {
		$base = getenv( 'USSALMC_API_BASE' ) ?: 'http://api:3000';
	}
	return rtrim( (string) $base, '/' );
}

function ussalmc_portal_api_key(): string {
	$key = get_option( 'ussalmc_api_key' );
	if ( ! $key ) {
		$key = getenv( 'USSALMC_API_KEY' ) ?: '';
	}
	return (string) $key;
}

/**
 * GET {base}{path} as the wiki/portal client. $path must start with '/'.
 * Returns decoded array or WP_Error. Cached in a short transient (volatile data).
 */
function ussalmc_portal_api_get( string $path, int $ttl = 30 ) {
	$key = ussalmc_portal_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_key', 'Portal is not configured with a core API key.' );
	}
	$cache_key = 'ussa_portal_' . md5( $path );
	if ( $ttl > 0 ) {
		$hit = get_transient( $cache_key );
		if ( is_array( $hit ) ) {
			return $hit;
		}
	}
	$res = wp_remote_get(
		ussalmc_portal_api_base() . $path,
		array(
			'timeout' => 8,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
			),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( $code !== 200 || ! is_array( $body ) ) {
		$msg = is_array( $body ) && isset( $body['error']['message'] )
			? $body['error']['message']
			: ( 'core API returned HTTP ' . $code );
		return new WP_Error( 'ussalmc_api_error', $msg );
	}
	if ( $ttl > 0 ) {
		set_transient( $cache_key, $body, $ttl );
	}
	return $body;
}
