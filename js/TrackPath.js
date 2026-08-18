import { CELL_RAW, GRID_SCALE, TRACK_CELLS, computeSpawnPosition } from './Track.js';

const S = CELL_RAW * GRID_SCALE;

// Orders the track cells into a driving loop by adjacency, starting at the
// finish cell and heading along the spawn direction. Works for any well-formed
// single-loop track (every cell has exactly two track neighbours).
function walkLoop( cells ) {

	const byKey = new Map();
	for ( const c of cells ) byKey.set( c[ 0 ] + ',' + c[ 1 ], c );

	let start = cells.find( ( c ) => c[ 2 ] === 'track-finish' ) || cells[ 0 ];

	const spawn = computeSpawnPosition( cells );
	let dx = Math.round( Math.sin( spawn.angle ) );
	let dz = Math.round( Math.cos( spawn.angle ) );
	if ( dx === 0 && dz === 0 ) dz = 1;

	const ordered = [ start ];
	const visited = new Set( [ start[ 0 ] + ',' + start[ 1 ] ] );
	let gx = start[ 0 ], gz = start[ 1 ];

	for ( let step = 0; step < cells.length * 2; step ++ ) {

		// Candidate exits: straight ahead first, then the two perpendiculars.
		const candidates = [
			[ dx, dz ],
			[ dz, - dx ],
			[ - dz, dx ],
		];

		let advanced = false;

		for ( const [ cx, cz ] of candidates ) {

			const key = ( gx + cx ) + ',' + ( gz + cz );
			const cell = byKey.get( key );
			if ( ! cell ) continue;

			if ( visited.has( key ) ) {

				// Closing the loop back onto the start is the exit condition.
				if ( cell === start && ordered.length > 2 ) return ordered;
				continue;

			}

			gx += cx; gz += cz; dx = cx; dz = cz;
			ordered.push( cell );
			visited.add( key );
			advanced = true;
			break;

		}

		if ( ! advanced ) break;

	}

	return ordered;

}

export class TrackPath {

	constructor( cells ) {

		const list = cells || TRACK_CELLS;
		const loop = walkLoop( list );

		// Waypoints at cell centres, world space.
		this.points = loop.map( ( [ gx, gz ] ) => ( {
			x: ( gx + 0.5 ) * S,
			z: ( gz + 0.5 ) * S,
		} ) );

		// Cumulative arc length per waypoint + total loop length.
		this.cum = [ 0 ];
		let total = 0;

		for ( let i = 0; i < this.points.length; i ++ ) {

			const a = this.points[ i ];
			const b = this.points[ ( i + 1 ) % this.points.length ];
			total += Math.hypot( b.x - a.x, b.z - a.z );
			this.cum.push( total );

		}

		this.length = total;

		const spawn = computeSpawnPosition( list );
		this.spawn = spawn;
		this.startS = this.progress( { x: spawn.position[ 0 ], z: spawn.position[ 2 ] } );

	}

	// Arc-length position of a world point along the loop, in [0, length).
	progress( pos ) {

		let bestS = 0;
		let bestD = Infinity;
		const n = this.points.length;

		for ( let i = 0; i < n; i ++ ) {

			const a = this.points[ i ];
			const b = this.points[ ( i + 1 ) % n ];
			const abx = b.x - a.x, abz = b.z - a.z;
			const lenSq = abx * abx + abz * abz;
			let t = lenSq > 0 ? ( ( pos.x - a.x ) * abx + ( pos.z - a.z ) * abz ) / lenSq : 0;
			t = Math.max( 0, Math.min( 1, t ) );
			const px = a.x + abx * t, pz = a.z + abz * t;
			const d = ( pos.x - px ) * ( pos.x - px ) + ( pos.z - pz ) * ( pos.z - pz );

			if ( d < bestD ) {

				bestD = d;
				bestS = this.cum[ i ] + Math.sqrt( lenSq ) * t;

			}

		}

		return bestS % this.length;

	}

	// Race distance relative to the start line (0 at the line, grows forward).
	raceDistance( pos, lap ) {

		let s = this.progress( pos ) - this.startS;
		if ( s < - this.length / 2 ) s += this.length;
		if ( s > this.length / 2 && lap === 0 ) s -= this.length;
		return lap * this.length + s;

	}

	// A world point at arc-length s (wraps).
	pointAt( s ) {

		s = ( ( s % this.length ) + this.length ) % this.length;
		const n = this.points.length;

		for ( let i = 0; i < n; i ++ ) {

			if ( s <= this.cum[ i + 1 ] ) {

				const a = this.points[ i ];
				const b = this.points[ ( i + 1 ) % n ];
				const seg = this.cum[ i + 1 ] - this.cum[ i ];
				const t = seg > 0 ? ( s - this.cum[ i ] ) / seg : 0;
				return { x: a.x + ( b.x - a.x ) * t, z: a.z + ( b.z - a.z ) * t };

			}

		}

		return { x: this.points[ 0 ].x, z: this.points[ 0 ].z };

	}

	// Starting grid: 2 columns just PAST the finish arch (like the kit's spawn),
	// so the cars are visible during the countdown — the camera's fixed 45°
	// angle looks straight through the arch at anything behind the line.
	// Pole (slot 0) is the front row. A full loop is still required for a lap.
	gridSlots( count ) {

		const [ sx, , sz ] = this.spawn.position;
		const a = this.spawn.angle;
		const fx = Math.sin( a ), fz = Math.cos( a );      // forward
		const rx = fz, rz = - fx;                          // right

		const slots = [];

		for ( let i = 0; i < count; i ++ ) {

			const lat = ( i % 2 === 0 ? - 1.4 : 1.4 );
			const ahead = 4.4 - Math.floor( i / 2 ) * 3.0;
			slots.push( {
				x: sx + rx * lat + fx * ahead,
				z: sz + rz * lat + fz * ahead,
				angle: a,
			} );

		}

		return slots;

	}

}
