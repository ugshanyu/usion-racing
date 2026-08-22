// Usion room lifecycle. Relay rooms remain supported, but production multiplayer
// uses a direct room server: clients publish their local car state and every
// observer renders the same sequenced, server-timestamped room snapshot.

const MAX_CHAT_LENGTH = 60;
const LAP_OPTIONS = [ 3, 5, 10 ];

function raceLaps( value, fallback = 3 ) {

	const laps = Number( value );
	return LAP_OPTIONS.includes( laps ) ? laps : fallback;

}

function profileName( value ) {

	if ( typeof value !== 'string' ) return null;
	const name = value.replace( /[\u0000-\u001f\u007f]/g, '' ).trim().slice( 0, 40 );
	return name || null;

}

function profileAvatar( value ) {

	if ( typeof value !== 'string' ) return null;
	const avatar = value.trim();
	return avatar || null;

}

export function normalizeChat( value ) {

	if ( typeof value !== 'string' ) return '';
	const message = value.trim().replace( /\s+/g, ' ' );
	return message && message.length <= MAX_CHAT_LENGTH ? message : '';

}

export function actionSafe( type, data ) {

	try {

		const promise = Usion.game.action( type, data );
		if ( promise && typeof promise.catch === 'function' ) promise.catch( () => {} );

	} catch {}

}

function isDirectSnapshot( value ) {

	return !! value
		&& Number.isSafeInteger( Number( value.s ) )
		&& Array.isArray( value.players )
		&& typeof value.phase === 'string';

}

function directConfigured( config ) {

	return config?.connectionMode === 'direct'
		|| config?.connection_mode === 'direct'
		|| config?.realtime?.connection_mode === 'direct';

}

export class Net {

	constructor() {

		this.myId = null;
		this.config = null;
		this.playerIds = [];
		this.hostId = null;
		this.slots = new Map();
		this.present = new Set();
		this.info = new Map();
		this.localProfile = { name: null, avatar: null };
		this.profileRequest = null;
		this.joined = false;
		this.authoritative = false;
		this.serverPhase = 'waiting';
		this.laps = 3;

		this.lastChatAt = 0;
		this.lastChatSeq = 0;
		this.lastSnapshotSeq = - 1;
		this.appliedKickoffSeq = 0;
		this.appliedRaceOverSeq = 0;
		this.finishOrder = [];
		this.finishTimes = {};

		this.localDirect = false;
		this.localSocket = null;
		this.localSeq = 0;
		this.localHeartbeat = null;
		this.latencyTimer = null;
		this.rttMs = 0;
		this.hooks = {};

	}

	isHost() {

		return ( this.hostId || this.playerIds[ 0 ] ) === this.myId;

	}

	isAuthoritative() {

		return this.authoritative;

	}

	me() {

		return { id: this.myId, ...( this.info.get( this.myId ) || {} ) };

	}

	roster() {

		return this.playerIds
			.filter( ( id ) => this.present.has( id ) )
			.map( ( id, index ) => ( {
				id,
				name: ( this.info.get( id ) || {} ).name || 'Player',
				avatar: ( this.info.get( id ) || {} ).avatar || null,
				ready: !! ( this.info.get( id ) || {} ).ready,
				isHost: ( this.hostId || this.playerIds[ 0 ] ) === id,
				seat: this.slots.has( id ) ? this.slots.get( id ) : index,
			} ) );

	}

	setup( config, hooks ) {

		this.config = config;
		this.hooks = hooks;
		this.myId = config.userId;
		this.authoritative = directConfigured( config );

		const query = new URLSearchParams( window.location.search );
		this.localDirect = query.get( 'multiplayer' ) === '1' && window.parent === window;
		if ( this.localDirect ) this.authoritative = true;

		if ( Array.isArray( config.playerIds ) && config.playerIds.length ) this.playerIds = config.playerIds.slice();
		this.hostId = this.playerIds[ 0 ] || null;
		let sdkName = null;
		let sdkAvatar = null;

		try { sdkName = Usion.user?.getName?.(); } catch {}
		try { sdkAvatar = Usion.user?.getAvatar?.(); } catch {}

		this.localProfile = {
			name: profileName( sdkName ) || profileName( config.userName ),
			avatar: profileAvatar( sdkAvatar ) || profileAvatar( config.userAvatar ),
		};
		this.info.set( this.myId, {
			name: this.localProfile.name || 'Player',
			avatar: this.localProfile.avatar,
			ready: false,
		} );
		this.present.add( this.myId );

		const game = Usion.game;

		if ( game.onRoomAssigned ) game.onRoomAssigned( () => {

			this.present.add( this.myId );
			if ( hooks.onPromoted ) hooks.onPromoted();

		} );

		game.onJoined( ( payload ) => {

			if ( payload && Array.isArray( payload.roster ) && ( payload.snapshot || Object.hasOwn( payload, 'slot' ) ) ) this.handleDirectJoined( payload );
			else this.handleRelayJoined( payload );

		} );

		game.onPlayerJoined( ( payload ) => {

			if ( payload && Array.isArray( payload.roster ) ) {

				this.applyDirectRoster( payload.roster, payload.host_id );
				this.broadcastInfo();

			} else this.handleRelayPlayerJoined( payload );

		} );

		game.onPlayerLeft( ( payload ) => {

			if ( payload && Array.isArray( payload.roster ) ) this.applyDirectRoster( payload.roster, payload.host_id );
			else this.handleRelayPlayerLeft( payload );

		} );

		game.onRealtime( ( message ) => {

			if ( isDirectSnapshot( message ) ) this.handleDirectSnapshot( message );
			else this.handleRelayRealtime( message );

		} );

		game.onAction( ( message ) => this.handleRelayAction( message ) );

		if ( game.onGameFinished ) game.onGameFinished( ( payload ) => {

			if ( ! this.authoritative || ! Array.isArray( payload?.placements ) ) return;
			this.applyDirectPlacements( payload.placements, this.appliedKickoffSeq );

		} );

		if ( game.onConnectionState ) game.onConnectionState( ( state ) => {

			if ( hooks.onConnState ) hooks.onConnState( state );

		} );

		if ( game.onReconnected ) game.onReconnected( () => {

			this.requestSync();
			this.refreshProfile();
			this.broadcastInfo();

		} );

		this.refreshProfile();

	}

	applyLocalProfile( profile ) {

		if ( ! profile || typeof profile !== 'object' ) return;
		const name = profileName( profile.name ) || this.localProfile.name;
		const avatar = profileAvatar( profile.avatar ) || this.localProfile.avatar;

		if ( ! name && ! avatar ) return;
		this.localProfile = { name, avatar };

		const current = this.info.get( this.myId ) || {};
		this.info.set( this.myId, {
			...current,
			name: name || current.name || 'Player',
			avatar: avatar || current.avatar || null,
		} );

		if ( name ) this.config.userName = name;
		if ( avatar ) this.config.userAvatar = avatar;
		this.broadcastInfo();
		this.emitRoster();

	}

	refreshProfile() {

		const user = Usion.user;
		if ( ! user ) return Promise.resolve( this.localProfile );

		let name = null;
		let avatar = null;
		try { name = user.getName?.(); } catch {}
		try { avatar = user.getAvatar?.(); } catch {}
		this.applyLocalProfile( { name, avatar } );

		if ( typeof user.getProfile !== 'function' ) return Promise.resolve( this.localProfile );
		if ( this.profileRequest ) return this.profileRequest;

		this.profileRequest = Promise.resolve()
			.then( () => user.getProfile() )
			.then( ( profile ) => {

				this.applyLocalProfile( profile?.profile || profile );
				return this.localProfile;

			} )
			.catch( () => this.localProfile )
			.finally( () => { this.profileRequest = null; } );

		return this.profileRequest;

	}

	handleRelayJoined( payload ) {

		this.joined = true;
		if ( payload && Array.isArray( payload.player_ids ) && payload.player_ids.length ) this.playerIds = payload.player_ids.slice();
		this.hostId = this.playerIds[ 0 ] || this.hostId;
		this.present.add( this.myId );
		this.refreshProfile();
		this.broadcastInfo();
		this.emitRoster();

	}

	handleRelayPlayerJoined( payload ) {

		if ( payload && Array.isArray( payload.player_ids ) && payload.player_ids.length ) this.playerIds = payload.player_ids.slice();
		if ( payload?.player_id ) {

			this.present.add( payload.player_id );
			if ( ! this.playerIds.includes( payload.player_id ) ) this.playerIds.push( payload.player_id );

		}
		this.hostId = this.playerIds[ 0 ] || this.hostId;
		this.broadcastInfo();
		this.emitRoster();

	}

	handleRelayPlayerLeft( payload ) {

		if ( payload && Array.isArray( payload.player_ids ) && payload.player_ids.length ) this.playerIds = payload.player_ids.slice();
		const id = payload?.player_id;

		if ( id ) {

			this.present.delete( id );
			const info = this.info.get( id );
			if ( info ) info.ready = false;
			if ( this.hooks.onPlayerGone ) this.hooks.onPlayerGone( id );

		}
		this.hostId = this.playerIds[ 0 ] || null;
		this.emitRoster();

	}

	handleRelayRealtime( message ) {

		if ( ! message || message.player_id === this.myId || typeof message.player_id !== 'string' ) return;
		const data = message.action_data || {};

		if ( message.action_type === 'car' ) {

			if ( this.hooks.onCarSnap ) this.hooks.onCarSnap( message.player_id, data );

		} else if ( message.action_type === 'player_info' ) {

			this.info.set( message.player_id, {
				name: typeof data.name === 'string' ? data.name.slice( 0, 40 ) : 'Player',
				avatar: typeof data.avatar === 'string' ? data.avatar : null,
				ready: !! data.ready,
			} );
			this.present.add( message.player_id );
			this.emitRoster();

		} else if ( message.action_type === 'quick_chat' ) {

			const phrase = normalizeChat( data.phrase );
			if ( phrase && this.hooks.onChat ) this.hooks.onChat( message.player_id, phrase );

		}

	}

	handleRelayAction( message ) {

		if ( ! message || this.authoritative ) return;
		const data = message.action_data || {};
		const sequence = message.sequence || 0;

		if ( message.action_type === 'race_settings' ) {

			const laps = raceLaps( data.laps, this.laps );
			if ( laps === this.laps ) return;
			this.laps = laps;
			if ( this.hooks.onSettings ) this.hooks.onSettings( { laps } );

		} else if ( message.action_type === 'kickoff' ) {

			if ( sequence <= this.appliedKickoffSeq || ! Array.isArray( data.seats ) || data.seats.length < 1 ) return;
			this.appliedKickoffSeq = sequence;
			this.finishOrder = [];
			this.finishTimes = {};
			this.laps = raceLaps( data.laps, this.laps );
			if ( this.hooks.onKickoff ) this.hooks.onKickoff( { seats: data.seats, seed: data.seed || 1, laps: this.laps, seq: sequence } );

		} else if ( message.action_type === 'finished' ) {

			if ( data.match !== this.appliedKickoffSeq || this.finishOrder.includes( message.player_id ) ) return;
			this.finishOrder.push( message.player_id );
			this.finishTimes[ message.player_id ] = typeof data.total === 'number' ? data.total : null;
			if ( this.hooks.onPlayerFinished ) this.hooks.onPlayerFinished( message.player_id );

		} else if ( message.action_type === 'race_over' ) {

			if ( sequence <= this.appliedRaceOverSeq || data.match !== this.appliedKickoffSeq ) return;
			this.appliedRaceOverSeq = sequence;
			if ( this.hooks.onRaceOver && Array.isArray( data.placements ) ) this.hooks.onRaceOver( data.placements );

		}

	}

	handleDirectJoined( payload ) {

		this.authoritative = true;
		this.joined = true;
		this.lastSnapshotSeq = - 1;
		this.applyDirectRoster( payload.roster, payload.host_id );
		if ( payload.snapshot ) this.handleDirectSnapshot( payload.snapshot, true );
		this.refreshProfile();
		this.broadcastInfo();
		this.startLatencyProbe();
		if ( this.hooks.onConnState ) this.hooks.onConnState( 'connected' );

	}

	applyDirectRoster( rows, hostId ) {

		if ( ! Array.isArray( rows ) ) return;
		const previous = new Set( this.present );
		const valid = rows
			.filter( ( row ) => Number.isInteger( row?.slot ) && typeof row?.user_id === 'string' )
			.sort( ( a, b ) => a.slot - b.slot )
			.slice( 0, 4 );

		this.playerIds = valid.map( ( row ) => row.user_id );
		this.present.clear();
		this.slots.clear();

		for ( const row of valid ) {

			this.slots.set( row.user_id, row.slot );
			if ( row.connected !== false ) this.present.add( row.user_id );
			const isMe = row.user_id === this.myId;
			this.info.set( row.user_id, {
				// The first server roster is built from the access token and may only
				// know the user id. Never let it erase the richer Usion SDK profile
				// before player_info has reached the room.
				name: isMe && this.localProfile.name
					? this.localProfile.name
					: profileName( row.name ) || 'Player',
				avatar: isMe && this.localProfile.avatar
					? this.localProfile.avatar
					: profileAvatar( row.avatar ),
				ready: row.ready === true,
			} );

		}

		this.hostId = typeof hostId === 'string' ? hostId : valid.find( ( row ) => row.connected !== false )?.user_id || null;

		for ( const id of previous ) {

			if ( id !== this.myId && ! this.present.has( id ) && this.hooks.onPlayerGone ) this.hooks.onPlayerGone( id );

		}
		this.emitRoster();

	}

	handleDirectSnapshot( snapshot, fromJoin = false ) {

		if ( ! isDirectSnapshot( snapshot ) ) return;
		const sequence = Number( snapshot.s );
		const fresh = sequence > this.lastSnapshotSeq;

		if ( ! fresh && ! ( snapshot.k && sequence === this.lastSnapshotSeq ) ) return;
		if ( fresh && this.lastSnapshotSeq >= 0 && sequence > this.lastSnapshotSeq + 1 ) this.requestSync();
		if ( fresh ) this.lastSnapshotSeq = sequence;

		this.authoritative = true;
		this.serverPhase = snapshot.phase;
		if ( Array.isArray( snapshot.roster ) ) this.applyDirectRoster( snapshot.roster, snapshot.host_id );

		const laps = raceLaps( snapshot.laps, this.laps );
		if ( laps !== this.laps ) {

			this.laps = laps;
			if ( this.hooks.onSettings ) this.hooks.onSettings( { laps } );

		}

		const match = Number( snapshot.match ) || 0;
		const seats = Array.isArray( snapshot.seats ) ? snapshot.seats.filter( ( id ) => typeof id === 'string' ).slice( 0, 4 ) : [];

		if ( match > this.appliedKickoffSeq && seats.length ) {

			this.appliedKickoffSeq = match;
			this.appliedRaceOverSeq = 0;
			this.finishOrder = [];
			this.finishTimes = {};
			if ( this.hooks.onKickoff ) this.hooks.onKickoff( {
				seats,
				seed: match,
				laps: this.laps,
				seq: match,
				phase: snapshot.phase,
				countdownMs: Number( snapshot.countdown_ms ) || 0,
				elapsedMs: Number( snapshot.elapsed_ms ) || 0,
			} );

		}

		const order = Array.isArray( snapshot.finish_order ) ? snapshot.finish_order : [];

		for ( const id of order ) {

			if ( typeof id !== 'string' || this.finishOrder.includes( id ) ) continue;
			this.finishOrder.push( id );
			this.finishTimes[ id ] = typeof snapshot.finish_times?.[ id ] === 'number' ? snapshot.finish_times[ id ] : null;
			if ( this.hooks.onPlayerFinished ) this.hooks.onPlayerFinished( id );

		}

		const serverTime = Number( snapshot.server_ts ) || Date.now();

		for ( const row of snapshot.players ) {

			if ( row?.user_id === this.myId || typeof row?.user_id !== 'string' || ! row.car ) continue;
			const acceptedAt = Number( row.car.st ) || serverTime;
			const ownerRtt = Math.max( 0, Math.min( 2000, Number( row.car.nr ) || 0 ) );
			const relayMs = Math.max( 0, Math.min( 100, serverTime - acceptedAt ) );
			if ( this.hooks.onCarSnap ) this.hooks.onCarSnap( row.user_id, {
				... row.car,
				st: acceptedAt,
				// Estimate how old the owner's sample is when it reaches this
				// observer. Dead reckoning consumes this lead and then corrects.
				lead: ownerRtt * 0.5 + relayMs + this.rttMs * 0.5,
			} );

		}

		if ( ! fromJoin && Array.isArray( snapshot.chats ) ) {

			for ( const chat of snapshot.chats ) {

				if ( ! Number.isSafeInteger( chat?.id ) || chat.id <= this.lastChatSeq ) continue;
				this.lastChatSeq = chat.id;
				const phrase = normalizeChat( chat.phrase );
				if ( phrase && chat.user_id !== this.myId && this.hooks.onChat ) this.hooks.onChat( chat.user_id, phrase );

			}

		} else if ( fromJoin && Array.isArray( snapshot.chats ) ) {

			for ( const chat of snapshot.chats ) if ( Number.isSafeInteger( chat?.id ) ) this.lastChatSeq = Math.max( this.lastChatSeq, chat.id );

		}

		if ( this.hooks.onPhase ) this.hooks.onPhase( {
			phase: snapshot.phase,
			countdownMs: Number( snapshot.countdown_ms ) || 0,
			elapsedMs: Number( snapshot.elapsed_ms ) || 0,
			match,
		} );

		if ( snapshot.phase === 'results' && Array.isArray( snapshot.placements ) ) this.applyDirectPlacements( snapshot.placements, match );

	}

	applyDirectPlacements( placements, match ) {

		if ( match <= 0 || this.appliedRaceOverSeq >= match ) return;
		const normalized = placements
			.map( ( placement ) => ( {
				id: placement?.id || placement?.user_id,
				time: typeof placement?.time === 'number'
					? placement.time
					: typeof placement?.finish_ms === 'number' ? placement.finish_ms / 1000 : null,
			} ) )
			.filter( ( placement ) => typeof placement.id === 'string' );

		if ( ! normalized.length ) return;
		this.appliedRaceOverSeq = match;
		if ( this.hooks.onRaceOver ) this.hooks.onRaceOver( normalized );

	}

	async join( roomId ) {

		if ( this.localDirect ) { await this.connectLocal( roomId ); return; }

		if ( directConfigured( this.config ) && typeof Usion.game.connectDirect === 'function' ) {

			await Usion.game.connectDirect( { roomId, serviceId: this.config.serviceId } );

		} else {

			await Usion.game.connect();
			await Usion.game.join( roomId );

		}

	}

	connectLocal( roomId ) {

		return new Promise( ( resolve, reject ) => {

			const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const safeRoom = String( roomId || 'local-room' ).replace( /[^\w-]/g, '-' ).slice( 0, 64 ) || 'local-room';
			const safeUser = String( this.myId || 'player' ).replace( /[^\w-]/g, '-' ).slice( 0, 64 ) || 'player';
			const socket = new WebSocket( `${ scheme }//${ window.location.host }/ws?token=${ encodeURIComponent( `dev:${ safeUser }:${ safeRoom }` ) }` );
			this.localSocket = socket;

			socket.onopen = () => {

				this.sendLocal( 'join', {} );
				this.localHeartbeat = setInterval( () => this.sendLocal( 'heartbeat', {} ), 25_000 );
				resolve();

			};
			socket.onerror = () => reject( new Error( 'Local multiplayer WebSocket failed' ) );
			socket.onclose = () => {

				this.joined = false;
				if ( this.localHeartbeat ) clearInterval( this.localHeartbeat );
				this.localHeartbeat = null;
				if ( this.hooks.onConnState ) this.hooks.onConnState( 'disconnected' );

			};
			socket.onmessage = ( event ) => {

				let message;
				try { message = JSON.parse( event.data ); } catch { return; }
				const payload = message.payload || {};
				if ( message.type === 'joined' ) this.handleDirectJoined( payload );
				else if ( message.type === 'player_joined' || message.type === 'player_left' ) this.applyDirectRoster( payload.roster, payload.host_id );
				else if ( message.type === 'state_snapshot' || message.type === 'state_delta' ) this.handleDirectSnapshot( payload );
				else if ( message.type === 'match_end' ) this.applyDirectPlacements( payload.placements || [], this.appliedKickoffSeq );

			};

		} );

	}

	sendLocal( type, payload ) {

		if ( ! this.localSocket || this.localSocket.readyState !== WebSocket.OPEN ) return;
		this.localSocket.send( JSON.stringify( {
			type,
			seq: ++ this.localSeq,
			ts: Date.now(),
			protocol_version: '2',
			payload,
		} ) );

	}

	sendRealtime( type, data ) {

		if ( this.localDirect ) this.sendLocal( 'input', { action_type: type, action_data: data } );
		else {

			try { Usion.game.realtime( type, data ); } catch {}

		}

	}

	sendAction( type, data ) {

		if ( this.localDirect ) this.sendLocal( 'action', { action_type: type, action_data: data } );
		else actionSafe( type, data );

	}

	requestSync() {

		if ( this.localDirect ) this.sendLocal( 'ping', { last_sequence: Math.max( 0, this.lastSnapshotSeq ) } );
		else {

			try { if ( Usion.game.requestSync ) Usion.game.requestSync( Math.max( 0, this.lastSnapshotSeq ) ); } catch {}

		}

	}

	startLatencyProbe() {

		if ( this.localDirect || this.latencyTimer || typeof Usion.game.ping !== 'function' ) return;
		const sample = () => {

			try {

				const result = Usion.game.ping();
				if ( result && typeof result.then === 'function' ) result.then( ( rtt ) => {

					if ( typeof rtt === 'number' && Number.isFinite( rtt ) ) this.rttMs = Math.max( 0, Math.min( 2000, rtt ) );

				} ).catch( () => {} );

			} catch {}

		};

		sample();
		this.latencyTimer = setInterval( sample, 2000 );

	}

	broadcastInfo() {

		if ( ! this.joined ) return;
		const me = this.info.get( this.myId );
		if ( ! me ) return;
		this.sendRealtime( 'player_info', { name: me.name, avatar: me.avatar, ready: !! me.ready } );

	}

	setReady( ready ) {

		const me = this.info.get( this.myId );
		if ( ! me ) return;
		me.ready = !! ready;
		this.broadcastInfo();
		this.emitRoster();

	}

	emitRoster() {

		if ( this.hooks.onRoster ) this.hooks.onRoster( this.roster() );

	}

	setLaps( value ) {

		if ( ! this.isHost() ) return false;
		const laps = raceLaps( value, this.laps );
		if ( laps === this.laps ) return true;
		this.laps = laps;
		if ( this.hooks.onSettings ) this.hooks.onSettings( { laps } );
		this.sendAction( 'race_settings', { laps } );
		return true;

	}

	startRace( laps ) {

		laps = raceLaps( laps, this.laps );
		this.laps = laps;

		const seats = this.playerIds.filter( ( id ) => {

			if ( ! this.present.has( id ) ) return false;
			if ( id === this.myId ) return true;
			return !! ( this.info.get( id ) || {} ).ready;

		} );

		if ( seats.length < 2 ) return false;
		this.sendAction( 'kickoff', { seats: seats.slice( 0, 4 ), seed: ( Math.random() * 0x7fffffff ) | 0, laps } );
		return true;

	}

	startRematch( laps ) {

		laps = raceLaps( laps, this.laps );
		this.laps = laps;

		const seats = this.playerIds.filter( ( id ) => this.present.has( id ) ).slice( 0, 4 );
		if ( seats.length < 2 ) return false;

		// Direct rooms implement the SDK rematch frame. The legacy relay keeps
		// using the sequenced kickoff action because the platform rematch event is
		// only a peer notification and does not restart a room by itself.
		if ( this.localDirect ) this.sendLocal( 'rematch', {} );
		else if ( directConfigured( this.config ) && typeof Usion.game.requestRematch === 'function' ) {

			try { Usion.game.requestRematch(); } catch { return false; }

		} else this.sendAction( 'kickoff', { seats, seed: ( Math.random() * 0x7fffffff ) | 0, laps } );
		return true;

	}

	sendCar( data ) {

		if ( this.rttMs > 0 ) data.nr = Math.round( this.rttMs );
		this.sendRealtime( 'car', data );

	}

	sendChat( value ) {

		const phrase = normalizeChat( value );
		if ( ! phrase || Date.now() - this.lastChatAt < 700 ) return false;
		this.lastChatAt = Date.now();
		this.sendRealtime( 'quick_chat', { phrase } );
		return true;

	}

	sendFinished( total ) {

		this.sendAction( 'finished', { total: Math.round( total * 100 ) / 100, match: this.appliedKickoffSeq } );

	}

	sendRaceOver( placements ) {

		if ( this.authoritative ) return;
		this.sendAction( 'race_over', { placements, match: this.appliedKickoffSeq } );

	}

	async invite() {

		try { await Usion.game.invite(); } catch {}

	}

}
