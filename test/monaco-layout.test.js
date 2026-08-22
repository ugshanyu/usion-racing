import test from 'node:test';
import assert from 'node:assert/strict';

import {
	MONACO_OFFICIAL_LENGTH_METERS,
	MONACO_ROUTE_METERS,
	MONACO_SOURCE_LENGTH_METERS,
	MONACO_TURN_COUNT,
	MONACO_WORLD_SCALE,
} from '../js/MonacoLayout.js';

function closedLength( points ) {

	let length = 0;

	for ( let i = 0; i < points.length; i ++ ) {

		const a = points[ i ];
		const b = points[ ( i + 1 ) % points.length ];
		length += Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

	}

	return length;

}

test( 'Monaco route retains the official silhouette and arcade-scale length', () => {

	const simplifiedLength = closedLength( MONACO_ROUTE_METERS );
	assert.equal( MONACO_TURN_COUNT, 19 );
	assert.equal( MONACO_OFFICIAL_LENGTH_METERS, 3337 );
	assert.ok( MONACO_ROUTE_METERS.length >= 160 );
	assert.ok( Math.abs( MONACO_SOURCE_LENGTH_METERS - MONACO_OFFICIAL_LENGTH_METERS ) < 2 );
	assert.ok( Math.abs( simplifiedLength - MONACO_SOURCE_LENGTH_METERS ) < 3 );
	assert.ok( Math.abs( simplifiedLength * MONACO_WORLD_SCALE - 260 ) < 0.1 );

	const xs = MONACO_ROUTE_METERS.map( ( point ) => point[ 0 ] );
	const zs = MONACO_ROUTE_METERS.map( ( point ) => point[ 1 ] );
	assert.ok( Math.max( ...xs ) - Math.min( ...xs ) > 700 );
	assert.ok( Math.max( ...zs ) - Math.min( ...zs ) > 950 );

} );
