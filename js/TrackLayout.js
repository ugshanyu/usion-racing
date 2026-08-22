// Closed grid approximation of the white route in drift.jpg.
//
// The photographed drift course is open: it starts at the lower-left and ends
// on the right. The first three segments below are the added return leg from
// the finish, around the lower edge, and back into the photographed start. The
// remaining vertices form the tighter hairpins and S-bends of the white route.
// Keeping non-consecutive sections at least one empty cell apart is important:
// TrackPath orders the course by cardinal adjacency and therefore expects one
// unambiguous, two-neighbour loop.

export const DRIFT_TRACK_VERTICES = Object.freeze( [
	Object.freeze( [ 6, 0 ] ),   // shared start/finish line, driving south
	Object.freeze( [ 6, 3 ] ),   // compact, stepped return connector
	Object.freeze( [ 2, 3 ] ),
	Object.freeze( [ 2, 4 ] ),
	Object.freeze( [ - 2, 4 ] ),
	Object.freeze( [ - 2, 3 ] ),
	Object.freeze( [ - 6, 3 ] ),
	Object.freeze( [ - 6, - 2 ] ),
	Object.freeze( [ - 3, - 2 ] ),
	Object.freeze( [ - 3, 1 ] ),   // left hairpin
	Object.freeze( [ - 1, 1 ] ),
	Object.freeze( [ - 1, - 3 ] ), // centre S-bend
	Object.freeze( [ 2, - 3 ] ),
	Object.freeze( [ 2, 0 ] ),
	Object.freeze( [ 4, 0 ] ),
	Object.freeze( [ 4, - 2 ] ),   // right hairpin
	Object.freeze( [ 6, - 2 ] ),
] );

const CELL_FOR_EXITS = {
	3: [ 'track-straight', 16 ], // east + west
	5: [ 'track-corner', 0 ],    // south + west
	6: [ 'track-corner', 16 ],   // south + east
	9: [ 'track-corner', 22 ],   // north + west
	10: [ 'track-corner', 10 ],  // north + east
	12: [ 'track-straight', 0 ], // north + south
};

function directionBit( dx, dz ) {

	if ( dx === - 1 && dz === 0 ) return 1;
	if ( dx === 1 && dz === 0 ) return 2;
	if ( dx === 0 && dz === 1 ) return 4;
	if ( dx === 0 && dz === - 1 ) return 8;
	throw new Error( `Track route contains a non-cardinal step (${ dx }, ${ dz })` );

}

function finishOrientation( current, next ) {

	const dx = next[ 0 ] - current[ 0 ];
	const dz = next[ 1 ] - current[ 1 ];
	if ( dx === 1 ) return 16;
	if ( dx === - 1 ) return 22;
	if ( dz === 1 ) return 0;
	if ( dz === - 1 ) return 10;
	throw new Error( 'Finish direction must advance to an adjacent cell' );

}

function expandClosedRoute( vertices ) {

	const route = [ [ ...vertices[ 0 ] ] ];

	for ( let i = 0; i < vertices.length; i ++ ) {

		const start = vertices[ i ];
		const end = vertices[ ( i + 1 ) % vertices.length ];
		const deltaX = end[ 0 ] - start[ 0 ];
		const deltaZ = end[ 1 ] - start[ 1 ];

		if ( deltaX !== 0 && deltaZ !== 0 ) throw new Error( 'Track vertices must form axis-aligned segments' );

		const dx = Math.sign( deltaX );
		const dz = Math.sign( deltaZ );
		let x = start[ 0 ];
		let z = start[ 1 ];

		while ( x !== end[ 0 ] || z !== end[ 1 ] ) {

			x += dx;
			z += dz;

			// The closing segment reaches the first cell again; do not duplicate it.
			if ( i === vertices.length - 1 && x === route[ 0 ][ 0 ] && z === route[ 0 ][ 1 ] ) break;
			route.push( [ x, z ] );

		}

	}

	return route;

}

function buildTrackCells( vertices ) {

	const route = expandClosedRoute( vertices );
	const seen = new Set();

	return route.map( ( current, index ) => {

		const key = `${ current[ 0 ] },${ current[ 1 ] }`;
		if ( seen.has( key ) ) throw new Error( `Track route visits ${ key } more than once` );
		seen.add( key );

		const previous = route[ ( index - 1 + route.length ) % route.length ];
		const next = route[ ( index + 1 ) % route.length ];
		const exits = directionBit( previous[ 0 ] - current[ 0 ], previous[ 1 ] - current[ 1 ] ) |
			directionBit( next[ 0 ] - current[ 0 ], next[ 1 ] - current[ 1 ] );
		const tile = CELL_FOR_EXITS[ exits ];

		if ( ! tile ) throw new Error( `Track cell ${ key } has unsupported exits ${ exits }` );

		const type = index === 0 ? 'track-finish' : tile[ 0 ];
		const orientation = index === 0 ? finishOrientation( current, next ) : tile[ 1 ];
		return Object.freeze( [ current[ 0 ], current[ 1 ], type, orientation ] );

	} );

}

export const TRACK_CELLS = Object.freeze( buildTrackCells( DRIFT_TRACK_VERTICES ) );
