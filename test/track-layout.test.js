import assert from 'node:assert/strict';
import test from 'node:test';

import { DRIFT_TRACK_VERTICES, TRACK_CELLS } from '../js/TrackLayout.js';

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

test( 'drift reference becomes one closed, unambiguous driving loop', () => {

	assert.equal( TRACK_CELLS.length, 48 );
	assert.deepEqual( TRACK_CELLS[ 0 ], [ 6, 0, 'track-finish', 0 ] );
	assert.equal( TRACK_CELLS.filter( ( cell ) => cell[ 2 ] === 'track-finish' ).length, 1 );

	const cells = new Map( TRACK_CELLS.map( ( cell ) => [ `${ cell[ 0 ] },${ cell[ 1 ] }`, cell ] ) );
	assert.equal( cells.size, TRACK_CELLS.length, 'route cells must be unique' );

	for ( const cell of TRACK_CELLS ) {

		const mask = EXITS[ `${ cell[ 2 ] }:${ cell[ 3 ] }` ];
		assert.notEqual( mask, undefined, `known tile orientation at ${ cell[ 0 ] },${ cell[ 1 ] }` );

		let connected = 0;
		let adjacent = 0;

		for ( const [ dx, dz, bit, opposite ] of DIRECTIONS ) {

			const neighbor = cells.get( `${ cell[ 0 ] + dx },${ cell[ 1 ] + dz }` );
			if ( ! neighbor ) continue;
			adjacent ++;
			const neighborMask = EXITS[ `${ neighbor[ 2 ] }:${ neighbor[ 3 ] }` ];
			if ( ( mask & bit ) && ( neighborMask & opposite ) ) connected ++;

		}

		assert.equal( adjacent, 2, `no ambiguous nearby branch at ${ cell[ 0 ] },${ cell[ 1 ] }` );
		assert.equal( connected, 2, `both tile exits connect at ${ cell[ 0 ] },${ cell[ 1 ] }` );

	}

	for ( const vertex of DRIFT_TRACK_VERTICES ) {

		assert.ok( cells.has( `${ vertex[ 0 ] },${ vertex[ 1 ] }` ), `route includes control vertex ${ vertex }` );

	}

} );
