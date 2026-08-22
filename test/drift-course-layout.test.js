import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DRIFT_COURSE_POINTS,
	DRIFT_COURSE_SCALE,
	DRIFT_PATH_SAMPLES,
	DRIFT_ROAD_HALF_WIDTH,
	computeDriftCourseBounds,
} from '../js/DriftCourseLayout.js';

test( 'drift course traces the reference as one compact closed route', () => {

	assert.equal( DRIFT_COURSE_POINTS.length, 25 );
	assert.equal( DRIFT_COURSE_SCALE, 0.82 );
	assert.equal( DRIFT_PATH_SAMPLES, 320 );
	assert.ok( DRIFT_ROAD_HALF_WIDTH > 3 && DRIFT_ROAD_HALF_WIDTH < 3.5 );
	assert.deepEqual( DRIFT_COURSE_POINTS[ 0 ], [ 49 * 0.82, 3 * 0.82 ] );
	assert.deepEqual( DRIFT_COURSE_POINTS[ 4 ], [ - 16 * 0.82, 30 * 0.82 ] );

	const unique = new Set( DRIFT_COURSE_POINTS.map( ( point ) => point.join( ',' ) ) );
	assert.equal( unique.size, DRIFT_COURSE_POINTS.length );

	for ( let i = 0; i < DRIFT_COURSE_POINTS.length; i ++ ) {

		const a = DRIFT_COURSE_POINTS[ i ];
		const b = DRIFT_COURSE_POINTS[ ( i + 1 ) % DRIFT_COURSE_POINTS.length ];
		assert.ok( Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) < 28, `control segment ${ i } is too long` );

	}

	const bounds = computeDriftCourseBounds( 0 );
	assert.ok( Math.abs( bounds.halfWidth * 2 - 110.5 * 0.82 ) < 1e-9 );
	assert.ok( Math.abs( bounds.halfDepth * 2 - 59.5 * 0.82 ) < 1e-9 );

} );
