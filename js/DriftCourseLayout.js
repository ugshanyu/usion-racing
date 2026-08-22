// Hand-traced centreline from the white route in drift.jpg, converted from the
// reference image into compact world-space coordinates. Point zero is the
// photographed finish. Points 1-4 form the added return road to the
// photographed start; the remaining points follow the white route back to the
// finish. CatmullRomCurve3 closes and smooths this polygon in the browser.

export const DRIFT_COURSE_SCALE = 0.82;

const REFERENCE_COURSE_POINTS = [
	Object.freeze( [ 49.0, 3.0 ] ),   // finish
	Object.freeze( [ 57.0, 18.0 ] ),  // added connector
	Object.freeze( [ 37.0, 30.0 ] ),
	Object.freeze( [ 5.0, 32.0 ] ),
	Object.freeze( [ - 16.0, 30.0 ] ), // photographed start
	Object.freeze( [ - 28.5, 17.5 ] ),
	Object.freeze( [ - 40.5, 10.0 ] ),
	Object.freeze( [ - 50.5, - 1.0 ] ),
	Object.freeze( [ - 53.5, - 12.0 ] ),
	Object.freeze( [ - 48.5, - 22.0 ] ),
	Object.freeze( [ - 38.0, - 27.0 ] ),
	Object.freeze( [ - 27.5, - 25.0 ] ),
	Object.freeze( [ - 21.5, - 13.0 ] ),
	Object.freeze( [ - 17.0, 2.5 ] ),
	Object.freeze( [ - 8.0, 14.5 ] ),
	Object.freeze( [ 7.5, 18.5 ] ),
	Object.freeze( [ 23.0, 18.0 ] ),
	Object.freeze( [ 33.0, 9.5 ] ),
	Object.freeze( [ 35.5, - 0.5 ] ),
	Object.freeze( [ 31.0, - 11.0 ] ),
	Object.freeze( [ 28.0, - 22.0 ] ),
	Object.freeze( [ 34.5, - 27.5 ] ),
	Object.freeze( [ 45.5, - 26.5 ] ),
	Object.freeze( [ 52.5, - 17.0 ] ),
	Object.freeze( [ 53.0, - 5.0 ] ),
];

export const DRIFT_COURSE_POINTS = Object.freeze(
	REFERENCE_COURSE_POINTS.map( ( [ x, z ] ) => Object.freeze( [ x * DRIFT_COURSE_SCALE, z * DRIFT_COURSE_SCALE ] ) ),
);

export const DRIFT_ROAD_HALF_WIDTH = 3.25;
export const DRIFT_PATH_SAMPLES = 320;

export function computeDriftCourseBounds( padding = 14 ) {

	const xs = DRIFT_COURSE_POINTS.map( ( point ) => point[ 0 ] );
	const zs = DRIFT_COURSE_POINTS.map( ( point ) => point[ 1 ] );
	const minX = Math.min( ...xs ) - padding;
	const maxX = Math.max( ...xs ) + padding;
	const minZ = Math.min( ...zs ) - padding;
	const maxZ = Math.max( ...zs ) + padding;

	return {
		centerX: ( minX + maxX ) / 2,
		centerZ: ( minZ + maxZ ) / 2,
		halfWidth: ( maxX - minX ) / 2,
		halfDepth: ( maxZ - minZ ) / 2,
	};

}
