import * as THREE from 'three';
import { Vehicle } from './Vehicle.js';
import { createSphereBody } from './Physics.js';

const _fwd = new THREE.Vector3();

function normAngle( a ) {

	while ( a > Math.PI ) a -= Math.PI * 2;
	while ( a < - Math.PI ) a += Math.PI * 2;
	return a;

}

// A bot driver: a full Vehicle (own physics body — real collisions with the
// player, other bots, and walls) steered toward a lookahead point on the
// track path.
export class Bot {

	constructor( id, name, model, world, scene, path, speedScale ) {

		this.id = id;
		this.name = name;
		this.path = path;
		this.speedScale = speedScale;

		this.vehicle = new Vehicle();
		this.vehicle.rigidBody = createSphereBody( world, null );
		this.vehicle.physicsWorld = world;
		scene.add( this.vehicle.init( model ) );

		this.input = { x: 0, z: 0, touchActive: false };
		this.enabled = false;

		this.dist = 0;              // unwrapped race distance
		this.prevS = null;
		this.finished = false;
		this.finishTime = null;

		this.stuckTime = 0;
		this.reverseUntil = 0;

	}

	place( x, z, angle ) {

		this.vehicle.reset( x, z, angle );
		const s0 = this.path.progress( { x, z } );
		this.startGap = ( this.path.startS - s0 + this.path.length ) % this.path.length;
		this.dist = 0;
		this.prevS = null;
		this.finished = false;
		this.finishTime = null;
		this.stuckTime = 0;
		this.reverseUntil = 0;

	}

	get pos() {

		return this.vehicle.spherePos;

	}

	get raceDist() {

		return this.dist - ( this.startGap || 0 );

	}

	get lap() {

		return Math.min( Math.floor( this.dist / this.path.length ) + 1, 99 );

	}

	update( dt, totalLaps, raceClock ) {

		const v = this.vehicle;

		if ( this.enabled && ! this.finished ) {

			// Unwrapped progress along the loop.
			const s = this.path.progress( v.spherePos );

			if ( this.prevS !== null ) {

				let d = s - this.prevS;
				if ( d > this.path.length / 2 ) d -= this.path.length;
				if ( d < - this.path.length / 2 ) d += this.path.length;
				this.dist += d;

			}

			this.prevS = s;

			if ( this.raceDist >= totalLaps * this.path.length ) {

				this.finished = true;
				this.finishTime = raceClock;

			}

			// Steering: aim at a speed-scaled lookahead point on the path.
			_fwd.set( 0, 0, 1 ).applyQuaternion( v.container.quaternion );
			const yaw = Math.atan2( _fwd.x, _fwd.z );

			const lookahead = 4 + v.linearSpeed * 4;
			const target = this.path.pointAt( s + lookahead );
			const desired = Math.atan2( target.x - v.spherePos.x, target.z - v.spherePos.z );
			const err = normAngle( desired - yaw );

			const now = raceClock;

			if ( now < this.reverseUntil ) {

				// Back out of a wall, steering opposite.
				this.input.x = err > 0 ? 1 : - 1;
				this.input.z = - 1;

			} else {

				this.input.x = THREE.MathUtils.clamp( - err * 1.3, - 1, 1 );
				this.input.z = THREE.MathUtils.clamp( 1 - Math.abs( err ) * 0.8, 0.3, 1 ) * this.speedScale;

				// Stuck against a wall? Reverse briefly.
				if ( v.linearSpeed < 0.15 && this.input.z > 0.3 ) {

					this.stuckTime += dt;

					if ( this.stuckTime > 1.5 ) {

						this.reverseUntil = now + 0.8;
						this.stuckTime = 0;

					}

				} else {

					this.stuckTime = 0;

				}

			}

		} else {

			this.input.x = 0;
			this.input.z = 0;

		}

		v.update( dt, this.input );

	}

	dispose( scene ) {

		scene.remove( this.vehicle.container );

	}

}

export const BOT_NAMES = [ 'Naran', 'Tulga', 'Saruul' ];
export const BOT_SPEEDS = [ 0.99, 0.93, 0.86 ];
