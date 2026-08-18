// Room lifecycle + realtime sync over the Usion platform relay.
// Register handlers up front (a solo launch can be promoted to a room), keep
// every action application idempotent (actions replay on reconnect).

const MAX_CHAT_LENGTH = 60;

export function normalizeChat( v ) {

	if ( typeof v !== 'string' ) return '';
	const m = v.trim().replace( /\s+/g, ' ' );
	return m && m.length <= MAX_CHAT_LENGTH ? m : '';

}

export function actionSafe( type, data ) {

	try {

		const p = Usion.game.action( type, data );
		if ( p && typeof p.catch === 'function' ) p.catch( () => {} );

	} catch {}

}

export class Net {

	constructor() {

		this.myId = null;
		this.playerIds = [];        // roster order — playerIds[0] is the host
		this.present = new Set();
		this.info = new Map();      // id → { name, avatar, ready }
		this.joined = false;

		this.mesh = null;           // WebRTC full mesh (P2P car snapshots)
		this.meshOpen = new Set();  // peer ids with an open DataChannel
		this._carTick = 0;

		this.lastChatAt = 0;
		this.appliedKickoffSeq = 0;
		this.appliedRaceOverSeq = 0;
		this.finishOrder = [];      // ids in authoritative finish order (action sequence)
		this.finishTimes = {};      // id → total seconds

		this.hooks = {};

	}

	isHost() {

		return this.playerIds.length > 0 && this.playerIds[ 0 ] === this.myId;

	}

	me() {

		return { id: this.myId, ...( this.info.get( this.myId ) || {} ) };

	}

	roster() {

		const ids = this.playerIds.filter( ( id ) => this.present.has( id ) );

		return ids.map( ( id, i ) => ( {
			id,
			name: ( this.info.get( id ) || {} ).name || 'Player',
			avatar: ( this.info.get( id ) || {} ).avatar || null,
			ready: !! ( this.info.get( id ) || {} ).ready,
			isHost: this.playerIds[ 0 ] === id,
			seat: i,
		} ) );

	}

	setup( config, hooks ) {

		this.hooks = hooks;
		this.myId = config.userId;
		if ( Array.isArray( config.playerIds ) && config.playerIds.length ) this.playerIds = config.playerIds.slice();

		this.info.set( this.myId, {
			name: config.userName || 'Player',
			avatar: config.userAvatar || null,
			ready: false,
		} );
		this.present.add( this.myId );

		const game = Usion.game;

		if ( game.onRoomAssigned ) game.onRoomAssigned( () => {

			// SDK already flipped roomId/mode and is joining us as host.
			this.present.add( this.myId );
			if ( hooks.onPromoted ) hooks.onPromoted();

		} );

		game.onJoined( ( d ) => {

			this.joined = true;
			if ( d && Array.isArray( d.player_ids ) && d.player_ids.length ) this.playerIds = d.player_ids.slice();
			for ( const id of this.playerIds ) if ( id === this.myId ) this.present.add( id );
			this.present.add( this.myId );
			this.broadcastInfo();
			this.emitRoster();
			this.syncMeshRoster();

		} );

		game.onPlayerJoined( ( d ) => {

			if ( d && Array.isArray( d.player_ids ) && d.player_ids.length ) this.playerIds = d.player_ids.slice();
			if ( d && d.player_id ) {

				this.present.add( d.player_id );
				if ( ! this.playerIds.includes( d.player_id ) ) this.playerIds.push( d.player_id );

			}

			this.broadcastInfo();   // newcomers missed earlier broadcasts
			this.emitRoster();
			this.syncMeshRoster();

		} );

		game.onPlayerLeft( ( d ) => {

			if ( d && Array.isArray( d.player_ids ) && d.player_ids.length ) this.playerIds = d.player_ids.slice();
			const id = d && d.player_id;

			if ( id ) {

				this.present.delete( id );
				this.meshOpen.delete( id );
				const info = this.info.get( id );
				if ( info ) info.ready = false;
				if ( hooks.onPlayerGone ) hooks.onPlayerGone( id );

			}

			this.emitRoster();
			this.syncMeshRoster();

		} );

		game.onRealtime( ( m ) => {

			if ( ! m || m.player_id === this.myId ) return;
			const d = m.action_data || {};

			if ( m.action_type === 'car' ) {

				if ( hooks.onCarSnap ) hooks.onCarSnap( m.player_id, d );

			} else if ( m.action_type === 'player_info' ) {

				this.info.set( m.player_id, {
					name: typeof d.name === 'string' ? d.name.slice( 0, 40 ) : 'Player',
					avatar: typeof d.avatar === 'string' ? d.avatar : null,
					ready: !! d.ready,
				} );
				this.present.add( m.player_id );
				this.emitRoster();

			} else if ( m.action_type === 'quick_chat' ) {

				const phrase = normalizeChat( d.phrase );
				if ( phrase && hooks.onChat ) hooks.onChat( m.player_id, phrase );

			}

		} );

		game.onAction( ( m ) => {

			if ( ! m ) return;
			const d = m.action_data || {};
			const seq = m.sequence || 0;

			if ( m.action_type === 'kickoff' ) {

				if ( seq <= this.appliedKickoffSeq ) return;
				if ( ! Array.isArray( d.seats ) || d.seats.length < 1 ) return;
				this.appliedKickoffSeq = seq;
				this.finishOrder = [];
				this.finishTimes = {};
				if ( hooks.onKickoff ) hooks.onKickoff( { seats: d.seats, seed: d.seed || 1, laps: d.laps || 3, seq } );

			} else if ( m.action_type === 'finished' ) {

				if ( d.match !== this.appliedKickoffSeq ) return;

				if ( ! this.finishOrder.includes( m.player_id ) ) {

					this.finishOrder.push( m.player_id );
					this.finishTimes[ m.player_id ] = typeof d.total === 'number' ? d.total : null;
					if ( hooks.onPlayerFinished ) hooks.onPlayerFinished( m.player_id );

				}

			} else if ( m.action_type === 'race_over' ) {

				if ( seq <= this.appliedRaceOverSeq || d.match !== this.appliedKickoffSeq ) return;
				this.appliedRaceOverSeq = seq;
				if ( hooks.onRaceOver && Array.isArray( d.placements ) ) hooks.onRaceOver( d.placements );

			}

		} );

		if ( game.onConnectionState ) game.onConnectionState( ( s ) => {

			if ( hooks.onConnState ) hooks.onConnState( s );

		} );

	}

	async join( roomId ) {

		await Usion.game.connect();
		await Usion.game.join( roomId );

	}

	// WebRTC mesh: car snapshots flow peer-to-peer (DataChannel over UDP) —
	// the relay hop through the backend is what makes remote cars feel late.
	// Signaling rides the realtime channel ('mesh'), handled inside the SDK.
	// The relay remains a live fallback: snapshots are seq-deduped on receive,
	// so whichever transport delivers first wins and duplicates are dropped.
	syncMeshRoster() {

		try {

			if ( ! this.mesh ) {

				if ( typeof Usion.game.createMeshNetwork !== 'function' ) return;
				const mesh = Usion.game.createMeshNetwork( { autoReconnect: true } );
				if ( ! mesh || typeof mesh.setRoster !== 'function' ) return;
				this.mesh = mesh;

				mesh.onPeerOpen = ( peerId ) => {

					this.meshOpen.add( peerId );
					if ( this.hooks.onMeshPeers ) this.hooks.onMeshPeers( this.meshOpen.size );

				};

				mesh.onPeerClose = ( peerId ) => {

					this.meshOpen.delete( peerId );
					if ( this.hooks.onMeshPeers ) this.hooks.onMeshPeers( this.meshOpen.size );

				};

				mesh.onMessage = ( peerId, data ) => {

					if ( data && data.t === 'car' && data.d && this.hooks.onCarSnap ) {

						this.hooks.onCarSnap( peerId, data.d );

					}

				};

				mesh.onError = () => {};   // relay fallback covers failed pairs

			}

			const peers = this.playerIds.filter( ( id ) => id !== this.myId && this.present.has( id ) );
			this.mesh.setRoster( peers ).catch( () => {} );

		} catch {}

	}

	broadcastInfo() {

		if ( ! this.joined ) return;
		const me = this.info.get( this.myId );

		try {

			Usion.game.realtime( 'player_info', { name: me.name, avatar: me.avatar, ready: !! me.ready } );

		} catch {}

	}

	setReady( ready ) {

		const me = this.info.get( this.myId );
		me.ready = !! ready;
		this.broadcastInfo();
		this.emitRoster();

	}

	emitRoster() {

		if ( this.hooks.onRoster ) this.hooks.onRoster( this.roster() );

	}

	// Host: lock present+ready players into the match's first stored action.
	startRace( laps ) {

		const seats = this.playerIds.filter( ( id ) => {

			if ( ! this.present.has( id ) ) return false;
			if ( id === this.myId ) return true;   // pressing Start implies ready
			return !! ( this.info.get( id ) || {} ).ready;

		} );

		if ( seats.length < 2 ) return false;

		const seed = ( Math.random() * 0x7fffffff ) | 0;
		actionSafe( 'kickoff', { seats: seats.slice( 0, 4 ), seed, laps } );
		return true;

	}

	// Called at 30 Hz. P2P mesh gets every tick; the relay gets every 2nd tick
	// (15 Hz) while any peer lacks an open channel, every 4th (7.5 Hz) once the
	// mesh is complete — receivers dedupe by the snapshot's seq, so double
	// delivery is free and the fastest transport wins.
	sendCar( d ) {

		this._carTick ++;

		if ( this.mesh && this.meshOpen.size > 0 ) {

			try {

				this.mesh.broadcast( { t: 'car', d } );

			} catch {}

		}

		const activePeers = this.playerIds.filter( ( id ) => id !== this.myId && this.present.has( id ) );
		const allMeshed = activePeers.length > 0 && activePeers.every( ( id ) => this.meshOpen.has( id ) );
		const relayEvery = allMeshed ? 4 : 2;

		if ( this._carTick % relayEvery === 0 ) {

			try {

				Usion.game.realtime( 'car', d );

			} catch {}

		}

	}

	sendChat( value ) {

		const phrase = normalizeChat( value );
		if ( ! phrase ) return false;
		if ( Date.now() - this.lastChatAt < 700 ) return false;
		this.lastChatAt = Date.now();

		try {

			Usion.game.realtime( 'quick_chat', { phrase } );

		} catch {}

		return true;

	}

	sendFinished( total ) {

		actionSafe( 'finished', { total: Math.round( total * 100 ) / 100, match: this.appliedKickoffSeq } );

	}

	// Host: declare final placements (all finished, or timeout with DNFs).
	sendRaceOver( placements ) {

		actionSafe( 'race_over', { placements, match: this.appliedKickoffSeq } );

	}

	async invite() {

		try {

			await Usion.game.invite();

		} catch {}

	}

}
