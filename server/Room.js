import {
	COUNTDOWN_MS, EMPTY_ROOM_TTL_MS, KEYFRAME_EVERY, MAX_PLAYERS,
	NET_TICK_MS, RACE_OVER_TIMEOUT_MS, RECONNECT_GRACE_MS, SNAPSHOT_MAX_BYTES,
} from './config.js';
import { submitResult } from './webhook.js';

const CHAT_KEEP = 12;
const MAX_AVATAR_BYTES = 1024;
const LAP_OPTIONS = [ 3, 5, 10 ];

function clamp( value, min, max ) {

	return Math.max( min, Math.min( max, value ) );

}

function finite( value, min, max ) {

	const number = Number( value );
	return Number.isFinite( number ) && number >= min && number <= max ? number : null;

}

function text( value, length, fallback = '' ) {

	if ( typeof value !== 'string' ) return fallback;
	return value.replace( /[\u0000-\u001f\u007f]/g, '' ).trim().slice( 0, length ) || fallback;

}

function sanitizeCar( data, match ) {

	if ( ! data || Number( data.m ?? data.match ) !== match ) return null;

	const q = Number( data.q );
	const x = finite( data.x, -10_000, 10_000 );
	const y = finite( data.y ?? 0, -100, 100 );
	const z = finite( data.z, -10_000, 10_000 );
	const h = finite( data.h, - Math.PI * 4, Math.PI * 4 );
	const vx = finite( data.vx ?? 0, -200, 200 );
	const vy = finite( data.vy ?? 0, -200, 200 );
	const vz = finite( data.vz ?? 0, -200, 200 );
	const angularVelocity = finite( data.av ?? 0, -20, 20 );
	const networkRtt = finite( data.nr ?? 0, 0, 2000 );
	const lap = finite( data.l ?? 1, 0, 10 );
	const raceDist = finite( data.rd ?? 0, -1_000_000, 1_000_000 );

	if ( ! Number.isSafeInteger( q ) || q <= 0 ) return null;
	if ( [ x, y, z, h, vx, vy, vz, angularVelocity, networkRtt, lap, raceDist ].some( ( value ) => value === null ) ) return null;

	return { q, x, y, z, h, vx, vy, vz, av: angularVelocity, nr: Math.round( networkRtt ), l: Math.trunc( lap ), rd: raceDist };

}

export class Room {

	constructor( roomId, { onDestroy } ) {

		this.roomId = roomId;
		this.onDestroy = onDestroy;
		this.phase = 'waiting';
		this.laps = 3;
		this.players = [];
		this.connections = new Map();
		this.spectators = new Set();
		this.seats = [];
		this.match = 0;
		this.snapSeq = 0;
		this.netTick = 0;
		this.countdownEndsAt = 0;
		this.raceStartedAt = 0;
		this.firstFinishAt = 0;
		this.placements = null;
		this.chatSeq = 0;
		this.carRevision = 0;
		this.chats = [];
		this.lastSessionId = null;
		this.emptySince = 0;
		this.destroyed = false;

		this.timer = setInterval( () => this.tick(), NET_TICK_MS );
		this.timer.unref?.();
		this.sweep = setInterval( () => this.sweepConnections(), 5000 );
		this.sweep.unref?.();

	}

	hostId() {

		const connected = this.players.filter( ( player ) => player.connected ).sort( ( a, b ) => a.slot - b.slot );
		return connected[ 0 ]?.userId || null;

	}

	roster() {

		const seated = new Set( this.seats );

		return this.players
			.slice()
			.sort( ( a, b ) => a.slot - b.slot )
			.map( ( player ) => ( {
				slot: player.slot,
				user_id: player.userId,
				name: player.name,
				avatar: player.avatar,
				ready: player.ready,
				connected: player.connected,
				seated: seated.has( player.userId ),
			} ) );

	}

	snapshot( { keyframe = false, advance = false } = {} ) {

		if ( advance ) this.snapSeq ++;

		const now = Date.now();
		const payload = {
			v: 1,
			s: this.snapSeq,
			k: keyframe || undefined,
			server_ts: now,
			phase: this.phase,
			match: this.match,
			laps: this.laps,
			host_id: this.hostId(),
			countdown_ms: this.phase === 'countdown' ? Math.max( 0, this.countdownEndsAt - now ) : 0,
			elapsed_ms: this.raceStartedAt ? Math.max( 0, now - this.raceStartedAt ) : 0,
			players: this.seats.map( ( userId ) => {

				const player = this.players.find( ( candidate ) => candidate.userId === userId );
				return player ? { user_id: userId, car: player.car } : { user_id: userId, car: null };

			} ),
		};

		// The 60 Hz movement delta stays deliberately small. Reliable keyframes
		// carry lobby/results/chat metadata and repair any missed delta.
		if ( keyframe ) Object.assign( payload, {
			seats: this.seats.slice(),
			roster: this.roster(),
			finish_order: this.finishOrder(),
			finish_times: Object.fromEntries( this.players.filter( ( player ) => player.finished ).map( ( player ) => [ player.userId, player.finishTime ] ) ),
			placements: this.placements,
			chats: this.chats,
		} );
		const type = keyframe ? 'state_snapshot' : 'state_delta';
		const json = JSON.stringify( { type, room_id: this.roomId, payload } );

		if ( Buffer.byteLength( json ) >= SNAPSHOT_MAX_BYTES ) throw new Error( `snapshot exceeds ${ SNAPSHOT_MAX_BYTES } bytes` );
		return { payload, json };

	}

	finishOrder() {

		return this.players
			.filter( ( player ) => player.finished )
			.sort( ( a, b ) => a.finishedAt - b.finishedAt )
			.map( ( player ) => player.userId );

	}

	send( conn, type, payload ) {

		if ( conn.ws.readyState !== 1 ) return;
		try { conn.ws.send( JSON.stringify( { type, room_id: this.roomId, payload } ) ); } catch {}

	}

	broadcast( type, payload ) {

		const json = JSON.stringify( { type, room_id: this.roomId, payload } );

		for ( const conn of [ ... this.connections.values(), ... this.spectators ] ) {

			if ( conn.ws.readyState === 1 ) conn.ws.send( json );

		}

	}

	publish( keyframe = false ) {

		const { json } = this.snapshot( { keyframe, advance: true } );

		for ( const conn of [ ... this.connections.values(), ... this.spectators ] ) {

			if ( conn.ws.readyState === 1 && conn.ws.bufferedAmount < SNAPSHOT_MAX_BYTES * 8 ) conn.ws.send( json );

		}

	}

	unicastKeyframe( conn ) {

		const { json } = this.snapshot( { keyframe: true } );
		if ( conn.ws.readyState === 1 ) conn.ws.send( json );

	}

	handleMessage( conn, message ) {

		const payload = message?.payload || {};

		switch ( message?.type ) {

			case 'join': this.join( conn ); break;
			case 'input':
			case 'action': this.input( conn, payload ); break;
			case 'heartbeat': this.send( conn, 'heartbeat', { t: Date.now() } ); break;
			case 'ping':
				this.send( conn, 'pong', { t: payload.t, server_ts: Date.now() } );
				if ( Number( payload.last_sequence ) < this.snapSeq ) this.unicastKeyframe( conn );
				break;
			case 'sync': this.unicastKeyframe( conn ); break;
			case 'rematch': this.rematch( conn ); break;
			case 'leave': this.detach( conn, true ); break;
			default: this.send( conn, 'error', { code: 'BAD_MESSAGE', message: 'Unknown message type' } );

		}

	}

	join( conn ) {

		this.lastSessionId = conn.sessionId;
		const existing = this.players.find( ( player ) => player.userId === conn.userId );

		if ( existing ) {

			const old = this.connections.get( conn.userId );
			if ( old && old !== conn ) old.ws.close();
			this.connections.set( conn.userId, conn );
			existing.connected = true;
			existing.disconnectedAt = 0;
			existing.name = conn.name || existing.name;
			// Input sequences are scoped to a socket session. A page reload starts
			// again at q=1, so retaining the previous connection's q would freeze
			// that player's replicated car until it caught up.
			existing.lastCarSeq = 0;
			this.sendJoined( conn, existing.slot, false );
			this.broadcast( 'player_joined', { roster: this.roster(), host_id: this.hostId() } );
			this.publish( true );
			return;

		}

		const occupied = new Set( this.players.map( ( player ) => player.slot ) );
		const slot = Array.from( { length: MAX_PLAYERS }, ( _, index ) => index ).find( ( index ) => ! occupied.has( index ) );
		const canRace = ( this.phase === 'waiting' || this.phase === 'results' ) && slot !== undefined;

		if ( canRace ) {

			const player = {
				slot,
				userId: conn.userId,
				name: conn.name || conn.userId,
				avatar: null,
				ready: false,
				connected: true,
				disconnectedAt: 0,
				car: null,
				lastCarSeq: 0,
				finished: false,
				finishedAt: 0,
				finishTime: null,
			};
			this.players.push( player );
			this.connections.set( conn.userId, conn );
			this.sendJoined( conn, slot, false );
			this.broadcast( 'player_joined', { roster: this.roster(), host_id: this.hostId() } );
			this.publish( true );

		} else {

			conn.spectator = true;
			this.spectators.add( conn );
			this.sendJoined( conn, null, true );

		}

	}

	sendJoined( conn, slot, spectator ) {

		const { payload } = this.snapshot( { keyframe: true } );
		this.send( conn, 'joined', {
			room_id: this.roomId,
			slot,
			spectator,
			roster: this.roster(),
			host_id: this.hostId(),
			phase: this.phase,
			snapshot: payload,
		} );

	}

	input( conn, envelope ) {

		const type = envelope.action_type;
		const data = envelope.action_data || envelope;
		const player = this.players.find( ( candidate ) => candidate.userId === conn.userId );

		if ( ! player ) return;

		if ( type === 'player_info' || type === 'hello' ) {

			player.name = text( data.name, 40, player.name );
			player.avatar = typeof data.avatar === 'string' && Buffer.byteLength( data.avatar ) <= MAX_AVATAR_BYTES ? data.avatar : player.avatar;
			if ( type === 'player_info' && ( this.phase === 'waiting' || this.phase === 'results' ) ) player.ready = data.ready === true;
			this.publish( true );
			return;

		}

		if ( type === 'quick_chat' ) {

			const phrase = text( data.phrase, 60 );
			if ( ! phrase ) return;
			this.chats.push( { id: ++ this.chatSeq, user_id: player.userId, phrase } );
			while ( this.chats.length > CHAT_KEEP ) this.chats.shift();
			this.publish();
			return;

		}

		if ( type === 'race_settings' ) {

			if ( player.userId !== this.hostId() || ! [ 'waiting', 'results' ].includes( this.phase ) ) return;
			const laps = Number( data.laps );
			if ( ! LAP_OPTIONS.includes( laps ) ) return;
			this.laps = laps;
			this.publish( true );
			return;

		}

		if ( type === 'kickoff' ) {

			this.startRace( player, data );
			return;

		}

		if ( type === 'car' ) {

			if ( ! [ 'countdown', 'racing' ].includes( this.phase ) || ! this.seats.includes( player.userId ) ) return;
			const car = sanitizeCar( data, this.match );
			if ( ! car || car.q <= player.lastCarSeq ) return;
			player.lastCarSeq = car.q;
			// Observers dedupe this server-owned revision. It never rewinds when a
			// reconnecting browser restarts its input sequence at q=1.
			car.q = ++ this.carRevision;
			car.st = Date.now();
			player.car = car;
			return;

		}

		if ( type === 'finished' ) {

			this.finishPlayer( player, data );
			return;

		}

		// race_over is deliberately ignored. The room, not a client, owns the result.

	}

	startRace( player, data ) {

		if ( player.userId !== this.hostId() || ! [ 'waiting', 'results' ].includes( this.phase ) ) return;

		const requested = Array.isArray( data.seats ) ? data.seats : [];
		const requestedLaps = Number( data.laps );
		if ( LAP_OPTIONS.includes( requestedLaps ) ) this.laps = requestedLaps;
		const isRematch = this.phase === 'results';
		const previousSeats = new Set( this.seats );
		const eligible = this.players
			.filter( ( candidate ) => candidate.connected && ( isRematch
				? previousSeats.has( candidate.userId )
				: candidate.userId === player.userId || candidate.ready ) )
			.sort( ( a, b ) => a.slot - b.slot );
		const byId = new Map( eligible.map( ( candidate ) => [ candidate.userId, candidate ] ) );
		const ordered = requested.map( ( id ) => byId.get( id ) ).filter( Boolean );

		for ( const candidate of eligible ) if ( ! ordered.includes( candidate ) ) ordered.push( candidate );
		if ( ordered.length < 2 ) return;

		this.seats = ordered.slice( 0, MAX_PLAYERS ).map( ( candidate ) => candidate.userId );
		this.match ++;
		this.phase = 'countdown';
		this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
		this.raceStartedAt = 0;
		this.firstFinishAt = 0;
		this.placements = null;

		for ( const candidate of this.players ) {

			candidate.ready = false;
			candidate.car = null;
			candidate.lastCarSeq = 0;
			candidate.finished = false;
			candidate.finishedAt = 0;
			candidate.finishTime = null;

		}

		this.publish( true );

	}

	rematch( conn ) {

		const player = this.players.find( ( candidate ) => candidate.userId === conn.userId );
		if ( ! player || this.phase !== 'results' ) return;
		if ( player.userId !== this.hostId() ) {

			this.send( conn, 'error', { code: 'NOT_AUTHORITY', message: 'Only the host can restart this race' } );
			return;

		}

		this.startRace( player, { seats: this.seats.slice() } );

	}

	finishPlayer( player, data ) {

		if ( this.phase !== 'racing' || ! this.seats.includes( player.userId ) || player.finished ) return;
		if ( Number( data.match ) !== this.match ) return;

		const total = finite( data.total, 0, 60 * 60 );
		if ( total === null ) return;

		player.finished = true;
		player.finishedAt = Date.now();
		player.finishTime = Math.round( total * 100 ) / 100;
		if ( ! this.firstFinishAt ) this.firstFinishAt = player.finishedAt;
		this.publish( true );
		this.checkFinish();

	}

	checkFinish() {

		if ( this.phase !== 'racing' ) return;
		const active = this.players.filter( ( player ) => this.seats.includes( player.userId ) && player.connected );
		const allDone = active.length > 0 && active.every( ( player ) => player.finished );
		const timedOut = this.firstFinishAt && Date.now() - this.firstFinishAt >= RACE_OVER_TIMEOUT_MS;

		if ( allDone || timedOut ) this.finishRace( allDone ? 'race_complete' : 'finish_timeout' );

	}

	finishRace( reason ) {

		if ( this.phase === 'results' ) return;

		const racers = this.players.filter( ( player ) => this.seats.includes( player.userId ) );
		const ordered = racers.slice().sort( ( a, b ) => {

			if ( a.finished !== b.finished ) return a.finished ? - 1 : 1;
			if ( a.finished ) return a.finishedAt - b.finishedAt;
			return ( b.car?.rd ?? - Infinity ) - ( a.car?.rd ?? - Infinity );

		} );

		this.phase = 'results';
		this.placements = ordered.map( ( player ) => ( { id: player.userId, time: player.finishTime } ) );
		this.publish( true );

		const winner = ordered[ 0 ];
		this.broadcast( 'match_end', {
			winner_ids: winner ? [ winner.userId ] : [],
			reason,
			placements: this.placements,
		} );

		submitResult( {
			roomId: this.roomId,
			sessionId: this.lastSessionId || 'unknown',
			winnerIds: winner ? [ winner.userId ] : [],
			participants: racers.map( ( player ) => player.userId ),
			reason,
			finalStats: { match: this.match, placements: this.placements },
		} ).catch( ( error ) => console.error( '[RESULT]', error?.message || error ) );

	}

	tick() {

		if ( this.destroyed ) return;
		const now = Date.now();

		if ( this.phase === 'countdown' && now >= this.countdownEndsAt ) {

			this.phase = 'racing';
			this.raceStartedAt = now;
			this.publish( true );

		} else if ( this.phase === 'countdown' || this.phase === 'racing' ) {

			this.netTick ++;
			this.publish( this.netTick % KEYFRAME_EVERY === 0 );
			if ( this.phase === 'racing' ) this.checkFinish();

		}

	}

	detach( conn, close = false ) {

		if ( this.spectators.delete( conn ) ) {

			if ( close ) conn.ws.close();
			return;

		}

		if ( this.connections.get( conn.userId ) !== conn ) return;
		this.connections.delete( conn.userId );
		const player = this.players.find( ( candidate ) => candidate.userId === conn.userId );

		if ( player ) {

			player.connected = false;
			player.disconnectedAt = Date.now();
			player.ready = false;
			this.broadcast( 'player_left', { user_id: player.userId, roster: this.roster(), host_id: this.hostId() } );
			this.publish( true );
			this.checkFinish();

		}

		if ( close ) conn.ws.close();

	}

	sweepConnections() {

		const now = Date.now();

		for ( const conn of [ ... this.connections.values(), ... this.spectators ] ) {

			if ( now - conn.lastSeenMs > 45_000 ) conn.ws.close();

		}

		if ( this.phase === 'waiting' || this.phase === 'results' ) {

			this.players = this.players.filter( ( player ) => player.connected || now - player.disconnectedAt < RECONNECT_GRACE_MS );

		}

		if ( this.connections.size === 0 && this.spectators.size === 0 ) {

			if ( ! this.emptySince ) this.emptySince = now;
			if ( now - this.emptySince >= EMPTY_ROOM_TTL_MS ) this.destroy();

		} else {

			this.emptySince = 0;

		}

	}

	destroy() {

		if ( this.destroyed ) return;
		this.destroyed = true;
		clearInterval( this.timer );
		clearInterval( this.sweep );
		for ( const conn of [ ... this.connections.values(), ... this.spectators ] ) conn.ws.close();
		this.connections.clear();
		this.spectators.clear();
		this.onDestroy( this.roomId );

	}

}
