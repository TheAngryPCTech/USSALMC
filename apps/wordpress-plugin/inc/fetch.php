<?php
/**
 * USSALMC Wiki — core API fetch helpers (list, search, relations, categories).
 * All read the core REST API as the wiki client with the server-side Bearer key.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Low-level GET against the core API. Returns decoded array or WP_Error. */
function ussalmc_wiki_api_get( string $path ) {
	$key = ussalmc_wiki_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_key', 'USSALMC Wiki is not configured with an API key.' );
	}
	$res = wp_remote_get(
		ussalmc_wiki_api_base() . $path,
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
	return $body;
}

/**
 * Low-level POST against the core API (server-side key never reaches the
 * browser). Used for field confirm/flag signals. Returns [ decoded body,
 * http status code ] or a WP_Error if the request itself failed.
 */
function ussalmc_wiki_api_post( string $path, array $body ) {
	$key = ussalmc_wiki_api_key();
	if ( $key === '' ) {
		return new WP_Error( 'ussalmc_no_key', 'USSALMC Wiki is not configured with an API key.' );
	}
	$res = wp_remote_post(
		ussalmc_wiki_api_base() . $path,
		array(
			'timeout' => 8,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
				'Content-Type'  => 'application/json',
			),
			'body'    => wp_json_encode( $body ),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = wp_remote_retrieve_response_code( $res );
	$decoded = json_decode( wp_remote_retrieve_body( $res ), true );
	return array( is_array( $decoded ) ? $decoded : array(), $code );
}

/** Hybrid keyword+semantic search: GET /v1/search?q= */
function ussalmc_wiki_search( string $q, int $limit = 10 ) {
	return ussalmc_wiki_api_get( '/v1/search?q=' . rawurlencode( $q ) . '&limit=' . $limit );
}

/** Entity list (optionally filtered by substring query): GET /v1/entities */
function ussalmc_wiki_list_entities( array $args = array() ) {
	$qs = http_build_query( array_filter( array(
		'type'   => $args['type'] ?? 'item',
		'query'  => $args['query'] ?? '',
		'limit'  => $args['limit'] ?? 200,
		'offset' => $args['offset'] ?? 0,
	) ) );
	return ussalmc_wiki_api_get( '/v1/entities?' . $qs );
}

/** Resolved relations for cross-reference links: GET /v1/entities/:id/relations */
function ussalmc_wiki_entity_relations( string $id ) {
	return ussalmc_wiki_api_get( '/v1/entities/' . rawurlencode( $id ) . '/relations' );
}

/**
 * Category index derived from the entity corpus (attributes.category), since the
 * public /v1 surface groups entities by that field. Returns [ category => [entities] ].
 */
function ussalmc_wiki_categories( int $limit = 200 ) {
	$list = ussalmc_wiki_list_entities( array( 'type' => 'item', 'limit' => $limit ) );
	if ( is_wp_error( $list ) ) {
		return $list;
	}
	$cats = array();
	foreach ( $list['items'] ?? array() as $e ) {
		$cat = ( $e['attributes']['category'] ?? '' ) ?: 'uncategorized';
		$cats[ $cat ][] = array( 'id' => $e['id'] ?? '', 'name' => $e['name'] ?? ( $e['id'] ?? '' ) );
	}
	ksort( $cats );
	return array( 'total' => (int) ( $list['total'] ?? 0 ), 'categories' => $cats );
}

/**
 * Normalize an entity's confidence: the public payload carries it at
 * `source.confidence` (top-level is null). Returns a lowercase class-safe string.
 */
function ussalmc_wiki_confidence( array $entity ): string {
	$c = $entity['confidence'] ?? ( $entity['source']['confidence'] ?? '' );
	$c = strtolower( trim( (string) $c ) );
	return $c !== '' ? $c : 'unknown';
}
