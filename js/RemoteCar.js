import * as THREE from 'three';

const INTERP_DELAY = 120;   // render this far in the past (ms) to absorb jitter
const SNAP_KEEP = 1000;     // drop snapshots older than this (ms)

function lerpAngle( a, b, t ) {

	let diff = b - a;
	while ( diff > Math.PI ) diff -= Math.PI * 2;
	while ( diff < - Math.PI ) diff += Math.PI * 2;
	return a + diff * t;

}

// A remote player's truck: no physics body — renders a snapshot buffer ~120 ms
// in the past, interpolating position and smoothing heading (never
// extrapolating angles). Exposes pos/vel for the local collision response.
export class RemoteCar {

	constructor( model, scene ) {

		this.container = new THREE.Group();
		const clone = model.clone();
		this.container.add( clone );

		this.wheels = [];
		this.bodyNode = null;

		clone.traverse( ( child ) => {

			const name = child.name.toLowerCase();
			if ( name === 'body' ) this.bodyNode = child;
			else if ( name.includes( 'wheel' ) ) this.wheels.push( child );

			if ( child.isMesh ) {

				child.castShadow = true;
				child.receiveShadow = true;

			}

		} );

		this.snapshots = [];        // { t, x, y, z, h, vx, vz }
		this.pos = new THREE.Vector3( 0, 0, 0 );
		this.vel = new THREE.Vector3();
		this.heading = 0;
		this.speed = 0;
		this.lap = 1;
		this.raceDist = - Infinity;
		this.finished = false;
		this.gone = false;
		this.hasData = false;
		this.wheelSpin = 0;

		this.container.visible = false;
		scene.add( this.container );

	}

	place( x, z, angle ) {

		this.pos.set( x, 0, z );
		this.heading = angle;
		this.container.position.set( x, 0, z );
		this.container.rotation.set( 0, angle, 0 );
		this.container.visible = true;
		this.snapshots.length = 0;

	}

	addSnapshot( d ) {

		const t = performance.now();
		this.snapshots.push( { t, x: d.x, y: d.y || 0, z: d.z, h: d.h, vx: d.vx || 0, vz: d.vz || 0 } );

		while ( this.snapshots.length > 2 && t - this.snapshots[ 0 ].t > SNAP_KEEP ) this.snapshots.shift();

		if ( typeof d.l === 'number' ) this.lap = d.l;
		if ( typeof d.rd === 'number' ) this.raceDist = d.rd;
		this.hasData = true;
		this.container.visible = true;

	}

	update( dt ) {

		if ( ! this.hasData || this.snapshots.length === 0 ) return;

		const renderT = performance.now() - INTERP_DELAY;
		const snaps = this.snapshots;

		let a = snaps[ 0 ], b = snaps[ snaps.length - 1 ];

		for ( let i = 0; i < snaps.length - 1; i ++ ) {

			if ( snaps[ i ].t <= renderT && snaps[ i + 1 ].t >= renderT ) {

				a = snaps[ i ];
				b = snaps[ i + 1 ];
				break;

			}

		}

		let x, y, z, h;

		if ( b.t > a.t && renderT >= a.t && renderT <= b.t ) {

			const t = ( renderT - a.t ) / ( b.t - a.t );
			x = a.x + ( b.x - a.x ) * t;
			y = a.y + ( b.y - a.y ) * t;
			z = a.z + ( b.z - a.z ) * t;
			h = lerpAngle( a.h, b.h, t );

		} else {

			// Ahead of the newest snapshot: hold position, never extrapolate.
			x = b.x; y = b.y; z = b.z; h = b.h;

		}

		this.vel.set( b.vx, 0, b.vz );
		this.speed = Math.hypot( b.vx, b.vz );
		this.pos.set( x, y, z );

		this.container.position.set( x, y, z );
		this.heading = lerpAngle( this.heading, h, 1 - Math.exp( - 12 * dt ) );
		this.container.rotation.set( 0, this.heading, 0 );

		this.wheelSpin += this.speed * dt * 2.5;

		for ( const wheel of this.wheels ) wheel.rotation.x = this.wheelSpin;

	}

	dispose( scene ) {

		scene.remove( this.container );

	}

}
