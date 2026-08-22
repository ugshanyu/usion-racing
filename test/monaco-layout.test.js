import test from 'node:test';
import assert from 'node:assert/strict';

import {
	MONACO_OFFICIAL_LENGTH_METERS,
	MONACO_ROUTE_METERS,
	MONACO_SOURCE_LENGTH_METERS,
	MONACO_TRACK_CELLS,
	MONACO_TRACK_VERTICES,
	MONACO_TURN_COUNT,
} from '../js/MonacoLayout.js';

const EXITS = {
	'track-straight:0': 12,
	'track-straight:10': 12,
	'track-straight:16': 3,
	'track-straight:22': 3,
	'track-finish:0': 12,
	'track-finish:10': 12,
	'track-finish:16': 3,
	'track-finish:22': 3,
	'track-corner:0': 5,
	'track-corner:16': 6,
	'track-corner:10': 10,
	'track-corner:22': 9,
};

const DIRECTIONS = [
	[ 0, - 1, 8, 4 ],
	[ 0, 1, 4, 8 ],
	[ 1, 0, 2, 1 ],
	[ - 1, 0, 1, 2 ],
];

function closedLength( points ) {

	let length = 0;

	for ( let i = 0; i < points.length; i ++ ) {

		const a = points[ i ];
		const b = points[ ( i + 1 ) % points.length ];
		length += Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

	}

	return length;

}

test( 'Monaco retains the licensed source reference and uses one OG-style tile loop', () => {

	const simplifiedLength = closedLength( MONACO_ROUTE_METERS );
	assert.equal( MONACO_TURN_COUNT, 19 );
	assert.equal( MONACO_OFFICIAL_LENGTH_METERS, 3337 );
	assert.ok( MONACO_ROUTE_METERS.length >= 160 );
	assert.ok( Math.abs( MONACO_SOURCE_LENGTH_METERS - MONACO_OFFICIAL_LENGTH_METERS ) < 2 );
	assert.ok( Math.abs( simplifiedLength - MONACO_SOURCE_LENGTH_METERS ) < 3 );

	const xs = MONACO_ROUTE_METERS.map( ( point ) => point[ 0 ] );
	const zs = MONACO_ROUTE_METERS.map( ( point ) => point[ 1 ] );
	assert.ok( Math.max( ...xs ) - Math.min( ...xs ) > 700 );
	assert.ok( Math.max( ...zs ) - Math.min( ...zs ) > 950 );

	assert.equal( MONACO_TRACK_VERTICES.length, 27 );
	assert.equal( MONACO_TRACK_CELLS.length, 98 );
	assert.deepEqual( MONACO_TRACK_CELLS[ 0 ], [ 22, - 8, 'track-finish', 22 ] );
	assert.equal( MONACO_TRACK_CELLS.filter( ( cell ) => cell[ 2 ] === 'track-finish' ).length, 1 );
	assert.equal( MONACO_TRACK_CELLS.filter( ( cell ) => cell[ 2 ] === 'track-corner' ).length, 26 );

	const cells = new Map( MONACO_TRACK_CELLS.map( ( cell ) => [ `${ cell[ 0 ] },${ cell[ 1 ] }`, cell ] ) );
	assert.equal( cells.size, MONACO_TRACK_CELLS.length, 'route cells must be unique' );

	for ( const cell of MONACO_TRACK_CELLS ) {

		const mask = EXITS[ `${ cell[ 2 ] }:${ cell[ 3 ] }` ];
		assert.notEqual( mask, undefined, `known OG tile orientation at ${ cell[ 0 ] },${ cell[ 1 ] }` );

		let adjacent = 0;
		let connected = 0;

		for ( const [ dx, dz, bit, opposite ] of DIRECTIONS ) {

			const neighbor = cells.get( `${ cell[ 0 ] + dx },${ cell[ 1 ] + dz }` );
			if ( ! neighbor ) continue;
			adjacent ++;
			const neighborMask = EXITS[ `${ neighbor[ 2 ] }:${ neighbor[ 3 ] }` ];
			if ( ( mask & bit ) && ( neighborMask & opposite ) ) connected ++;

		}

		assert.equal( adjacent, 2, `no ambiguous nearby branch at ${ cell[ 0 ] },${ cell[ 1 ] }` );
		assert.equal( connected, 2, `both OG tile exits connect at ${ cell[ 0 ] },${ cell[ 1 ] }` );

	}

	for ( const vertex of MONACO_TRACK_VERTICES ) {

		assert.ok( cells.has( `${ vertex[ 0 ] },${ vertex[ 1 ] }` ), `route includes control vertex ${ vertex }` );

	}

} );
