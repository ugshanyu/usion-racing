import * as THREE from 'three';

// Interpolation tuning (Valve Source–style, mirrors the SDK's
// SnapshotInterpolation): render slightly in the past, size the delay from
// MEASURED arrival jitter (mobile WebView bridges deliver realtime messages in
// bursts — a fixed delay stutters there), and dead-reckon forward on underrun,
// capped, so cars keep moving through gaps instead of freezing.
const MIN_DELAY = 60;         // ms — floor at ~1.2 send frames (20 Hz sender)
const MAX_DELAY = 350;        // ms — ceiling for very bursty links
const EXTRAPOLATION_MS = 280; // max forward projection on buffer underrun
const SNAP_KEEP = 1500;       // drop snapshots older than this (ms)
const SNAP_TELEPORT = 36;     // distance² that means "respawn, don't glide"

function lerpAngle( a, b, t ) {

	let diff = b - a;
	while ( diff > Math.PI ) diff -= Math.PI * 2;
	while ( diff < - Math.PI ) diff += Math.PI * 2;
	return a + diff * t;

}

// A remote player's truck: no physics body — renders its snapshot stream with
// an adaptive-delay buffer + capped extrapolation. Heading is smoothed toward
// the newest received value, never extrapolated (linear angle extrapolation
// across the ±π wrap whip-spins). Exposes pos/vel for local collision response.
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
		this.pos = new THREE.Vector3( 0, 0, 0 );      // rendered (smoothed)
		this.target = new THREE.Vector3( 0, 0, 0 );   // interpolated/extrapolated
		this.vel = new THREE.Vector3();
		this.heading = 0;
		this.speed = 0;
		this.lap = 1;
		this.raceDist = - Infinity;
		this.gone = false;
		this.hasData = false;
		this.wheelSpin = 0;

		// Adaptive-delay state (EWMA of arrival interval + jitter).
		this.delayMs = 120;
		this._lastArrival = null;
		this._avgInterval = 50;
		this._jitter = 0;

		this.container.visible = false;
		scene.add( this.container );

	}

	place( x, z, angle ) {

		this.pos.set( x, 0, z );
		this.target.set( x, 0, z );
		this.heading = angle;
		this.container.position.set( x, 0, z );
		this.container.rotation.set( 0, angle, 0 );
		this.container.visible = true;
		this.snapshots.length = 0;
		this._lastArrival = null;

	}

	addSnapshot( d ) {

		const t = performance.now();

		if ( this._lastArrival !== null ) {

			const interval = t - this._lastArrival;
			this._avgInterval += 0.1 * ( interval - this._avgInterval );
			this._jitter += 0.1 * ( Math.abs( interval - this._avgInterval ) - this._jitter );
			this.delayMs = Math.max( MIN_DELAY, Math.min( MAX_DELAY, this._avgInterval + 2 * this._jitter ) );

		}

		this._lastArrival = t;

		this.snapshots.push( { t, x: d.x, y: d.y || 0, z: d.z, h: d.h, vx: d.vx || 0, vz: d.vz || 0 } );

		while ( this.snapshots.length > 2 && t - this.snapshots[ 0 ].t > SNAP_KEEP ) this.snapshots.shift();

		if ( typeof d.l === 'number' ) this.lap = d.l;
		if ( typeof d.rd === 'number' ) this.raceDist = d.rd;
		this.hasData = true;
		this.container.visible = true;

	}

	update( dt ) {

		if ( ! this.hasData || this.snapshots.length === 0 ) return;

		const renderT = performance.now() - this.delayMs;
		const snaps = this.snapshots;
		const newest = snaps[ snaps.length - 1 ];

		let x, y, z, h;

		if ( renderT > newest.t ) {

			// Underrun: dead-reckon forward from the newest snapshot's velocity,
			// capped so prediction error stays small. Heading holds.
			const ahead = Math.min( renderT - newest.t, EXTRAPOLATION_MS ) / 1000;
			x = newest.x + newest.vx * ahead;
			y = newest.y;
			z = newest.z + newest.vz * ahead;
			h = newest.h;

		} else {

			let a = snaps[ 0 ], b = newest;

			for ( let i = snaps.length - 1; i > 0; i -- ) {

				if ( snaps[ i - 1 ].t <= renderT && renderT <= snaps[ i ].t ) {

					a = snaps[ i - 1 ];
					b = snaps[ i ];
					break;

				}

			}

			if ( b.t > a.t ) {

				const t = Math.max( 0, Math.min( 1, ( renderT - a.t ) / ( b.t - a.t ) ) );
				x = a.x + ( b.x - a.x ) * t;
				y = a.y + ( b.y - a.y ) * t;
				z = a.z + ( b.z - a.z ) * t;
				h = lerpAngle( a.h, b.h, t );

			} else {

				x = b.x; y = b.y; z = b.z; h = b.h;

			}

		}

		this.target.set( x, y, z );
		this.vel.set( newest.vx, 0, newest.vz );
		this.speed = Math.hypot( newest.vx, newest.vz );

		// Converge the rendered position onto the target instead of snapping —
		// absorbs extrapolation corrections. A huge jump is a respawn: snap.
		if ( this.pos.distanceToSquared( this.target ) > SNAP_TELEPORT ) {

			this.pos.copy( this.target );

		} else {

			const k = 1 - Math.exp( - 22 * dt );
			this.pos.lerp( this.target, k );

		}

		this.container.position.copy( this.pos );
		this.heading = lerpAngle( this.heading, h, 1 - Math.exp( - 14 * dt ) );
		this.container.rotation.set( 0, this.heading, 0 );

		this.wheelSpin += this.speed * dt * 2.5;

		for ( const wheel of this.wheels ) wheel.rotation.x = this.wheelSpin;

	}

	dispose( scene ) {

		scene.remove( this.container );

	}

}
