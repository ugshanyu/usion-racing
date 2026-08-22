import * as THREE from 'three';

const MAX_EXTRAPOLATION_MS = 180;
const SNAP_KEEP = 1500;
const TELEPORT_DIST_SQ = 64;

function lerpAngle( a, b, t ) {

	let diff = b - a;
	while ( diff > Math.PI ) diff -= Math.PI * 2;
	while ( diff < - Math.PI ) diff += Math.PI * 2;
	return a + diff * t;

}

function finite( value ) {

	return typeof value === 'number' && Number.isFinite( value );

}

function correctionRate( distance ) {

	if ( distance < 0.1 ) return 3;
	if ( distance < 0.5 ) return 8;
	if ( distance < 2 ) return 15;
	return 24;

}

// Remote trucks have no shared physics body. Each observer dead-reckons the
// owner's latest velocity every frame, then smoothly removes drift toward the
// newest owner-authoritative transform. Collision response remains local.
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

		this.snapshots = [];
		this.pos = new THREE.Vector3();
		this.target = new THREE.Vector3();
		this.vel = new THREE.Vector3();
		this.ownerVel = new THREE.Vector3();
		this.heading = 0;
		this.angularVelocity = 0;
		this.ownerAngularVelocity = 0;
		this.speed = 0;
		this.lap = 1;
		this.raceDist = - Infinity;
		this.gone = false;
		this.hasData = false;
		this.wheelSpin = 0;
		this.lastQ = - 1;


		this.container.visible = false;
		scene.add( this.container );

	}

	place( x, z, angle ) {

		this.pos.set( x, 0, z );
		this.target.copy( this.pos );
		this.heading = angle;
		this.container.position.copy( this.pos );
		this.container.rotation.set( 0, angle, 0 );
		this.container.visible = true;
		this.snapshots.length = 0;
		this.vel.set( 0, 0, 0 );
		this.ownerVel.set( 0, 0, 0 );
		this.angularVelocity = 0;
		this.ownerAngularVelocity = 0;

	}

	addSnapshot( data ) {

		if ( ! data ) return;
		if ( ! [ data.x, data.y ?? 0, data.z, data.h, data.vx ?? 0, data.vy ?? 0, data.vz ?? 0, data.av ?? 0 ].every( finite ) ) return;

		if ( finite( data.q ) ) {

			if ( data.q <= this.lastQ ) return;
			this.lastQ = data.q;

		}

		const arrival = Date.now();
		const serverTime = finite( data.st ) ? data.st : arrival;
		this.snapshots.push( {
			t: serverTime,
			receivedAt: arrival,
			lead: Math.max( 0, Math.min( MAX_EXTRAPOLATION_MS, data.lead ?? 0 ) ),
			x: data.x,
			y: data.y ?? 0,
			z: data.z,
			h: data.h,
			vx: data.vx ?? 0,
			vy: data.vy ?? 0,
			vz: data.vz ?? 0,
			av: data.av ?? 0,
		} );

		while ( this.snapshots.length > 2 && serverTime - this.snapshots[ 0 ].t > SNAP_KEEP ) this.snapshots.shift();

		if ( finite( data.l ) ) this.lap = data.l;
		if ( finite( data.rd ) ) this.raceDist = data.rd;
		this.ownerVel.set( data.vx ?? 0, data.vy ?? 0, data.vz ?? 0 );
		this.ownerAngularVelocity = data.av ?? 0;
		this.hasData = true;
		this.container.visible = true;

	}

	update( dt ) {

		if ( ! this.hasData || this.snapshots.length === 0 ) return;

		const newest = this.snapshots[ this.snapshots.length - 1 ];
		const ahead = Math.max( 0, Math.min( newest.lead + Date.now() - newest.receivedAt, MAX_EXTRAPOLATION_MS ) ) / 1000;
		const headingTarget = newest.h + newest.av * ahead;

		this.target.set(
			newest.x + newest.vx * ahead,
			newest.y + newest.vy * ahead,
			newest.z + newest.vz * ahead,
		);

		// Continue the remote simulation between packets. New snapshots correct
		// accumulated position error without making normal steering look like a
		// series of network snaps.
		this.vel.lerp( this.ownerVel, 1 - Math.exp( - 18 * dt ) );
		this.angularVelocity += ( this.ownerAngularVelocity - this.angularVelocity ) * ( 1 - Math.exp( - 18 * dt ) );
		this.pos.addScaledVector( this.vel, dt );
		this.heading += this.angularVelocity * dt;

		const driftSq = this.pos.distanceToSquared( this.target );

		if ( driftSq > TELEPORT_DIST_SQ ) {

			// A respawn/teleport must not spend seconds crossing the track. Ordinary
			// racing drift is always handled by the smooth path below.
			this.pos.copy( this.target );
			this.heading = headingTarget;

		} else {

			const drift = Math.sqrt( driftSq );
			this.pos.lerp( this.target, 1 - Math.exp( - correctionRate( drift ) * dt ) );
			this.heading = lerpAngle( this.heading, headingTarget, 1 - Math.exp( - correctionRate( drift ) * 0.8 * dt ) );

		}

		this.speed = this.vel.length();

		this.container.position.copy( this.pos );
		this.container.rotation.set( 0, this.heading, 0 );
		this.wheelSpin += this.speed * dt * 2.5;

		for ( const wheel of this.wheels ) wheel.rotation.x = this.wheelSpin;

	}

	dispose( scene ) {

		scene.remove( this.container );

	}

}
