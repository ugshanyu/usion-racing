import * as THREE from 'three';
import { DRIFT_COURSE_POINTS, DRIFT_PATH_SAMPLES, DRIFT_ROAD_HALF_WIDTH } from './DriftCourseLayout.js';

export class CurvedTrackPath {

	constructor() {

		const controls = DRIFT_COURSE_POINTS.map( ( [ x, z ] ) => new THREE.Vector3( x, 0, z ) );
		this.curve = new THREE.CatmullRomCurve3( controls, true, 'centripetal', 0.5 );
		this.roadHalfWidth = DRIFT_ROAD_HALF_WIDTH;

		// Spaced samples keep bot lookahead, progress, and wall placement stable
		// even where the hand-traced control points are closer together.
		this.points = this.curve.getSpacedPoints( DRIFT_PATH_SAMPLES );
		this.points.pop(); // closed curves repeat point zero at the end

		this.cum = [ 0 ];
		let total = 0;

		for ( let i = 0; i < this.points.length; i ++ ) {

			const a = this.points[ i ];
			const b = this.points[ ( i + 1 ) % this.points.length ];
			total += a.distanceTo( b );
			this.cum.push( total );

		}

		this.length = total;
		const spawnPoint = this.points[ 0 ];
		const tangent = this.tangentAt( 0 );
		this.spawn = {
			position: [ spawnPoint.x, 0.5, spawnPoint.z ],
			angle: Math.atan2( tangent.x, tangent.z ),
		};
		this.startS = 0;

	}

	project( pos ) {

		let bestS = 0;
		let bestDistanceSq = Infinity;
		const count = this.points.length;

		for ( let i = 0; i < count; i ++ ) {

			const a = this.points[ i ];
			const b = this.points[ ( i + 1 ) % count ];
			const abx = b.x - a.x;
			const abz = b.z - a.z;
			const lengthSq = abx * abx + abz * abz;
			let t = lengthSq > 0 ? ( ( pos.x - a.x ) * abx + ( pos.z - a.z ) * abz ) / lengthSq : 0;
			t = THREE.MathUtils.clamp( t, 0, 1 );
			const px = a.x + abx * t;
			const pz = a.z + abz * t;
			const dx = pos.x - px;
			const dz = pos.z - pz;
			const distanceSq = dx * dx + dz * dz;

			if ( distanceSq < bestDistanceSq ) {

				bestDistanceSq = distanceSq;
				bestS = this.cum[ i ] + Math.sqrt( lengthSq ) * t;

			}

		}

		return { s: bestS % this.length, distance: Math.sqrt( bestDistanceSq ) };

	}

	progress( pos ) {

		return this.project( pos ).s;

	}

	distanceFromCenter( pos ) {

		return this.project( pos ).distance;

	}

	raceDistance( pos, lap ) {

		let s = this.progress( pos ) - this.startS;
		if ( s < - this.length / 2 ) s += this.length;
		if ( s > this.length / 2 && lap === 0 ) s -= this.length;
		return lap * this.length + s;

	}

	segmentAt( s ) {

		s = ( ( s % this.length ) + this.length ) % this.length;

		for ( let i = 0; i < this.points.length; i ++ ) {

			if ( s <= this.cum[ i + 1 ] ) {

				const segmentLength = this.cum[ i + 1 ] - this.cum[ i ];
				return { index: i, t: segmentLength > 0 ? ( s - this.cum[ i ] ) / segmentLength : 0 };

			}

		}

		return { index: 0, t: 0 };

	}

	pointAt( s ) {

		const { index, t } = this.segmentAt( s );
		const a = this.points[ index ];
		const b = this.points[ ( index + 1 ) % this.points.length ];
		return { x: THREE.MathUtils.lerp( a.x, b.x, t ), z: THREE.MathUtils.lerp( a.z, b.z, t ) };

	}

	tangentAt( s ) {

		const { index } = this.segmentAt( s );
		const previous = this.points[ ( index - 1 + this.points.length ) % this.points.length ];
		const next = this.points[ ( index + 1 ) % this.points.length ];
		return new THREE.Vector3().subVectors( next, previous ).setY( 0 ).normalize();

	}

	gridSlots( count ) {

		const slots = [];

		for ( let i = 0; i < count; i ++ ) {

			const lateral = i % 2 === 0 ? - 1.35 : 1.35;
			const ahead = 4.2 - Math.floor( i / 2 ) * 3.0;
			const s = this.startS + ahead;
			const point = this.pointAt( s );
			const tangent = this.tangentAt( s );
			const rightX = tangent.z;
			const rightZ = - tangent.x;

			slots.push( {
				x: point.x + rightX * lateral,
				z: point.z + rightZ * lateral,
				angle: Math.atan2( tangent.x, tangent.z ),
			} );

		}

		return slots;

	}

}
