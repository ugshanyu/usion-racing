import * as THREE from 'three';
import { CELL_RAW, GRID_SCALE, TRACK_CELLS, TYPE_NAMES, computeSpawnPosition } from './Track.js';

const FINISH = TYPE_NAMES[ 3 ];
const STORAGE_PREFIX = 'racing.bestLap.';
const _tmp = new THREE.Vector3();

function loadBest( key ) {

	try {

		const v = localStorage.getItem( key );
		const n = v !== null ? Number( v ) : NaN;
		return Number.isFinite( n ) ? n : null;

	} catch {

		return null;

	}

}

function saveBest( key, value ) {

	try {

		localStorage.setItem( key, String( value ) );

	} catch {}

}

export function formatTime( t ) {

	if ( t === null || t === undefined ) return '0:00.00';

	const m = Math.floor( t / 60 );
	const s = t - m * 60;
	return `${ m }:${ s.toFixed( 2 ).padStart( 5, '0' ) }`;

}

// Headless race timer: lap detection via finish-line crossing gated on having
// visited every track cell (no shortcut counts). Emits callbacks; UI renders
// from the public fields.
export class LapTimer {

	constructor( cells, opts = {} ) {

		this.storageKey = STORAGE_PREFIX + ( opts.trackId || 'default' );
		this.totalLaps = opts.laps || 3;
		this.onLap = opts.onLap || null;          // ( lapTime, lapIndex, isBest )
		this.onRaceEnd = opts.onRaceEnd || null;  // ( totalTime )

		this.bestLap = loadBest( this.storageKey );

		this.lineCenter = new THREE.Vector3();
		this.lineForward = new THREE.Vector3( 0, 0, 1 );
		this.lineRight = new THREE.Vector3( 1, 0, 0 );

		this.cellSize = CELL_RAW * GRID_SCALE;
		this.requiredCells = new Set();

		const list = cells || TRACK_CELLS;
		this.enabled = list.some( ( c ) => c[ 2 ] === FINISH );

		if ( this.enabled ) {

			const spawn = computeSpawnPosition( list );
			this.lineCenter.set( spawn.position[ 0 ], 0, spawn.position[ 2 ] );
			this.lineForward.set( Math.sin( spawn.angle ), 0, Math.cos( spawn.angle ) );
			this.lineRight.set( this.lineForward.z, 0, - this.lineForward.x );

			for ( const c of list ) {

				if ( c[ 2 ] !== FINISH ) this.requiredCells.add( c[ 0 ] + ',' + c[ 1 ] );

			}

		}

		this.resetRace();

	}

	resetRace() {

		this.lap = 1;                 // lap currently being driven (1-based)
		this.lastLap = null;
		this.currentLapTime = 0;
		this.totalTime = 0;
		this.running = false;
		this.finished = false;
		this.prevForwardProj = null;
		this.visitedCells = new Set();

	}

	start() {

		this.running = true;

	}

	update( dt, position ) {

		if ( ! this.enabled || ! this.running || this.finished ) return;

		this.currentLapTime += dt;
		this.totalTime += dt;

		const gx = Math.floor( position.x / this.cellSize );
		const gz = Math.floor( position.z / this.cellSize );
		const key = gx + ',' + gz;
		if ( this.requiredCells.has( key ) ) this.visitedCells.add( key );

		_tmp.copy( position ).sub( this.lineCenter );
		const forwardProj = _tmp.dot( this.lineForward );
		const lateralProj = Math.abs( _tmp.dot( this.lineRight ) );

		if ( this.prevForwardProj !== null ) {

			const onLine = lateralProj <= this.cellSize * 0.5;
			const noTeleport = Math.abs( forwardProj - this.prevForwardProj ) < 5;
			const crossedForward = this.prevForwardProj < 0 && forwardProj >= 0;

			if ( onLine && noTeleport && crossedForward ) {

				if ( this.visitedCells.size === this.requiredCells.size ) this.completeLap();
				this.visitedCells.clear();

			}

		}

		this.prevForwardProj = forwardProj;

	}

	completeLap() {

		const isBest = this.bestLap === null || this.currentLapTime < this.bestLap;

		this.lastLap = this.currentLapTime;

		if ( isBest ) {

			this.bestLap = this.currentLapTime;
			saveBest( this.storageKey, this.bestLap );

		}

		const finishedLap = this.lap;

		if ( this.onLap ) this.onLap( this.lastLap, finishedLap, isBest );

		if ( finishedLap >= this.totalLaps ) {

			this.finished = true;
			this.running = false;
			if ( this.onRaceEnd ) this.onRaceEnd( this.totalTime );
			return;

		}

		this.lap += 1;
		this.currentLapTime = 0;

	}

}
