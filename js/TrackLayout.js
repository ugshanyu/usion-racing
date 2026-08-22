import { buildClosedTrackCells } from './TileTrackLayout.js';

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

export const TRACK_CELLS = Object.freeze( buildClosedTrackCells( DRIFT_TRACK_VERTICES ) );
