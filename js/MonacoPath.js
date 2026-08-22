import * as THREE from 'three';
import {
	MONACO_PATH_SAMPLES,
	MONACO_ROAD_HALF_WIDTH,
	MONACO_ROUTE_POINTS,
} from './MonacoLayout.js';

function closedMetrics( points ) {

	const cumulative = [ 0 ];
	let length = 0;

	for ( let i = 0; i < points.length; i ++ ) {

		length += points[ i ].distanceTo( points[ ( i + 1 ) % points.length ] );
		cumulative.push( length );

	}

	return { cumulative, length };

}

function resampleClosed( source, count ) {

	const { cumulative, length } = closedMetrics( source );
	const points = [];
	let segment = 0;

	for ( let i = 0; i < count; i ++ ) {

		const distance = length * i / count;
		while ( segment < source.length - 1 && distance > cumulative[ segment + 1 ] ) segment ++;
		const next = ( segment + 1 ) % source.length;
		const span = cumulative[ segment + 1 ] - cumulative[ segment ];
		const alpha = span > 0 ? ( distance - cumulative[ segment ] ) / span : 0;
		points.push( new THREE.Vector3().lerpVectors( source[ segment ], source[ next ], alpha ) );

	}

	return points;

}

export class MonacoPath {

	constructor() {

		const source = MONACO_ROUTE_POINTS.map( ( [ x, z ] ) => new THREE.Vector3( x, 0, z ) );
		this.points = resampleClosed( source, MONACO_PATH_SAMPLES );
		this.roadHalfWidth = MONACO_ROAD_HALF_WIDTH;

		const metrics = closedMetrics( this.points );
		this.cum = metrics.cumulative;
		this.length = metrics.length;
		this.startS = 0;

		const start = this.points[ 0 ];
		const tangent = this.tangentAt( 0 );
		this.spawn = {
			position: [ start.x, 0.5, start.z ],
			angle: Math.atan2( tangent.x, tangent.z ),
		};

	}

	project( position ) {

		let bestS = 0;
		let bestDistanceSq = Infinity;

		for ( let i = 0; i < this.points.length; i ++ ) {

			const a = this.points[ i ];
			const b = this.points[ ( i + 1 ) % this.points.length ];
			const dx = b.x - a.x;
			const dz = b.z - a.z;
			const lengthSq = dx * dx + dz * dz;
			let alpha = lengthSq > 0
				? ( ( position.x - a.x ) * dx + ( position.z - a.z ) * dz ) / lengthSq
				: 0;
			alpha = THREE.MathUtils.clamp( alpha, 0, 1 );
			const px = a.x + dx * alpha;
			const pz = a.z + dz * alpha;
			const distanceSq = ( position.x - px ) ** 2 + ( position.z - pz ) ** 2;

			if ( distanceSq < bestDistanceSq ) {

				bestDistanceSq = distanceSq;
				bestS = this.cum[ i ] + Math.sqrt( lengthSq ) * alpha;

			}

		}

		return { s: bestS % this.length, distance: Math.sqrt( bestDistanceSq ) };

	}

	progress( position ) {

		return this.project( position ).s;

	}

	distanceFromCenter( position ) {

		return this.project( position ).distance;

	}

	raceDistance( position, lap ) {

		let distance = this.progress( position ) - this.startS;
		if ( distance < - this.length / 2 ) distance += this.length;
		if ( distance > this.length / 2 && lap === 0 ) distance -= this.length;
		return lap * this.length + distance;

	}

	segmentAt( distance ) {

		distance = ( ( distance % this.length ) + this.length ) % this.length;

		for ( let i = 0; i < this.points.length; i ++ ) {

			if ( distance <= this.cum[ i + 1 ] ) {

				const span = this.cum[ i + 1 ] - this.cum[ i ];
				return { index: i, alpha: span > 0 ? ( distance - this.cum[ i ] ) / span : 0 };

			}

		}

		return { index: 0, alpha: 0 };

	}

	pointAt( distance ) {

		const { index, alpha } = this.segmentAt( distance );
		const a = this.points[ index ];
		const b = this.points[ ( index + 1 ) % this.points.length ];
		return { x: THREE.MathUtils.lerp( a.x, b.x, alpha ), z: THREE.MathUtils.lerp( a.z, b.z, alpha ) };

	}

	tangentAt( distance ) {

		const { index } = this.segmentAt( distance );
		const previous = this.points[ ( index - 1 + this.points.length ) % this.points.length ];
		const next = this.points[ ( index + 1 ) % this.points.length ];
		return new THREE.Vector3().subVectors( next, previous ).setY( 0 ).normalize();

	}

	gridSlots( count ) {

		const slots = [];

		for ( let i = 0; i < count; i ++ ) {

			const lateral = i % 2 === 0 ? - 1.35 : 1.35;
			const ahead = 4.2 - Math.floor( i / 2 ) * 3.0;
			const point = this.pointAt( this.startS + ahead );
			const tangent = this.tangentAt( this.startS + ahead );

			slots.push( {
				x: point.x + tangent.z * lateral,
				z: point.z - tangent.x * lateral,
				angle: Math.atan2( tangent.x, tangent.z ),
			} );

		}

		return slots;

	}

	bounds( padding = 12 ) {

		const xs = this.points.map( ( point ) => point.x );
		const zs = this.points.map( ( point ) => point.z );
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

}
