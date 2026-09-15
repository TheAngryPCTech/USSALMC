<?php
/**
 * USSALMC Portal — per-user trade-submission log.
 *
 * Ties each gated trade submission (inc/trade-submit.php) to the WordPress
 * account that made it, so a member's contribution history is queryable —
 * "for future reference and potential gamification" (leaderboards/badges
 * later; this phase only lays the data model + a running count + a visible
 * history, not the full gamification UI).
 *
 * Lives in a plugin-owned custom table (WordPress convention for this kind
 * of thing — separate from the core API's own Postgres `trade_route_submissions`,
 * which stays the source of truth for the actual route data; this table is
 * just "which WP user did which submission, when"). Self-healing: creates/
 * upgrades the table on `plugins_loaded` via a version check, not only on
 * activation, so it also applies correctly to an already-active install.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'USSALMC_TRADE_LOG_DB_VERSION', '1.0' );

function ussalmc_portal_trade_log_table(): string {
	global $wpdb;
	return $wpdb->prefix . 'ussalmc_trade_log';
}

function ussalmc_portal_trade_log_install(): void {
	if ( get_option( 'ussalmc_trade_log_db_version' ) === USSALMC_TRADE_LOG_DB_VERSION ) {
		return;
	}
	global $wpdb;
	$table           = ussalmc_portal_trade_log_table();
	$charset_collate = $wpdb->get_charset_collate();
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( "CREATE TABLE {$table} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		user_id BIGINT UNSIGNED NOT NULL,
		rsi_handle VARCHAR(64) NOT NULL,
		route_id VARCHAR(64) NOT NULL,
		commodity VARCHAR(191) NOT NULL,
		from_location VARCHAR(191) NOT NULL,
		to_location VARCHAR(191) NOT NULL,
		outcome VARCHAR(32) NOT NULL,
		confidence VARCHAR(32) NOT NULL,
		buy_price DECIMAL(14,2) NULL,
		sell_price DECIMAL(14,2) NULL,
		submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY  (id),
		KEY user_id (user_id),
		KEY route_id (route_id)
	) {$charset_collate};" );
	update_option( 'ussalmc_trade_log_db_version', USSALMC_TRADE_LOG_DB_VERSION );
}
add_action( 'plugins_loaded', 'ussalmc_portal_trade_log_install' );

/**
 * Record one successful submission against the WP user who made it, and bump
 * their running count (usermeta `ussalmc_trade_submission_count`) — the seed
 * for a future leaderboard/badge system.
 */
function ussalmc_portal_log_trade_submission( int $user_id, string $handle, array $input, array $result ): void {
	global $wpdb;
	$wpdb->insert(
		ussalmc_portal_trade_log_table(),
		array(
			'user_id'       => $user_id,
			'rsi_handle'    => $handle,
			'route_id'      => (string) ( $result['id'] ?? '' ),
			'commodity'     => (string) $input['commodity'],
			'from_location' => (string) $input['from_location'],
			'to_location'   => (string) $input['to_location'],
			'outcome'       => (string) ( $result['outcome'] ?? 'unknown' ),
			'confidence'    => (string) ( $result['confidence'] ?? 'unknown' ),
			'buy_price'     => $input['buy_price'],
			'sell_price'    => $input['sell_price'],
		),
		array( '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%f', '%f' )
	);
	$count = (int) get_user_meta( $user_id, 'ussalmc_trade_submission_count', true );
	update_user_meta( $user_id, 'ussalmc_trade_submission_count', $count + 1 );
}

/** This user's submission count (0 if none yet). */
function ussalmc_portal_trade_submission_count( int $user_id ): int {
	return (int) get_user_meta( $user_id, 'ussalmc_trade_submission_count', true );
}

/** This user's most recent submissions, newest first. */
function ussalmc_portal_user_trade_log( int $user_id, int $limit = 20 ): array {
	global $wpdb;
	$table = ussalmc_portal_trade_log_table();
	return $wpdb->get_results(
		$wpdb->prepare(
			"SELECT commodity, from_location, to_location, outcome, confidence, buy_price, sell_price, submitted_at
			 FROM {$table} WHERE user_id = %d ORDER BY submitted_at DESC LIMIT %d",
			$user_id, $limit
		),
		ARRAY_A
	) ?: array();
}
